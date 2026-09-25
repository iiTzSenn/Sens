use std::fs::{self, File};
use std::path::Path;
use std::process::{Command, Output};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use sens_agent::{account, process, said};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{files, update, web};

const RELEASES: &str = "https://downloads.claude.ai/claude-code-releases";
const CHANNEL: &str = "latest";
const PLATFORM: &str = if cfg!(target_arch = "aarch64") { "win32-arm64" } else { "win32-x64" };
const FOLDER: &str = "claude-code";
const VERSION_CAP: u64 = 1024;
const DOWNLOAD_CAP: u64 = 1024 * web::MEGABYTE;
const CHECKSUM_LENGTH: usize = 64;
const RELEASE_TRIES: u32 = 12;
const RELEASE_PAUSE: Duration = Duration::from_millis(250);

static INSTALLING: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Downloading,
    Verifying,
    Installing,
    Updating,
}

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
pub struct Progress {
    stage: Stage,
    done: u64,
    total: u64,
}

impl Progress {
    fn at(stage: Stage) -> Self {
        Self { stage, done: 0, total: 0 }
    }
}

#[derive(Debug, PartialEq)]
struct Build {
    version: String,
    checksum: String,
    size: u64,
}

struct Claim;

impl Claim {
    fn take() -> Result<Self, String> {
        match INSTALLING.swap(true, Ordering::SeqCst) {
            true => Err(said!(
                en: "Claude Code is already being installed",
                es: "ya estoy instalando Claude Code",
                fr: "Claude Code est déjà en cours d’installation",
                de: "Claude Code wird bereits installiert",
                ja: "Claude Code はすでにインストール中です",
                zh: "Claude Code 正在安装中",
            )),
            false => Ok(Claim),
        }
    }
}

impl Drop for Claim {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::SeqCst);
    }
}

pub fn install(base: &Path, report: impl Fn(Progress)) -> Result<String, String> {
    let _claim = Claim::take()?;
    let build = newest()?;
    let folder = base.join(FOLDER);
    fs::create_dir_all(&folder).map_err(|error| files::uncreated(&folder, error))?;
    let downloaded = folder.join(format!("claude-{}-{PLATFORM}.exe", build.version));
    let outcome = fetch(&build, &downloaded, &report).and_then(|_| {
        report(Progress::at(Stage::Installing));
        set_up(&downloaded)
    });
    discard(&downloaded);
    outcome?;
    account::version().map_err(|reason| match process::native_folder() {
        Some(folder) => said!(
            en: "Claude Code was installed in {folder}, but it doesn’t start: {reason}",
            es: "Claude Code se instaló en {folder}, pero no arranca: {reason}",
            fr: "Claude Code a été installé dans {folder}, mais ne démarre pas : {reason}",
            de: "Claude Code wurde in {folder} installiert, startet aber nicht: {reason}",
            ja: "Claude Code を {folder} にインストールしましたが、起動しません: {reason}",
            zh: "Claude Code 已安装到 {folder}，但无法启动：{reason}",
            folder = folder.display(),
        ),
        None => reason,
    })
}

pub fn newer() -> Result<Option<String>, String> {
    let installed = account::version()?;
    let latest = latest()?;
    Ok(ahead(&installed, &latest).then_some(latest))
}

pub fn update(report: impl Fn(Progress)) -> Result<String, String> {
    let _claim = Claim::take()?;
    report(Progress::at(Stage::Updating));
    let finished = process::claude().arg("update").output().map_err(process::unlaunched)?;
    succeeded(
        finished,
        &said!(
            en: "Claude Code couldn’t be updated",
            es: "Claude Code no se pudo actualizar",
            fr: "Claude Code n’a pas pu être mis à jour",
            de: "Claude Code konnte nicht aktualisiert werden",
            ja: "Claude Code をアップデートできませんでした",
            zh: "无法更新 Claude Code",
        ),
    )?;
    account::version()
}

pub fn sweep(base: &Path) {
    let _ = fs::remove_dir_all(base.join(FOLDER));
}

fn latest() -> Result<String, String> {
    let said = web::text(&format!("{RELEASES}/{CHANNEL}"), VERSION_CAP)?;
    let version = said.trim();
    match plausible(version) {
        true => Ok(version.to_string()),
        false => Err(said!(
            en: "Anthropic didn’t say which version of Claude Code is the latest; the download may not be available in your country",
            es: "Anthropic no dijo cuál es la última versión de Claude Code; puede que la descarga no esté disponible en tu país",
            fr: "Anthropic n’a pas indiqué la dernière version de Claude Code ; le téléchargement n’est peut-être pas disponible dans votre pays",
            de: "Anthropic hat die neueste Version von Claude Code nicht genannt; vielleicht ist der Download in deinem Land nicht verfügbar",
            ja: "Anthropic から Claude Code の最新バージョンを取得できませんでした。お住まいの国ではダウンロードできない可能性があります",
            zh: "Anthropic 未告知 Claude Code 的最新版本；你所在的国家或地区可能无法下载",
        )),
    }
}

fn ahead(installed: &str, latest: &str) -> bool {
    match (update::number(installed), update::number(latest)) {
        (Some(installed), Some(latest)) => latest > installed,
        _ => false,
    }
}

fn newest() -> Result<Build, String> {
    let version = latest()?;
    let manifest = web::json(&format!("{RELEASES}/{version}/manifest.json"), &[])?;
    build(&version, &manifest).ok_or_else(|| {
        said!(
            en: "Anthropic doesn’t publish Claude Code {version} for this Windows",
            es: "Anthropic no publica Claude Code {version} para este Windows",
            fr: "Anthropic ne publie pas Claude Code {version} pour cette version de Windows",
            de: "Anthropic veröffentlicht Claude Code {version} nicht für dieses Windows",
            ja: "Anthropic はこの Windows 向けの Claude Code {version} を公開していません",
            zh: "Anthropic 未发布适用于此 Windows 的 Claude Code {version}",
        )
    })
}

fn plausible(version: &str) -> bool {
    let numbered = version.split(['-', '+']).next().unwrap_or_default();
    let parts: Vec<&str> = numbered.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
        && version.bytes().all(|byte| byte.is_ascii_alphanumeric() || b".-+".contains(&byte))
}

fn build(version: &str, manifest: &Value) -> Option<Build> {
    let entry = &manifest["platforms"][PLATFORM];
    let checksum = entry["checksum"].as_str()?.to_ascii_lowercase();
    let valid = checksum.len() == CHECKSUM_LENGTH && checksum.bytes().all(|byte| byte.is_ascii_hexdigit());
    valid.then(|| Build {
        version: version.to_string(),
        checksum,
        size: entry["size"].as_u64().unwrap_or_default(),
    })
}

fn fetch(build: &Build, path: &Path, report: &impl Fn(Progress)) -> Result<(), String> {
    let url = format!("{RELEASES}/{}/{PLATFORM}/claude.exe", build.version);
    let total = build.size;
    let shown = std::cell::Cell::new(u64::MAX);
    report(Progress { stage: Stage::Downloading, done: 0, total });
    web::save(&url, path, DOWNLOAD_CAP, |done| {
        let percent = (done * 100).checked_div(total).unwrap_or(done / web::MEGABYTE);
        if shown.replace(percent) != percent {
            report(Progress { stage: Stage::Downloading, done, total });
        }
    })?;
    report(Progress::at(Stage::Verifying));
    match digest(path)? == build.checksum {
        true => Ok(()),
        false => Err(said!(
            en: "the Claude Code download doesn’t match the one Anthropic publishes; it won’t be installed",
            es: "la descarga de Claude Code no coincide con la que publica Anthropic; no se instala",
            fr: "le téléchargement de Claude Code ne correspond pas à celui publié par Anthropic ; il ne sera pas installé",
            de: "der Download von Claude Code stimmt nicht mit dem von Anthropic veröffentlichten überein; er wird nicht installiert",
            ja: "Claude Code のダウンロードが Anthropic の公開しているものと一致しないため、インストールしません",
            zh: "Claude Code 的下载与 Anthropic 发布的版本不一致，因此不会安装",
        )),
    }
}

fn digest(path: &Path) -> Result<String, String> {
    let unread = |error: std::io::Error| {
        said!(
            en: "couldn’t read the download: {error}",
            es: "no pude leer la descarga: {error}",
            fr: "impossible de lire le téléchargement : {error}",
            de: "der Download konnte nicht gelesen werden: {error}",
            ja: "ダウンロードしたファイルを読み取れませんでした: {error}",
            zh: "无法读取下载的文件：{error}",
        )
    };
    let mut file = File::open(path).map_err(unread)?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(unread)?;
    Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

fn set_up(downloaded: &Path) -> Result<(), String> {
    let finished = process::hidden(&mut Command::new(downloaded))
        .args(["install", CHANNEL])
        .output()
        .map_err(|error| {
            said!(
                en: "couldn’t open the Claude Code installer: {error}",
                es: "no pude abrir el instalador de Claude Code: {error}",
                fr: "impossible d’ouvrir le programme d’installation de Claude Code : {error}",
                de: "das Installationsprogramm von Claude Code konnte nicht geöffnet werden: {error}",
                ja: "Claude Code のインストーラーを開けませんでした: {error}",
                zh: "无法打开 Claude Code 安装程序：{error}",
            )
        })?;
    succeeded(
        finished,
        &said!(
            en: "the Claude Code installer failed",
            es: "el instalador de Claude Code falló",
            fr: "le programme d’installation de Claude Code a échoué",
            de: "das Installationsprogramm von Claude Code ist fehlgeschlagen",
            ja: "Claude Code のインストーラーが失敗しました",
            zh: "Claude Code 安装程序运行失败",
        ),
    )
}

fn succeeded(finished: Output, failure: &str) -> Result<(), String> {
    if finished.status.success() {
        return Ok(());
    }
    let said = [finished.stderr, finished.stdout]
        .iter()
        .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
        .find_map(|text| last_line(&text));
    Err(match said {
        Some(line) => said!(
            en: "{failure}: {line}",
            es: "{failure}: {line}",
            fr: "{failure} : {line}",
            de: "{failure}: {line}",
            ja: "{failure}: {line}",
            zh: "{failure}：{line}",
        ),
        None => format!("{failure} ({})", finished.status),
    })
}

fn last_line(text: &str) -> Option<String> {
    text.lines().map(plain).map(|line| line.trim().to_string()).rfind(|line| !line.is_empty())
}

fn plain(line: &str) -> String {
    let mut kept = String::new();
    let mut letters = line.chars();
    while let Some(letter) = letters.next() {
        if letter != '\u{1b}' {
            kept.push(letter);
            continue;
        }
        if letters.next() == Some('[') {
            letters.by_ref().find(|code| code.is_ascii_alphabetic());
        }
    }
    kept
}

fn discard(downloaded: &Path) {
    for _ in 0..RELEASE_TRIES {
        if fs::remove_file(downloaded).is_ok() || !downloaded.exists() {
            return;
        }
        std::thread::sleep(RELEASE_PAUSE);
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;

    use super::*;

    const CHECKSUM: &str = "39BE063C2512B43347FE7B0AB18C46F1596141701C9C5FC895DDFCA9A051067C";

    fn manifest(checksum: &str) -> Value {
        json!({
            "version": "2.1.281",
            "platforms": {
                PLATFORM: { "binary": "claude.exe", "checksum": checksum, "size": 240_767_648u64 },
                "linux-x64": { "binary": "claude", "checksum": "0".repeat(64), "size": 1 }
            }
        })
    }

    #[test]
    fn only_a_bare_version_number_is_taken_from_the_download_site() {
        for good in ["2.1.281", "10.0.0", "2.1.281-beta.1"] {
            assert!(plausible(good), "{good}");
        }
        for bad in ["", "2.1", "latest", "<!DOCTYPE html>", "2.1.281/../../x", "2.1.x", "2..1", " 2.1.281"] {
            assert!(!plausible(bad), "{bad}");
        }
    }

    #[test]
    fn only_a_higher_published_version_is_an_update() {
        assert!(ahead("2.1.156", "2.1.281"));
        assert!(ahead("2.1.281", "2.2.0"));
        assert!(ahead("2.9.9", "10.0.0"));
        assert!(!ahead("2.1.281", "2.1.281"));
        assert!(!ahead("2.1.282", "2.1.281"));
        assert!(!ahead("2.1.281", "2.1.282-beta.1"));
        assert!(!ahead("", "2.1.281"));
    }

    #[test]
    fn the_manifest_gives_this_windows_its_checksum_and_size() {
        let found = build("2.1.281", &manifest(CHECKSUM)).unwrap();
        assert_eq!(found.checksum, CHECKSUM.to_ascii_lowercase());
        assert_eq!(found.size, 240_767_648);
        assert_eq!(found.version, "2.1.281");
    }

    #[test]
    fn a_manifest_without_a_sound_checksum_is_refused() {
        assert_eq!(build("2.1.281", &manifest("abc")), None);
        assert_eq!(build("2.1.281", &manifest(&"z".repeat(64))), None);
        assert_eq!(build("2.1.281", &json!({ "platforms": {} })), None);
    }

    #[test]
    fn the_checksum_is_the_sha256_of_the_file() {
        let path = std::env::temp_dir().join("sens-claude-code-digest.bin");
        fs::write(&path, b"abc").unwrap();
        assert_eq!(digest(&path).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn the_installer_complaint_is_its_last_plain_line() {
        let said = "Checking installation...\n\u{1b}[31m✘ Installation failed\u{1b}[39m\n\n";
        assert_eq!(last_line(said).as_deref(), Some("✘ Installation failed"));
        assert_eq!(last_line("\n  \n"), None);
    }

    #[test]
    fn the_progress_event_is_what_the_card_reads() {
        let downloading = Progress { stage: Stage::Downloading, done: 5, total: 10 };
        assert_eq!(serde_json::to_value(downloading).unwrap(), json!({ "stage": "downloading", "done": 5, "total": 10 }));
        assert_eq!(serde_json::to_value(Progress::at(Stage::Verifying)).unwrap()["stage"], "verifying");
        assert_eq!(serde_json::to_value(Progress::at(Stage::Installing)).unwrap()["stage"], "installing");
        assert_eq!(serde_json::to_value(Progress::at(Stage::Updating)).unwrap()["stage"], "updating");
    }

    #[test]
    fn only_one_install_runs_at_a_time() {
        let first = Claim::take().unwrap();
        assert!(Claim::take().is_err());
        drop(first);
        assert!(Claim::take().is_ok());
    }

    #[test]
    #[ignore]
    fn the_real_latest_build_is_offered_for_this_windows() {
        let found = newest().unwrap();
        assert!(found.size > 100 * web::MEGABYTE, "{found:?}");
        println!("{found:?}");
    }

    #[test]
    #[ignore]
    fn the_real_claude_code_says_whether_it_is_behind() {
        let installed = account::version().unwrap();
        let newer = newer().unwrap();
        assert_eq!(newer.is_some(), ahead(&installed, &latest().unwrap()));
        println!("Claude Code {installed}, más nuevo: {newer:?}");
    }

    #[test]
    #[ignore]
    fn the_real_install_lands_in_a_throwaway_profile() {
        let profile = std::env::temp_dir().join("sens-claude-code-profile");
        let base = std::env::temp_dir().join("sens-claude-code-base");
        let _ = fs::remove_dir_all(&profile);
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&profile).unwrap();
        unsafe {
            std::env::set_var("HOME", &profile);
            std::env::set_var("USERPROFILE", &profile);
            std::env::set_var("PATH", std::env::var_os("SystemRoot").map(|root| PathBuf::from(root).join("System32")).unwrap());
        }
        assert_eq!(process::located(), None);

        let heard = std::sync::Mutex::new(Vec::new());
        let version = install(&base, |progress| heard.lock().unwrap().push(progress)).unwrap();
        let heard = heard.into_inner().unwrap();

        assert!(plausible(&version), "{version}");
        assert_eq!(process::located(), Some(profile.join(".local").join("bin").join("claude.exe")));
        assert_eq!(heard.first().map(|progress| progress.stage), Some(Stage::Downloading));
        assert_eq!(heard.last().map(|progress| progress.stage), Some(Stage::Installing));
        assert!(heard.len() < 110, "{}", heard.len());
        assert!(fs::read_dir(base.join(FOLDER)).unwrap().next().is_none());
        println!("Claude Code {version} instalado en {}", profile.display());
    }
}
