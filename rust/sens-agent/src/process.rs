use std::collections::BTreeMap;
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::RwLock;

pub const CLAUDE: &str = "claude";

static ENVIRONMENT: RwLock<BTreeMap<String, String>> = RwLock::new(BTreeMap::new());

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

pub fn set_environment(values: BTreeMap<String, String>) {
    if let Ok(mut kept) = ENVIRONMENT.write() {
        *kept = values;
    }
}

pub fn environment() -> BTreeMap<String, String> {
    ENVIRONMENT.read().map(|kept| kept.clone()).unwrap_or_default()
}

pub fn claude() -> Command {
    let mut command = Command::new(CLAUDE);
    hidden(&mut command).envs(environment());
    command
}

pub fn run(mut command: Command, input: &str) -> Result<String, String> {
    let program = command.get_program().to_string_lossy().into_owned();
    let mut child = command
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
        let failure = run(Command::new("sens-no-such-program-exists"), "").unwrap_err();
        assert!(failure.contains("no pude lanzar"));
    }

    #[test]
    fn the_host_environment_rides_on_every_claude_it_launches() {
        set_environment(BTreeMap::from([("ANTHROPIC_API_KEY".to_string(), "sk-ant-prueba".to_string())]));
        let command = claude();
        let carried: Vec<_> = command.get_envs().filter_map(|(key, value)| Some((key.to_str()?, value?.to_str()?))).collect();
        set_environment(BTreeMap::new());

        assert_eq!(command.get_program(), CLAUDE);
        assert_eq!(carried, vec![("ANTHROPIC_API_KEY", "sk-ant-prueba")]);
        assert!(claude().get_envs().next().is_none());
    }
}
