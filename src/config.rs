use crate::error::Error;
use crate::parse::project_pattern;
use serde_json::{Map, Value as Json};
use std::collections::{BTreeMap, BTreeSet, HashMap};

#[derive(Debug, Default)]
pub struct Input {
    pub arguments: Vec<String>,
    pub environment: Vec<(String, String)>,
}

#[derive(Debug)]
pub struct Resolved {
    pub settings: Json,
    pub label: String,
    pub mode: String,
    pub job: Option<String>,
}

pub fn resolve_config(module: &Json, input: &Input) -> Result<Resolved, Error> {
    let program = one_program(module)?;
    let config_name = segments(program.get("config").unwrap_or(&Json::Null));
    let config = declaration(module, &config_name)
        .ok_or_else(|| Error::new(format!("unknown config {}", config_name.join("."))))?;
    if config.get("kind").and_then(Json::as_str) != Some("config") {
        return Err(Error::new(format!(
            "{} is not a config declaration",
            config_name.join(".")
        )));
    }
    let binding = program
        .get("configBinding")
        .and_then(Json::as_str)
        .unwrap_or("settings");
    let selector = segments(program.get("selector").unwrap_or(&Json::Null));
    let selector_path = strip_binding(&selector, binding);
    let settings = flatten_settings(config.get("settings").unwrap_or(&Json::Null), &[]);
    let known = settings
        .iter()
        .map(|setting| setting.path.join("."))
        .collect::<BTreeSet<_>>();
    let positionals = positional_bindings(&program);
    let parsed = parse_arguments(&input.arguments, &positionals, &known)?;
    let selections = program
        .get("selections")
        .and_then(Json::as_array)
        .cloned()
        .unwrap_or_default();
    validate_labels(&selections)?;

    let mut reached = BTreeSet::new();
    reached.insert(selector_path.join("."));
    let label_value = resolve_setting(module, &settings, &selector_path, &parsed, input, true)?;
    let label = label_value
        .as_str()
        .ok_or_else(|| {
            Error::new(format!(
                "Mode selector {} must resolve to a string label",
                selector_path.join(".")
            ))
        })?
        .to_string();
    let selection = selections
        .iter()
        .find(|selection| selection.get("label").and_then(Json::as_str) == Some(label.as_str()));
    let Some(selection) = selection else {
        let labels = selections
            .iter()
            .filter_map(|selection| selection.get("label").and_then(Json::as_str))
            .map(|label| format!("{label:?}"))
            .collect::<Vec<_>>()
            .join(", ");
        return Err(Error::new(format!(
            "No mode matches the configured selector; expected {labels}"
        )));
    };
    let mode_name = segments(selection.get("mode").unwrap_or(&Json::Null));
    let mode = declaration(module, &mode_name)
        .ok_or_else(|| Error::new(format!("unknown mode {}", mode_name.join("."))))?;
    if mode.get("kind").and_then(Json::as_str) != Some("mode") {
        return Err(Error::new(format!("{} is not a mode", mode_name.join("."))));
    }
    let parameters = mode
        .get("parameters")
        .and_then(Json::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let arguments = selection
        .get("arguments")
        .and_then(Json::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    if arguments.len() != parameters.len() {
        return Err(Error::new(format!(
            "mode {} expects {} arguments but the selection supplies {}",
            mode_name.join("."),
            parameters.len(),
            arguments.len()
        )));
    }
    for argument in arguments {
        collect_setting_paths(argument, binding, &mut reached);
    }
    let mut values = Map::new();
    for setting in &settings {
        let key = setting.path.join(".");
        if !reached.contains(&key) {
            continue;
        }
        if key == selector_path.join(".") {
            write_path(&mut values, &setting.path, label_value.clone());
            continue;
        }
        let value = resolve_setting(module, &settings, &setting.path, &parsed, input, true)?;
        write_path(&mut values, &setting.path, value);
    }
    let mut bindings = HashMap::new();
    bindings.insert(binding.to_string(), Json::Object(values.clone()));
    for (argument, parameter) in arguments.iter().zip(parameters.iter()) {
        let parameter_name = parameter
            .get("name")
            .and_then(Json::as_str)
            .unwrap_or("argument");
        let value = kith_runtime::host::evaluate(argument, &bindings)
            .map_err(|error| Error::new(error.to_string()))?;
        let pattern = parameter.get("pattern").unwrap_or(&Json::Null);
        let expanded = expand_pattern(pattern, module)?;
        if project_pattern(&expanded, &value)?.is_none() {
            return Err(Error::new(format!(
                "mode argument {parameter_name} does not match its pattern"
            )));
        }
    }
    let job = select_job(mode, arguments, &bindings)?;
    Ok(Resolved {
        settings: Json::Object(values),
        label,
        mode: mode
            .get("name")
            .and_then(Json::as_str)
            .unwrap_or("")
            .to_string(),
        job,
    })
}

struct SettingShape {
    path: Vec<String>,
    pattern: Json,
    secret: bool,
}

struct ParsedArgs {
    named: BTreeMap<String, String>,
    positional: BTreeMap<String, String>,
}

fn resolve_setting(
    module: &Json,
    settings: &[SettingShape],
    path: &[String],
    parsed: &ParsedArgs,
    input: &Input,
    required: bool,
) -> Result<Json, Error> {
    let key = path.join(".");
    let setting = settings.iter().find(|setting| setting.path == path);
    let Some(setting) = setting else {
        return Err(Error::new(format!("unknown setting {key}")));
    };
    let raw = parsed
        .named
        .get(&key)
        .cloned()
        .or_else(|| parsed.positional.get(&key).cloned())
        .or_else(|| environment_value(path, input));
    let expanded = expand_pattern(&setting.pattern, module)?;
    let projected = if let Some(raw) = raw.as_deref() {
        match project_pattern(&expanded, &Json::String(raw.to_string()))? {
            Some(value) => Some(value),
            None => {
                return Err(Error::new(setting_failure(setting, &key)));
            }
        }
    } else if required {
        project_absent(&expanded, setting, &key)?
    } else {
        None
    };
    projected.ok_or_else(|| Error::new(format!("missing setting {key}")))
}

fn project_absent(
    pattern: &Json,
    setting: &SettingShape,
    key: &str,
) -> Result<Option<Json>, Error> {
    if competing_defaults(pattern)? {
        return Err(Error::new(format!(
            "setting {key} has more than one default"
        )));
    }
    if let Some(value) = project_pattern(pattern, &Json::Null)? {
        return Ok(Some(value));
    }
    Err(Error::new(setting_failure(setting, key)))
}

fn competing_defaults(pattern: &Json) -> Result<bool, Error> {
    let Some(alternatives) = pattern.get("patterns").filter(|_| {
        pattern.get("kind").and_then(Json::as_str) == Some("or")
            || pattern.get("kind").and_then(Json::as_str) == Some("group")
    }) else {
        if pattern.get("kind").and_then(Json::as_str) == Some("group") {
            return competing_defaults(pattern.get("pattern").unwrap_or(&Json::Null));
        }
        return Ok(false);
    };
    if pattern.get("kind").and_then(Json::as_str) != Some("or") {
        return Ok(false);
    }
    let Some(alternatives) = alternatives.as_array() else {
        return Ok(false);
    };
    let mut matches = 0;
    for alternative in alternatives {
        if project_pattern(alternative, &Json::Null)?.is_some() {
            matches += 1;
        }
    }
    Ok(matches > 1)
}

fn setting_failure(setting: &SettingShape, key: &str) -> String {
    // The supplied value stays out of the diagnostic. A secret is named as
    // such so the failure still identifies the setting.
    if setting.secret {
        format!("secret setting {key} does not match its pattern")
    } else {
        format!("setting {key} does not match its pattern")
    }
}

fn environment_value(path: &[String], input: &Input) -> Option<String> {
    let name = environment_name(path);
    input
        .environment
        .iter()
        .find(|(key, _)| key == &name)
        .map(|(_, value)| value.clone())
}

pub fn flag_name(path: &[String]) -> String {
    format!(
        "--{}",
        path.iter()
            .map(|segment| kebab(segment))
            .collect::<Vec<_>>()
            .join(".")
    )
}

pub fn environment_name(path: &[String]) -> String {
    path.iter()
        .map(|segment| snake(segment))
        .collect::<Vec<_>>()
        .join("__")
}

fn kebab(segment: &str) -> String {
    let mut out = String::new();
    for ch in segment.chars() {
        if ch.is_uppercase() {
            out.push('-');
            out.extend(ch.to_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

fn snake(segment: &str) -> String {
    let mut out = String::new();
    for ch in segment.chars() {
        if ch.is_uppercase() {
            out.push('_');
            out.extend(ch.to_lowercase());
        } else {
            out.push(ch);
        }
    }
    out.to_uppercase()
}

fn parse_arguments(
    arguments: &[String],
    positionals: &[(usize, Vec<String>)],
    known: &BTreeSet<String>,
) -> Result<ParsedArgs, Error> {
    let mut named = BTreeMap::new();
    let mut rest = Vec::new();
    let mut positional_only = false;
    let mut index = 0;
    while index < arguments.len() {
        let argument = &arguments[index];
        if !positional_only && argument == "--" {
            positional_only = true;
            index += 1;
            continue;
        }
        if positional_only || !argument.starts_with("--") {
            rest.push(argument.clone());
            index += 1;
            continue;
        }
        let (flag, inline) = argument
            .split_once('=')
            .map(|(flag, value)| (flag.to_string(), Some(value.to_string())))
            .unwrap_or_else(|| (argument.clone(), None));
        let Some(path) = known_path_for_flag(&flag, known) else {
            return Err(Error::new(format!("Unknown setting flag {flag}")));
        };
        let key = path.join(".");
        if named.contains_key(&key) {
            return Err(Error::new(format!(
                "Setting {key} was supplied more than once"
            )));
        }
        let value = if let Some(value) = inline {
            value
        } else {
            let next = arguments.get(index + 1);
            if next.is_none_or(|value| value.starts_with("--")) {
                return Err(Error::new(format!("Expected a value after {flag}")));
            }
            index += 1;
            next.unwrap().clone()
        };
        named.insert(key, value);
        index += 1;
    }
    let mut positional = BTreeMap::new();
    for (slot, value) in rest.iter().enumerate() {
        let Some((_, path)) = positionals.iter().find(|(index, _)| *index == slot) else {
            return Err(Error::new(format!(
                "Unexpected positional argument {value:?}"
            )));
        };
        positional.insert(path.join("."), value.clone());
    }
    Ok(ParsedArgs { named, positional })
}

fn known_path_for_flag(flag: &str, known: &BTreeSet<String>) -> Option<Vec<String>> {
    for key in known {
        let path: Vec<String> = key.split('.').map(str::to_string).collect();
        if flag_name(&path) == flag {
            return Some(path);
        }
    }
    None
}

fn flatten_settings(members: &Json, prefix: &[String]) -> Vec<SettingShape> {
    let mut settings = Vec::new();
    let Some(members) = members.as_array() else {
        return settings;
    };
    for member in members {
        let Some(name) = member.get("name").and_then(Json::as_str) else {
            continue;
        };
        let mut path = prefix.to_vec();
        path.push(name.to_string());
        if member.get("kind").and_then(Json::as_str) == Some("group") {
            settings.extend(flatten_settings(
                member.get("settings").unwrap_or(&Json::Null),
                &path,
            ));
        } else {
            settings.push(SettingShape {
                path,
                pattern: member.get("pattern").cloned().unwrap_or(Json::Null),
                secret: member
                    .get("secret")
                    .and_then(Json::as_bool)
                    .unwrap_or(false),
            });
        }
    }
    settings
}

fn positional_bindings(program: &Json) -> Vec<(usize, Vec<String>)> {
    program
        .get("positionals")
        .and_then(Json::as_array)
        .into_iter()
        .flatten()
        .filter_map(|binding| {
            let index = binding.get("index").and_then(Json::as_u64)? as usize;
            let setting = binding.get("setting")?;
            let mut path = segments(setting);
            if !path.is_empty() {
                path.remove(0);
            }
            Some((index, path))
        })
        .collect()
}

fn validate_labels(selections: &[Json]) -> Result<(), Error> {
    if selections.is_empty() {
        return Err(Error::new("Program must map at least one mode label"));
    }
    let mut labels = BTreeSet::new();
    for selection in selections {
        let Some(label) = selection.get("label").and_then(Json::as_str) else {
            continue;
        };
        if !labels.insert(label.to_string()) {
            return Err(Error::new(format!(
                "Mode label {label:?} is declared more than once"
            )));
        }
    }
    Ok(())
}

fn select_job(
    mode: &Json,
    arguments: &[Json],
    bindings: &HashMap<String, Json>,
) -> Result<Option<String>, Error> {
    let kind = mode_kind_name(mode);
    if kind != "Job" {
        return Ok(None);
    }
    let jobs = job_names(mode);
    if jobs.is_empty() {
        return Err(Error::new("Job mode declares no jobs"));
    }
    if jobs.len() == 1 {
        return Ok(Some(jobs[0].clone()));
    }
    let selected = arguments.first().and_then(|argument| {
        kith_runtime::host::evaluate(argument, bindings)
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
    });
    let Some(selected) = selected else {
        return Err(Error::new(format!(
            "Select one job: {}",
            jobs.iter()
                .map(|job| format!("{job:?}"))
                .collect::<Vec<_>>()
                .join(", ")
        )));
    };
    if !jobs.iter().any(|job| job == &selected) {
        return Err(Error::new(format!(
            "Unknown selected job; available jobs: {}",
            jobs.iter()
                .map(|job| format!("{job:?}"))
                .collect::<Vec<_>>()
                .join(", ")
        )));
    }
    Ok(Some(selected))
}

fn job_names(mode: &Json) -> Vec<String> {
    let mut names = Vec::new();
    let Some(sections) = mode.get("sections").and_then(Json::as_array) else {
        return names;
    };
    for section in sections {
        if section.get("name").and_then(Json::as_str) != Some("jobs") {
            continue;
        }
        for binding in section
            .get("bindings")
            .and_then(Json::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(name) = binding.get("name").and_then(Json::as_str) {
                names.push(name.to_string());
            }
        }
    }
    names
}

pub fn mode_kind_name(mode: &Json) -> String {
    match mode.get("modeKind") {
        Some(Json::String(kind)) => kind.clone(),
        Some(value) => segments(value).join("."),
        None => String::new(),
    }
}

fn one_program(module: &Json) -> Result<Json, Error> {
    let programs = declarations(module)
        .filter(|declaration| declaration.get("kind").and_then(Json::as_str) == Some("program"))
        .cloned()
        .collect::<Vec<_>>();
    match programs.as_slice() {
        [program] => Ok(program.clone()),
        [] => Err(Error::new("module does not declare a program")),
        _ => Err(Error::new("module declares more than one program")),
    }
}

pub fn declarations(module: &Json) -> impl Iterator<Item = &Json> {
    module
        .get("declarations")
        .and_then(Json::as_array)
        .into_iter()
        .flatten()
}

pub fn declaration<'a>(module: &'a Json, path: &[String]) -> Option<&'a Json> {
    let name = path.last()?.as_str();
    declarations(module).find(|declaration| {
        declaration.get("kind").and_then(Json::as_str) != Some("export")
            && declaration.get("kind").and_then(Json::as_str) != Some("import")
            && declaration.get("name").and_then(Json::as_str) == Some(name)
    })
}

pub fn segments(value: &Json) -> Vec<String> {
    value
        .get("segments")
        .and_then(Json::as_array)
        .into_iter()
        .flatten()
        .filter_map(Json::as_str)
        .map(str::to_string)
        .collect()
}

fn strip_binding(selector: &[String], binding: &str) -> Vec<String> {
    if selector.first().map(String::as_str) == Some(binding) {
        selector[1..].to_vec()
    } else {
        selector.to_vec()
    }
}

fn collect_setting_paths(value: &Json, binding: &str, reached: &mut BTreeSet<String>) {
    if let Some(object) = value.as_object() {
        if object.get("kind").and_then(Json::as_str) == Some("member") {
            if let Some(path) = member_path(value) {
                if path.first().map(String::as_str) == Some(binding) && path.len() > 1 {
                    reached.insert(path[1..].join("."));
                }
            }
        }
        for child in object.values() {
            collect_setting_paths(child, binding, reached);
        }
    } else if let Some(items) = value.as_array() {
        for item in items {
            collect_setting_paths(item, binding, reached);
        }
    }
}

fn member_path(value: &Json) -> Option<Vec<String>> {
    let mut names = Vec::new();
    let mut cursor = value;
    loop {
        match cursor.get("kind").and_then(Json::as_str) {
            Some("member") => {
                names.push(cursor.get("name").and_then(Json::as_str)?.to_string());
                cursor = cursor.get("expression")?;
            }
            Some("reference") => {
                names.push(cursor.get("name").and_then(Json::as_str)?.to_string());
                names.reverse();
                return Some(names);
            }
            _ => return None,
        }
    }
}

fn write_path(target: &mut Map<String, Json>, path: &[String], value: Json) {
    if path.is_empty() {
        return;
    }
    if path.len() == 1 {
        target.insert(path[0].clone(), value);
        return;
    }
    let entry = target
        .entry(path[0].clone())
        .or_insert_with(|| Json::Object(Map::new()));
    if !entry.is_object() {
        *entry = Json::Object(Map::new());
    }
    if let Some(object) = entry.as_object_mut() {
        write_path(object, &path[1..], value);
    }
}

pub fn expand_pattern(pattern: &Json, module: &Json) -> Result<Json, Error> {
    let shapes = shape_map(module);
    expand_value(pattern, &shapes, &[])
}

fn shape_map(module: &Json) -> BTreeMap<String, Json> {
    let mut shapes = BTreeMap::new();
    if module.get("kind").and_then(Json::as_str) != Some("module") {
        return shapes;
    }
    for declaration in declarations(module) {
        if declaration.get("kind").and_then(Json::as_str) == Some("shape") {
            if let Some(name) = declaration.get("name").and_then(Json::as_str) {
                shapes.insert(
                    name.to_string(),
                    declaration.get("pattern").cloned().unwrap_or(Json::Null),
                );
            }
        }
    }
    shapes
}

fn expand_value(
    value: &Json,
    shapes: &BTreeMap<String, Json>,
    stack: &[String],
) -> Result<Json, Error> {
    match value {
        Json::Array(items) => {
            let mut expanded = Vec::new();
            for item in items {
                expanded.push(expand_value(item, shapes, stack)?);
            }
            Ok(Json::Array(expanded))
        }
        Json::Object(object) => {
            if object.get("kind").and_then(Json::as_str) == Some("resolve")
                && object.get("targetKind").and_then(Json::as_str) == Some("reference")
            {
                let name = object.get("name").and_then(Json::as_str).unwrap_or("");
                let args = object.get("args").and_then(Json::as_array);
                if args.is_some_and(|args| !args.is_empty()) {
                    return Err(Error::new(
                        "Named shapes do not accept pattern arguments".to_string(),
                    ));
                }
                if let Some(definition) = shapes.get(name) {
                    if stack.iter().any(|seen| seen == name) {
                        let mut cycle = stack.to_vec();
                        cycle.push(name.to_string());
                        return Err(Error::new(format!(
                            "Named shape cycle: {}",
                            cycle.join(" -> ")
                        )));
                    }
                    let mut next = stack.to_vec();
                    next.push(name.to_string());
                    return expand_value(definition, shapes, &next);
                }
                if name.chars().next().is_some_and(|ch| ch.is_uppercase()) {
                    return Err(Error::new(format!("Unknown named shape {name}")));
                }
            }
            let mut expanded = Map::new();
            for (key, child) in object {
                expanded.insert(key.clone(), expand_value(child, shapes, stack)?);
            }
            Ok(Json::Object(expanded))
        }
        other => Ok(other.clone()),
    }
}
