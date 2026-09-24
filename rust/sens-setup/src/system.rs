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

pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DETACHED_PROCESS: u32 = 0x0000_0008;
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
const WEBVIEW_CLIENT: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
const WEBVIEW_DOWNLOAD: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
const WEBVIEW_MISSING: &str = "Sens necesita Microsoft Edge WebView2, el componente de Windows que dibuja su ventana, y en este equipo no está.\n\nAl aceptar se abre la página de Microsoft para descargarlo. Cuando lo instales, vuelve a abrir este instalador.";

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
    fs::write(&probe, b"sens").map_err(|error| format!("no se puede escribir en {}: {error}", dir.display()))?;
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
            Err(error) if tries >= 20 => return Err(format!("no pude borrar {}: {error}", path.display())),
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
    alert(WEBVIEW_MISSING);
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
        .map_err(|error| format!("no pude abrir Sens: {error}"))
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
