use cslw::cli::{parse_args, run};
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    match parse_args(&args).and_then(run) {
        Ok(output) => {
            print!("{}", output.text);
            ExitCode::from(output.code)
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(2)
        }
    }
}
