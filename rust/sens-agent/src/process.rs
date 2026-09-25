use std::collections::BTreeMap;
use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::RwLock;

use crate::said;

pub const CLAUDE: &str = "claude";
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

#[cfg(windows)]
pub struct Family {
    job: Option<isize>,
}

#[cfg(windows)]
impl Family {
    pub fn around(child: &std::process::Child) -> Family {
        use std::os::windows::io::AsRawHandle;
        Family::of(child.as_raw_handle())
    }

    pub fn of(process: std::os::windows::io::RawHandle) -> Family {
        use windows::Win32::Foundation::{CloseHandle, HANDLE};
        use windows::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JobObjectExtendedLimitInformation, SetInformationJobObject,
        };
        use windows::core::PCWSTR;

        let Ok(job) = (unsafe { CreateJobObjectW(None, PCWSTR::null()) }) else {
            return Family { job: None };
        };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let joined = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                std::ptr::from_ref(&limits).cast(),
                size_of_val(&limits) as u32,
            )
            .and_then(|()| AssignProcessToJobObject(job, HANDLE(process)))
        };
        if joined.is_err() {
            let _ = unsafe { CloseHandle(job) };
            return Family { job: None };
        }
        Family { job: Some(job.0 as isize) }
    }

    pub fn end(&self) {
        if let Some(job) = self.job {
            let _ = unsafe { windows::Win32::System::JobObjects::TerminateJobObject(windows::Win32::Foundation::HANDLE(job as *mut _), 1) };
        }
    }
}

#[cfg(windows)]
impl Drop for Family {
    fn drop(&mut self) {
        if let Some(job) = self.job {
            let _ = unsafe { windows::Win32::Foundation::CloseHandle(windows::Win32::Foundation::HANDLE(job as *mut _)) };
        }
    }
}

#[cfg(not(windows))]
pub struct Family;

#[cfg(not(windows))]
impl Family {
    pub fn around(_child: &std::process::Child) -> Family {
        Family
    }

    pub fn end(&self) {}
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

fn missing() -> String {
    said!(
        en: "Claude Code wasn’t found on this computer: Sens installs it from Settings › Providers",
        es: "no encuentro Claude Code en este ordenador: Sens lo instala desde Ajustes › Proveedores",
        fr: "Claude Code est introuvable sur cet ordinateur : Sens l’installe depuis Paramètres › Fournisseurs",
        de: "Claude Code wurde auf diesem Computer nicht gefunden: Sens installiert es unter Einstellungen › Anbieter",
        ja: "このコンピューターに Claude Code が見つかりません。Sens の「設定 › プロバイダー」からインストールできます",
        zh: "这台电脑上找不到 Claude Code：可在 Sens 的“设置 › 提供商”中安装",
    )
}

fn unstarted(program: &str, error: &std::io::Error) -> String {
    said!(
        en: "couldn’t start {program}: {error}",
        es: "no pude lanzar {program}: {error}",
        fr: "impossible de lancer {program} : {error}",
        de: "{program} konnte nicht gestartet werden: {error}",
        ja: "{program} を起動できませんでした: {error}",
        zh: "无法启动 {program}：{error}",
    )
}

pub fn unheard(program: &str, error: impl std::fmt::Display) -> String {
    said!(
        en: "couldn’t talk to {program}: {error}",
        es: "no pude hablar con {program}: {error}",
        fr: "impossible de communiquer avec {program} : {error}",
        de: "Kommunikation mit {program} fehlgeschlagen: {error}",
        ja: "{program} と通信できませんでした: {error}",
        zh: "无法与 {program} 通信：{error}",
    )
}

pub fn no_input() -> String {
    said!(
        en: "Claude Code doesn’t accept input",
        es: "Claude Code no acepta entrada",
        fr: "Claude Code n’accepte pas d’entrée",
        de: "Claude Code nimmt keine Eingabe an",
        ja: "Claude Code が入力を受け付けません",
        zh: "Claude Code 不接受输入",
    )
}

pub fn no_output() -> String {
    said!(
        en: "Claude Code gives no output",
        es: "Claude Code no da salida",
        fr: "Claude Code ne renvoie aucune sortie",
        de: "Claude Code liefert keine Ausgabe",
        ja: "Claude Code から出力がありません",
        zh: "Claude Code 没有输出",
    )
}

pub fn unlaunched(error: std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => missing(),
        _ => unstarted(CLAUDE, &error),
    }
}

pub fn launched<T>(started: std::io::Result<T>) -> Result<Option<T>, String> {
    match started {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        started => started.map(Some).map_err(unlaunched),
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
        .map_err(|error| unstarted(&program, &error))?;

    child
        .stdin
        .take()
        .ok_or_else(|| {
            said!(
                en: "the process doesn’t accept input",
                es: "el proceso no acepta entrada",
                fr: "le processus n’accepte pas d’entrée",
                de: "der Prozess nimmt keine Eingabe an",
                ja: "プロセスが入力を受け付けません",
                zh: "该进程不接受输入",
            )
        })?
        .write_all(input.as_bytes())
        .map_err(|error| unheard(&program, error))?;

    let finished = child.wait_with_output().map_err(|error| {
        said!(
            en: "{program} crashed: {error}",
            es: "{program} se cayó: {error}",
            fr: "{program} s’est arrêté brutalement : {error}",
            de: "{program} ist abgestürzt: {error}",
            ja: "{program} が異常終了しました: {error}",
            zh: "{program} 崩溃了：{error}",
        )
    })?;

    if !finished.status.success() {
        let complaint = String::from_utf8_lossy(&finished.stderr);
        let complaint = complaint.trim();
        return Err(said!(
            en: "{program} failed: {complaint}",
            es: "{program} falló: {complaint}",
            fr: "{program} a échoué : {complaint}",
            de: "{program} ist fehlgeschlagen: {complaint}",
            ja: "{program} が失敗しました: {complaint}",
            zh: "{program} 运行失败：{complaint}",
        ));
    }

    Ok(String::from_utf8_lossy(&finished.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::language::{Language, speaking};

    #[cfg(windows)]
    fn outlived(name: &str, finish: impl FnOnce(Family)) -> bool {
        use std::os::windows::process::CommandExt;
        let here = std::env::temp_dir().join(format!("sens-process-{name}"));
        let _ = std::fs::remove_dir_all(&here);
        std::fs::create_dir_all(&here).unwrap();
        let said = here.join("nieto.txt");
        let mut child = hidden(&mut Command::new("cmd"))
            .raw_arg(format!("/c powershell -NoProfile -Command \"Set-Content -LiteralPath '{}' $PID; Start-Sleep 30\"", said.display()))
            .spawn()
            .unwrap();
        let family = Family::around(&child);
        let grandchild = (0..400)
            .find_map(|_| {
                std::thread::sleep(std::time::Duration::from_millis(50));
                std::fs::read_to_string(&said).ok()?.trim().parse::<u32>().ok()
            })
            .expect("el nieto no dijo su número");
        let alive = || {
            let listed = Command::new("tasklist").args(["/FI", &format!("PID eq {grandchild}"), "/NH"]).output().unwrap();
            String::from_utf8_lossy(&listed.stdout).contains(&grandchild.to_string())
        };
        assert!(alive());

        finish(family);
        let _ = child.kill();
        let _ = child.wait();

        let gone = (0..40).any(|_| {
            std::thread::sleep(std::time::Duration::from_millis(50));
            !alive()
        });
        if !gone {
            let _ = Command::new("taskkill").args(["/F", "/PID", &grandchild.to_string()]).output();
        }
        !gone
    }

    #[cfg(windows)]
    #[test]
    fn ending_a_family_ends_what_its_process_started_too() {
        assert!(!outlived("family-end", |family| family.end()), "el nieto que lanzó cmd sigue vivo");
    }

    #[cfg(windows)]
    #[test]
    fn letting_a_family_go_ends_it_as_when_sens_closes() {
        assert!(!outlived("family-drop", drop), "el nieto que lanzó cmd sigue vivo");
    }

    #[test]
    fn a_program_that_does_not_exist_says_so_instead_of_panicking() {
        let failure = speaking(Language::Es, || run(Command::new("sens-no-such-program-exists"), "").unwrap_err());
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
        let missing = || Err::<u8, _>(std::io::Error::from(std::io::ErrorKind::NotFound));
        let refused = || Err::<u8, _>(std::io::Error::from_raw_os_error(5));

        assert_eq!(launched(missing()), Ok(None));
        assert_eq!(launched(Ok(7)), Ok(Some(7)));
        let said = speaking(Language::Es, || launched(refused()).unwrap_err());
        assert!(said.starts_with("no pude lanzar claude: "), "{said}");
        assert!(!said.contains("instala"), "{said}");
    }

    #[test]
    fn a_missing_claude_code_is_told_in_the_language_spoken() {
        let missing = || unlaunched(std::io::Error::from(std::io::ErrorKind::NotFound));

        assert!(speaking(Language::Es, missing).starts_with("no encuentro Claude Code en este ordenador"));
        assert!(speaking(Language::En, missing).starts_with("Claude Code wasn’t found on this computer"));
        assert!(speaking(Language::De, missing).ends_with("Einstellungen › Anbieter"));
    }
}
