//! Coleslaw compiler. Parsing and checking use the embedded Uffda grammar.
//! Lowering a checked program to a Kith scene is the next step.

pub mod check;
pub mod cli;
pub mod config;
pub mod error;
pub mod parse;

pub use check::{check_file, check_source};
pub use config::{resolve_config, Input, Resolved};
pub use error::Error;
pub use parse::{parse_file, parse_source};

/// `compile` and `run` fail with this diagnostic until a program is lowered
/// to a Kith scene. They do not write an artifact or dispatch a scene.
pub const LOWERING: &str = "lowering this program to a Kith scene is the next step";
