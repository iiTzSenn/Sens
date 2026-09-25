use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::Duration;

use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{MB_ICONINFORMATION, MB_OK, MessageBoxW, SW_SHOWNORMAL};
use windows::core::{HSTRING, w};
use winreg::RegKey;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

use crate::language::said;
use crate::progress;

pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DETACHED_PROCESS: u32 = 0x0000_0008;
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
const WEBVIEW_CLIENT: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
const WEBVIEW_DOWNLOAD: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

pub fn free_space(dir: &Path) -> Option<u64> {
    let existing = nearest_existing(dir)?;
    let mut free = 0u64;
    unsafe { GetDiskFreeSpaceExW(&HSTRING::from(existing.as_path()), Some(&mut free), None, None).ok()? };
    Some(free)
}

pub fn nearest_existing(dir: &Path) -> Option<PathBuf> {
    dir.ancestors().find(|ancestor| ancestor.is_dir()).map(Path::to_path_buf)
}

pub fn writable(dir: &Path) -> Result<(), String> {
    let probe = dir.join(format!(".sens-setup-{}.tmp", std::process::id()));
    fs::write(&probe, b"sens").map_err(|error| {
        let shown = dir.display();
        said!(
            en: "can’t write to {shown}: {error}",
            es: "no se puede escribir en {shown}: {error}",
            fr: "impossible d’écrire dans {shown} : {error}",
            de: "in {shown} kann nicht geschrieben werden: {error}",
            ja: "{shown} に書き込めません: {error}",
            zh: "无法写入 {shown}：{error}",
        )
    })?;
    let _ = fs::remove_file(&probe);
    Ok(())
}

pub fn file_size(path: &Path) -> u64 {
    fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

pub fn same_path(one: &Path, other: &Path) -> bool {
    match (fs::canonicalize(one), fs::canonicalize(other)) {
        (Ok(one), Ok(other)) => one == other,
        _ => one.to_string_lossy().to_lowercase() == other.to_string_lossy().to_lowercase(),
    }
}

pub fn remove_patiently(path: &Path) -> Result<(), String> {
    let mut tries = 0;
    loop {
        match fs::remove_file(path) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) if tries >= 20 => return Err(progress::cannot_delete(path, &error)),
            Err(_) => {
                tries += 1;
                thread::sleep(Duration::from_millis(100));
            }
        }
    }
}

pub fn webview_present() -> bool {
    let read = |hive, key: String| {
        RegKey::predef(hive)
            .open_subkey(key)
            .and_then(|opened| opened.get_value::<String, _>("pv"))
            .is_ok_and(|version| !version.trim().is_empty() && version.trim() != "0.0.0.0")
    };
    read(HKEY_LOCAL_MACHINE, format!(r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{WEBVIEW_CLIENT}"))
        || read(HKEY_CURRENT_USER, format!(r"Software\Microsoft\EdgeUpdate\Clients\{WEBVIEW_CLIENT}"))
}

pub fn explain_missing_webview() {
    alert(&said!(
        en: "Sens needs Microsoft Edge WebView2, the part of Windows that draws its window, and this computer doesn’t have it.\n\nPress OK to open Microsoft’s download page. Once it’s installed, open this installer again.",
        es: "Sens necesita Microsoft Edge WebView2, el componente de Windows que dibuja su ventana, y en este equipo no está.\n\nAl aceptar se abre la página de Microsoft para descargarlo. Cuando lo instales, vuelve a abrir este instalador.",
        fr: "Sens a besoin de Microsoft Edge WebView2, le composant de Windows qui affiche sa fenêtre, et il n’est pas installé sur cet ordinateur.\n\nCliquez sur OK pour ouvrir la page de téléchargement de Microsoft. Une fois WebView2 installé, rouvrez ce programme d’installation.",
        de: "Sens braucht Microsoft Edge WebView2, die Windows-Komponente, die sein Fenster darstellt, und auf diesem Computer fehlt sie.\n\nKlicke auf OK, um die Download-Seite von Microsoft zu öffnen. Sobald WebView2 installiert ist, öffne dieses Installationsprogramm erneut.",
        ja: "Sens のウィンドウを表示するには、Windows のコンポーネントである Microsoft Edge WebView2 が必要ですが、このコンピューターにはインストールされていません。\n\nOK を押すと Microsoft のダウンロードページが開きます。インストールが終わったら、このインストーラーをもう一度開いてください。",
        zh: "Sens 需要 Microsoft Edge WebView2 来显示窗口，这是 Windows 的一个组件，但这台电脑上没有安装。\n\n点击“确定”即可打开 Microsoft 的下载页面。安装完成后，请重新打开此安装程序。",
    ));
    unsafe {
        ShellExecuteW(None, w!("open"), &HSTRING::from(WEBVIEW_DOWNLOAD), None, None, SW_SHOWNORMAL);
    }
}

pub fn alert(text: &str) {
    unsafe {
        MessageBoxW(None, &HSTRING::from(text), w!("Sens"), MB_OK | MB_ICONINFORMATION);
    }
}

pub fn launch_detached(app: &Path, dir: &Path) -> Result<(), String> {
    let start = |flags: u32| Command::new(app).current_dir(dir).creation_flags(flags).spawn();
    start(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB)
        .or_else(|_| start(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP))
        .map(drop)
        .map_err(|error| {
            said!(
                en: "couldn’t open Sens: {error}",
                es: "no pude abrir Sens: {error}",
                fr: "impossible d’ouvrir Sens : {error}",
                de: "Sens konnte nicht geöffnet werden: {error}",
                ja: "Sens を開けませんでした: {error}",
                zh: "无法打开 Sens：{error}",
            )
        })
}

pub fn sweep_later(folders: &[&Path], files: &[&Path]) {
    if folders.is_empty() && files.is_empty() {
        return;
    }
    let mut line = String::from("/c ping -n 3 127.0.0.1 >nul");
    for folder in folders {
        line.push_str(&format!(" & rmdir /s /q \"{}\"", folder.display()));
    }
    for file in files {
        line.push_str(&format!(" & del /f /q \"{}\"", file.display()));
    }
    let _ = Command::new("cmd")
        .raw_arg(line)
        .current_dir(std::env::temp_dir())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}
