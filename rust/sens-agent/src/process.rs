use std::io::Write;
use std::process::{Command, Stdio};

pub const CLAUDE: &str = "claude";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

pub fn run(program: &str, args: &[String], input: &str) -> Result<String, String> {
    let mut child = hidden(&mut Command::new(program))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("no pude lanzar {program}: {error}"))?;

    child
        .stdin
        .take()
        .ok_or("el proceso no acepta entrada")?
        .write_all(input.as_bytes())
        .map_err(|error| format!("no pude hablar con {program}: {error}"))?;

    let finished = child
        .wait_with_output()
        .map_err(|error| format!("{program} se cayó: {error}"))?;

    if !finished.status.success() {
        let complaint = String::from_utf8_lossy(&finished.stderr);
        return Err(format!("{program} falló: {}", complaint.trim()));
    }

    Ok(String::from_utf8_lossy(&finished.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_program_that_does_not_exist_says_so_instead_of_panicking() {
        let failure = run("sens-no-such-program-exists", &[], "").unwrap_err();
        assert!(failure.contains("no pude lanzar"));
    }
}
