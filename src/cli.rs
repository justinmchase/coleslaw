use crate::check::{self, check_file};
use crate::error::Error;
use crate::parse::parse_file;
use crate::LOWERING;
use serde_json::Value as Json;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum Command {
    Parse { path: PathBuf },
    Check { path: PathBuf },
    Compile { path: PathBuf },
    Run { path: PathBuf },
    Version,
}

pub struct RunResult {
    pub text: String,
    pub code: u8,
}

pub fn parse_args(args: &[String]) -> Result<Command, Error> {
    let mut args = args.iter().skip(1);
    let command = args.next().ok_or_else(|| {
        Error::new("usage: cslw <parse|check|compile|run> <file> | cslw --version")
    })?;
    match command.as_str() {
        "--version" | "-V" => Ok(Command::Version),
        "parse" | "check" | "compile" | "run" => {
            let path = args
                .next()
                .ok_or_else(|| Error::new(format!("usage: cslw {command} <file>")))?;
            let path = PathBuf::from(path);
            Ok(match command.as_str() {
                "parse" => Command::Parse { path },
                "check" => Command::Check { path },
                "compile" => Command::Compile { path },
                "run" => Command::Run { path },
                _ => unreachable!(),
            })
        }
        "fmt" => Err(Error::new(
            "unknown command fmt; expected parse, check, compile, or run",
        )),
        other => Err(Error::new(format!(
            "unknown command {other}; expected parse, check, compile, or run"
        ))),
    }
}

pub fn run(command: Command) -> Result<RunResult, Error> {
    match command {
        Command::Version => Ok(RunResult {
            text: format!("{}\n", env!("CARGO_PKG_VERSION")),
            code: 0,
        }),
        Command::Parse { path } => {
            let tree = parse_file(&path)?;
            let text = serde_json::to_string_pretty(&tree)
                .map_err(|error| Error::new(error.to_string()))?;
            Ok(RunResult {
                text: format!("{text}\n"),
                code: 0,
            })
        }
        Command::Check { path } => {
            check_file(&path)?;
            Ok(RunResult {
                text: "ok\n".into(),
                code: 0,
            })
        }
        Command::Compile { path } => {
            refuse_until_lowered(&path)?;
            Err(Error::new(LOWERING))
        }
        Command::Run { path } => {
            if looks_like_artifact(&path) {
                return reject_artifact(&path);
            }
            refuse_until_lowered(&path)?;
            Err(Error::new(LOWERING))
        }
    }
}

fn refuse_until_lowered(path: &Path) -> Result<(), Error> {
    check::check_file(path)?;
    Ok(())
}

fn looks_like_artifact(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension == "ast")
        || path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(".clsw.ast"))
}

fn reject_artifact(path: &Path) -> Result<RunResult, Error> {
    let text = std::fs::read_to_string(path)
        .map_err(|error| Error::new(format!("cannot read {}: {error}", path.display())))?;
    let value = decode_artifact(&text)?;
    let version = value.get("version").and_then(Json::as_str).unwrap_or("");
    if version != env!("CARGO_PKG_VERSION") {
        return Err(Error::new(format!(
            "incompatible artifact version {version}; expected {}",
            env!("CARGO_PKG_VERSION")
        )));
    }
    if let Some(dependencies) = value.get("dependencies").and_then(Json::as_array) {
        for dependency in dependencies {
            if dependency.get("present").and_then(Json::as_bool) == Some(false) {
                let specifier = dependency
                    .get("specifier")
                    .and_then(Json::as_str)
                    .unwrap_or("<unknown>");
                return Err(Error::new(format!("stale dependency {specifier}")));
            }
        }
    }
    Err(Error::new(LOWERING))
}

fn decode_artifact(text: &str) -> Result<Json, Error> {
    if let Ok(value) = serde_json::from_str::<Json>(text) {
        return Ok(value);
    }
    kith_runtime::codec::decode(text).map_err(|error| Error::new(error.to_string()))
}
