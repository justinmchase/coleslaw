use cslw::{check_source, parse_source, resolve_config, Input, LOWERING};
use serde_json::Value as Json;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_cslw")
}

fn run(args: &[&str]) -> std::process::Output {
    Command::new(bin()).args(args).output().expect("run cslw")
}

fn stderr(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stderr).to_string()
}

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cslw-{}-{}", std::process::id(), name));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

const SHELL: &str = r#"
export config ShellSettings {
  mode: ("job");
  jobName: (string);
}

export shape JobName = (string);

export mode BatchJob(jobName: (JobName)): Job {
  jobs {
    ExampleJob example;
  }
}

export program ShellDemo {
  config ShellSettings settings;
  arguments {
    0: settings.mode;
    1: settings.jobName;
  }
  mode settings.mode {
    "job" => BatchJob(settings.jobName);
  }
}
"#;

#[test]
// req:application-shell-001
fn req_application_shell_001_parses_shapes_and_keeps_start_state_spans() {
    let parsed = parse_source(SHELL, "shell.clsw").expect("parse shell");
    assert_eq!(parsed["kind"], "module");
    assert_eq!(parsed["source"], "shell.clsw");
    let shape = declaration(&parsed, "shape", "JobName");
    assert!(shape["span"]["start"]["offset"].as_u64().unwrap() > 0);
    let mode = declaration(&parsed, "mode", "BatchJob");
    assert_eq!(mode["parameters"][0]["name"], "jobName");
    assert!(
        mode["parameters"][0]["span"]["start"]["offset"]
            .as_u64()
            .unwrap()
            > 0
    );

    let source = "aggregate Counter {\n  identity id: (string) = \"\";\n  state Before {}\n  start state Ready {}\n  state After {}\n}\n";
    let aggregate = parse_source(source, "start-state.clsw").expect("parse start");
    let aggregate = declaration(&aggregate, "aggregate", "Counter");
    assert_eq!(aggregate["start"], "Ready");
    let names = aggregate["states"]
        .as_array()
        .unwrap()
        .iter()
        .map(|state| state["name"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(names, ["Before", "Ready", "After"]);
    for state in aggregate["states"].as_array().unwrap() {
        let start = state["span"]["start"]["offset"].as_u64().unwrap() as usize;
        let end = state["span"]["end"]["offset"].as_u64().unwrap() as usize;
        let text = &source[start..end];
        let name = state["name"].as_str().unwrap();
        assert!(text.contains(name), "{text}");
        if name == "Ready" {
            assert!(text.contains("start"), "{text}");
        }
    }

    for invalid in [
        source.replace("start state Ready {}", "start Ready; state Ready {}"),
        source.replace("start state Ready {}", "state Ready {}"),
        source.replace("state After {}", "start state After {}"),
    ] {
        let error = parse_source(&invalid, "invalid-start.clsw").expect_err("refused start");
        assert!(error.to_string().contains("invalid-start.clsw"), "{error}");
    }

    let trailing = parse_source(&format!("{SHELL}\nnot-an-application"), "broken.clsw");
    let error = trailing.expect_err("trailing junk");
    assert!(error.to_string().contains("broken.clsw"), "{error}");
    assert!(error.to_string().contains("offset"), "{error}");

    let unsupported = parse_source("workflow Approval {}", "workflow.clsw");
    assert!(
        unsupported.is_err(),
        "unsupported declarations are not a clean parse"
    );
}

#[test]
// req:application-shell-002
fn req_application_shell_002_resolves_exports_and_reports_the_importer() {
    let dir = temp("imports");
    fs::write(
        dir.join("shared.clsw"),
        "export config Settings {\n  mode: (\"job\");\n}\n",
    )
    .unwrap();
    let importer = dir.join("app.clsw");
    fs::write(
        &importer,
        "import \"./shared.clsw\" Settings;\nexport program App {\n  config Settings settings;\n  mode settings.mode { \"job\" => Missing; }\n}\n",
    )
    .unwrap();
    let missing_mode = Command::new(bin())
        .arg("check")
        .arg(&importer)
        .output()
        .unwrap();
    assert!(!missing_mode.status.success());
    let error = stderr(&missing_mode);
    assert!(
        error.contains("unknown mode Missing") || error.contains("Missing"),
        "{error}"
    );

    fs::write(&importer, "import \"./shared.clsw\" Absent;\n").unwrap();
    let missing_export = run_in(&dir, &["check", "app.clsw"]);
    assert!(!missing_export.status.success());
    let error = stderr(&missing_export);
    assert!(error.contains("app.clsw"), "{error}");
    assert!(error.contains("Absent"), "{error}");
    assert!(error.contains("shared.clsw"), "{error}");

    fs::write(&importer, "import \"./missing.clsw\" Settings;\n").unwrap();
    let missing_file = run_in(&dir, &["check", "app.clsw"]);
    let error = stderr(&missing_file);
    assert!(error.contains("app.clsw"), "{error}");
    assert!(error.contains("missing.clsw"), "{error}");

    let collided = check_source(
        "export config Settings { mode: (\"job\"); }\nimport \"./shared.clsw\" Settings;\n",
        "collision.clsw",
    );
    let error = collided.expect_err("collision");
    assert!(error.to_string().contains("Settings"), "{error}");

    let unnamed = check_source("export Absent;\n", "export.clsw");
    let error = unnamed.expect_err("missing export");
    assert!(error.to_string().contains("Absent"), "{error}");
}

#[test]
// req:application-shell-003
fn req_application_shell_003_matches_reached_settings_and_hides_secrets() {
    let source = r#"
export config Settings {
  mode: ("api" | "job");
  name: (string);
  secret token: (string);
  nested { port: (string); }
}
export mode Api: Web { controllers { Host http; } }
export mode Batch(name: (string)): Job { jobs { Host example; } }
export program App {
  config Settings settings;
  arguments { 0: settings.mode; }
  mode settings.mode {
    "api" => Api;
    "job" => Batch(settings.name);
  }
}
"#;
    let module = parse_source(source, "config.clsw").unwrap();
    let resolved = resolve_config(
        &module,
        &Input {
            arguments: vec!["job".into(), "--mode".into(), "api".into()],
            environment: vec![("MODE".into(), "job".into())],
        },
    )
    .unwrap();
    assert_eq!(resolved.label, "api");
    assert_eq!(resolved.settings["mode"], "api");
    assert!(resolved.settings.get("token").is_none());

    let from_env = resolve_config(
        &module,
        &Input {
            arguments: vec![],
            environment: vec![("MODE".into(), "api".into())],
        },
    )
    .unwrap();
    assert_eq!(from_env.label, "api");

    let positional = resolve_config(
        &module,
        &Input {
            arguments: vec!["job".into(), "--name".into(), "migrate".into()],
            environment: vec![],
        },
    )
    .unwrap();
    assert_eq!(positional.label, "job");
    assert_eq!(positional.job.as_deref(), Some("example"));

    let secret = resolve_config(
        &module,
        &Input {
            arguments: vec![
                "--mode".into(),
                "job".into(),
                "--token".into(),
                "s3cret".into(),
                "--name".into(),
                "migrate".into(),
            ],
            environment: vec![],
        },
    );
    let secret = secret.expect("an unreached secret is not required and is not resolved");
    assert!(
        !format!("{secret:?}").contains("s3cret"),
        "unreached secret leaked into {secret:?}"
    );
    let bad_secret = resolve_config(
        &module,
        &Input {
            arguments: vec![
                "--mode".into(),
                "api".into(),
                "--token".into(),
                "s3cret-value".into(),
            ],
            environment: vec![],
        },
    );
    // api does not reach token, so the secret is not required and its value is not diagnosed.
    assert!(bad_secret.is_ok(), "{}", bad_secret.err().unwrap());

    let leaked = resolve_config(
        &module,
        &Input {
            arguments: vec!["--mode".into(), "nope".into()],
            environment: vec![],
        },
    )
    .expect_err("invalid mode");
    assert!(!leaked.to_string().contains("nope"), "{leaked}");
    assert!(leaked.to_string().contains("mode"), "{leaked}");
}

#[test]
// req:application-shell-004
fn req_application_shell_004_selects_one_mode_and_one_job() {
    let source = r#"
export config Settings {
  mode: (string);
  jobName: (string);
}
export mode Batch(jobName: (string)): Job {
  jobs { First first; Second second; }
}
export program App {
  config Settings settings;
  mode settings.mode {
    "job" => Batch(settings.jobName);
    "job" => Batch(settings.jobName);
  }
}
"#;
    let error = check_source(source, "dup.clsw").expect_err("duplicate label");
    assert!(error.to_string().contains("job"), "{error}");

    let source = source.replace(
        "\"job\" => Batch(settings.jobName);\n    \"job\"",
        "\"other\" => Batch(settings.jobName);\n    \"job\"",
    );
    let module = parse_source(&source, "jobs.clsw").unwrap();
    let unknown = resolve_config(
        &module,
        &Input {
            arguments: vec![
                "--mode".into(),
                "missing".into(),
                "--job-name".into(),
                "first".into(),
            ],
            environment: vec![],
        },
    )
    .expect_err("unknown label");
    assert!(unknown.to_string().contains("job"), "{unknown}");
    assert!(unknown.to_string().contains("other"), "{unknown}");

    let selected = resolve_config(
        &module,
        &Input {
            arguments: vec![
                "--mode".into(),
                "job".into(),
                "--job-name".into(),
                "first".into(),
            ],
            environment: vec![],
        },
    )
    .unwrap();
    assert_eq!(selected.job.as_deref(), Some("first"));

    let unknown_job = resolve_config(
        &module,
        &Input {
            arguments: vec![
                "--mode".into(),
                "job".into(),
                "--job-name".into(),
                "third".into(),
            ],
            environment: vec![],
        },
    )
    .expect_err("unknown job");
    assert!(unknown_job.to_string().contains("first"), "{unknown_job}");
    assert!(unknown_job.to_string().contains("second"), "{unknown_job}");

    let mismatch = check_source(
        r#"
export config Settings { mode: ("job"); }
export mode Batch(name: (string)): Job { jobs { Only only; } }
export program App {
  config Settings settings;
  mode settings.mode { "job" => Batch; }
}
"#,
        "arity.clsw",
    )
    .expect_err("argument count");
    assert!(mismatch.to_string().contains("arguments"), "{mismatch}");
}

#[test]
// req:application-shell-005
fn req_application_shell_005_rejects_illegal_composition() {
    let wrong_section = check_source(
        r#"
export config Settings { mode: ("api"); }
export mode Api: Web { jobs { Host example; } }
export program App {
  config Settings settings;
  mode settings.mode { "api" => Api; }
}
"#,
        "section.clsw",
    )
    .expect_err("jobs in web");
    assert!(
        wrong_section.to_string().contains("cannot declare jobs"),
        "{wrong_section}"
    );

    let cycle = check_source(
        r#"
export config Settings { mode: ("api"); }
export mode Api: Web {
  services { A(b) a; B(a) b; }
  controllers { Host http; }
}
export program App {
  config Settings settings;
  mode settings.mode { "api" => Api; }
}
"#,
        "cycle.clsw",
    )
    .expect_err("cycle");
    assert!(cycle.to_string().contains("cycle"), "{cycle}");

    let aggregate = check_source(
        r#"
export context Shop { counter: Counter; }
aggregate Counter {
  identity id: (string) = "";
  start state Ready {}
}
export config Settings { mode: ("api"); }
export mode Api: Web {
  managers { Counter counter; }
  controllers { Host http; }
}
export program App {
  config Settings settings;
  mode settings.mode { "api" => Api; }
}
"#,
        "storage.clsw",
    )
    .expect_err("direct aggregate");
    assert!(aggregate.to_string().contains("aggregate"), "{aggregate}");
}

#[test]
// req:application-shell-007 req:compiler-001
fn req_application_shell_007_separates_parse_check_and_lowering() {
    let dir = temp("cli");
    let path = dir.join("app.clsw");
    fs::write(&path, SHELL).unwrap();
    let path = path.to_str().unwrap();

    let version = run(&["--version"]);
    assert!(version.status.success(), "{}", stderr(&version));
    assert_eq!(
        String::from_utf8_lossy(&version.stdout).trim(),
        env!("CARGO_PKG_VERSION")
    );

    let parsed = run(&["parse", path]);
    assert!(parsed.status.success(), "{}", stderr(&parsed));
    let tree: Json = serde_json::from_slice(&parsed.stdout).expect("syntax tree");
    assert_eq!(tree["kind"], "module");
    assert!(tree.get("declarations").is_some());

    let checked = run(&["check", path]);
    assert!(checked.status.success(), "{}", stderr(&checked));
    assert_eq!(String::from_utf8_lossy(&checked.stdout), "ok\n");

    let before = fs::read_dir(&dir).unwrap().count();
    let compiled = run(&["compile", path]);
    assert!(!compiled.status.success());
    assert!(
        stderr(&compiled).contains(LOWERING),
        "{}",
        stderr(&compiled)
    );
    assert_eq!(fs::read_dir(&dir).unwrap().count(), before);

    let ran = run(&["run", path]);
    assert!(!ran.status.success());
    assert!(stderr(&ran).contains(LOWERING), "{}", stderr(&ran));

    let fmt = run(&["fmt", path]);
    assert!(!fmt.status.success());
    let fmt_error = stderr(&fmt);
    assert!(fmt_error.contains("fmt"), "{fmt_error}");
    assert!(!fmt_error.contains("implemented"), "{fmt_error}");

    let unknown = run(&["nope"]);
    assert!(!unknown.status.success());

    let artifact = dir.join("app.clsw.ast");
    fs::write(&artifact, r#"{"version":"9.9.9"}"#).unwrap();
    let incompatible = run(&["run", artifact.to_str().unwrap()]);
    assert!(
        stderr(&incompatible).contains("incompatible artifact version"),
        "{}",
        stderr(&incompatible)
    );
    fs::write(
        &artifact,
        format!(
            r#"{{"version":"{}","dependencies":[{{"specifier":"./missing.clsw","present":false}}]}}"#,
            env!("CARGO_PKG_VERSION")
        ),
    )
    .unwrap();
    let stale = run(&["run", artifact.to_str().unwrap()]);
    assert!(
        stderr(&stale).contains("stale dependency ./missing.clsw"),
        "{}",
        stderr(&stale)
    );
}

#[test]
// req:application-shell-008
fn req_application_shell_008_rejects_typescript_hosts_without_starting_them() {
    let typescript =
        check_source("import \"./host.ts\" ExampleJob;\n", "host.clsw").expect_err("typescript");
    assert!(
        typescript.to_string().contains("TypeScript"),
        "{typescript}"
    );

    let custom = check_source(
        r#"
export config Settings { mode: ("job"); }
export mode Batch: Custom { jobs { ExampleJob example; } }
export program App {
  config Settings settings;
  mode settings.mode { "job" => Batch; }
}
"#,
        "custom.clsw",
    )
    .expect_err("custom kind");
    assert!(custom.to_string().contains("Custom"), "{custom}");

    let shadowed = check_source(
        "import \"./kinds.clsw\" Web;\nexport mode Api: Web { controllers { Host http; } }\n",
        "shadow.clsw",
    )
    .expect_err("shadow");
    assert!(
        shadowed.to_string().contains("shadowed") || shadowed.to_string().contains("Web"),
        "{shadowed}"
    );

    check_source(SHELL, "shell.clsw").expect("check does not start the host job");
}

#[test]
// req:application-shell-011 req:compiler-002
fn req_application_shell_011_checks_context_ports_and_sends() {
    let counter = include_str!("../examples/domain/counter-runtime.clsw");
    check_source(counter, "counter-runtime.clsw").expect("counter checks");

    let swapped = counter.replace(
        "counter: Counter;\n  manager: CounterManager(counter);",
        "manager: CounterManager(counter);\n  counter: Counter;",
    );
    check_source(&swapped, "order.clsw").expect("bindings resolve independent of order");

    let wrong_count = check_source(
        &counter.replace("CounterManager(counter)", "CounterManager"),
        "arity.clsw",
    )
    .expect_err("argument count");
    assert!(
        wrong_count.to_string().contains("dependencies"),
        "{wrong_count}"
    );

    let imported = {
        let dir = temp("context-import");
        fs::write(
            dir.join("shared.clsw"),
            "export aggregate Counter {\n  identity id: (string) = \"\";\n  start state Ready {}\n}\n",
        )
        .unwrap();
        fs::write(
            dir.join("app.clsw"),
            "import \"./shared.clsw\" Counter;\nexport context Shop { counter: Counter; }\n",
        )
        .unwrap();
        run_in(&dir, &["check", "app.clsw"])
    };
    assert!(!imported.status.success());
    assert!(
        stderr(&imported).contains("imported"),
        "{}",
        stderr(&imported)
    );

    let by_type = check_source(
        r#"
export context Shop {
  counter: Counter;
  manager: CounterManager(counter);
}
aggregate Counter {
  identity id: (string) = "";
  command Increment: (string);
  start state Ready {}
}
manager CounterManager(counter: Counter) {
  operation Increment {
    input: (string);
    result: (string);
    send Counter.Increment { identity: input; payload: input; }
  }
}
"#,
        "filter.clsw",
    )
    .expect_err("component filter");
    assert!(by_type.to_string().contains("port"), "{by_type}");

    let field = check_source(
        r#"
export context Shop { counter: Counter; }
aggregate Counter {
  identity id: (string) = "";
  field count: (number) = 0;
  field count: (number) = 1;
  event Incremented: (number);
  start state Ready {
    event Incremented { set missing = input; }
  }
}
"#,
        "fields.clsw",
    )
    .expect_err("fields");
    let message = field.to_string();
    assert!(message.contains("duplicate"), "{message}");
    assert!(message.contains("missing"), "{message}");
}

fn declaration<'a>(module: &'a Json, kind: &str, name: &str) -> &'a Json {
    module["declarations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|declaration| declaration["kind"] == kind && declaration["name"] == name)
        .unwrap_or_else(|| panic!("missing {kind} {name}"))
}

fn run_in(dir: &std::path::Path, args: &[&str]) -> std::process::Output {
    Command::new(bin())
        .current_dir(dir)
        .args(args)
        .output()
        .expect("run cslw")
}
