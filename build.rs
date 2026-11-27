use std::path::PathBuf;
use std::process::Command;

fn main() {
    let manifest = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    for relative in [
        "src/grammar/application.uff",
        "src/grammar/domain.uff",
        "uffda.jsonc",
        "uffda.lock",
    ] {
        println!(
            "cargo:rerun-if-changed={}",
            manifest.join(relative).display()
        );
    }

    let ast_dir = manifest.join("bin/ast");
    if ast_dir.exists() {
        std::fs::remove_dir_all(&ast_dir).expect("clear previous Coleslaw grammar artifacts");
    }

    let output = Command::new("uffda")
        .current_dir(&manifest)
        .args([
            "compile",
            "--config",
            "uffda.jsonc",
            "src/grammar/application.uff",
            "src/grammar/domain.uff",
        ])
        .output()
        .unwrap_or_else(|error| {
            panic!("cslw build requires a released uffda CLI on PATH ({error})")
        });
    if !output.status.success() {
        panic!(
            "uffda compile failed while embedding the Coleslaw grammar\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let artifact_root = if has_ast(&ast_dir) {
        ast_dir
    } else {
        manifest.join("bin")
    };
    let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("languages.rs");
    uffda_build::embed(uffda_build::Embed {
        artifact_root,
        authored_root: None,
        logical_root: String::new(),
        out_file: out,
    })
    .expect("embed compiled Coleslaw grammar artifacts");
}

fn has_ast(directory: &std::path::Path) -> bool {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return false;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.ends_with(".uff.ast") {
            return true;
        }
        if entry.path().is_dir() && has_ast(&entry.path()) {
            return true;
        }
    }
    false
}
