use std::collections::BTreeMap;
use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::RwLock;

pub const CLAUDE: &str = "claude";
const MISSING: &str = "no encuentro Claude Code en este ordenador: Sens lo instala desde Ajustes › Proveedores";
const EXECUTABLE: &str = if cfg!(windows) { "claude.exe" } else { "claude" };
const NPM_PACKAGE: [&str; 4] = ["node_modules", "@anthropic-ai", "claude-code", "bin"];

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

fn homes() -> Vec<PathBuf> {
    let declared = std::env::var_os("HOME").filter(|home| !home.is_empty()).map(PathBuf::from);
    declared.into_iter().chain(std::env::home_dir()).collect()
}

fn native(home: PathBuf) -> PathBuf {
    home.join(".local").join("bin")
}

pub fn native_folder() -> Option<PathBuf> {
    homes().into_iter().next().map(native)
}

fn known_folders() -> Vec<PathBuf> {
    let under = |variable: &str, parts: &[&str]| {
        std::env::var_os(variable).map(|root| parts.iter().fold(PathBuf::from(root), |path, part| path.join(part)))
    };
    let installers = [
        under("APPDATA", &["npm"]),
        under("LOCALAPPDATA", &["Microsoft", "WinGet", "Links"]),
    ];
    homes().into_iter().map(native).chain(installers.into_iter().flatten()).collect()
}

fn inside(folder: &Path) -> Option<PathBuf> {
    let direct = folder.join(EXECUTABLE);
    if direct.is_file() {
        return Some(direct);
    }
    let packaged = NPM_PACKAGE.iter().fold(folder.to_path_buf(), |path, part| path.join(part)).join(EXECUTABLE);
    packaged.is_file().then_some(packaged)
}

fn locate(searched: Option<OsString>, known: &[PathBuf]) -> Option<PathBuf> {
    let listed: Vec<PathBuf> = searched.map(|path| std::env::split_paths(&path).collect()).unwrap_or_default();
    listed
        .iter()
        .chain(known)
        .filter(|folder| folder.is_absolute())
        .find_map(|folder| inside(folder))
}

pub fn located() -> Option<PathBuf> {
    locate(std::env::var_os("PATH"), &known_folders())
}

pub fn program() -> PathBuf {
    located().unwrap_or_else(|| PathBuf::from(CLAUDE))
}

pub fn unlaunched(error: std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => MISSING.to_string(),
        _ => format!("no pude lanzar {CLAUDE}: {error}"),
    }
}

pub fn claude() -> Command {
    let mut command = Command::new(program());
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

        assert_eq!(Path::new(command.get_program()).file_stem().and_then(|stem| stem.to_str()), Some(CLAUDE));
        assert_eq!(carried, vec![("ANTHROPIC_API_KEY", "sk-ant-prueba")]);
        assert!(claude().get_envs().next().is_none());
    }

    fn folder(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("sens-locate-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn planted(folder: &Path, parts: &[&str]) -> PathBuf {
        let file = parts.iter().fold(folder.to_path_buf(), |path, part| path.join(part)).join(EXECUTABLE);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, b"").unwrap();
        file
    }

    fn joined(folders: &[&Path]) -> Option<OsString> {
        std::env::join_paths(folders).ok()
    }

    #[test]
    fn claude_is_found_on_the_path_before_the_known_folders() {
        let listed = folder("listed");
        let native = folder("native");
        let wanted = planted(&listed, &[]);
        planted(&native, &[]);

        assert_eq!(locate(joined(&[&listed]), std::slice::from_ref(&native)), Some(wanted));
    }

    #[test]
    fn the_official_installer_folder_counts_even_when_it_is_not_on_the_path() {
        let elsewhere = folder("elsewhere");
        let native = folder("native-only");
        let wanted = planted(&native, &[]);

        assert_eq!(locate(joined(&[&elsewhere]), std::slice::from_ref(&native)), Some(wanted.clone()));
        assert_eq!(locate(None, &[native]), Some(wanted));
    }

    #[test]
    fn an_npm_install_is_found_through_its_packaged_binary() {
        let npm = folder("npm");
        std::fs::write(npm.join("claude.cmd"), b"").unwrap();
        let wanted = planted(&npm, &NPM_PACKAGE);

        assert_eq!(locate(joined(&[&npm]), &[]), Some(wanted));
    }

    #[test]
    fn nothing_installed_and_relative_folders_find_nothing() {
        let empty = folder("empty");
        assert_eq!(locate(joined(&[&empty, Path::new("relativo")]), std::slice::from_ref(&empty)), None);
        assert_eq!(locate(None, &[]), None);
    }

    #[test]
    fn only_a_missing_program_reads_as_not_installed() {
        let missing = unlaunched(std::io::Error::from(std::io::ErrorKind::NotFound));
        let refused = unlaunched(std::io::Error::from_raw_os_error(5));

        assert!(missing.starts_with("no encuentro Claude Code"), "{missing}");
        assert!(refused.starts_with("no pude lanzar claude: "), "{refused}");
        assert!(!refused.contains("instala"), "{refused}");
    }
}
