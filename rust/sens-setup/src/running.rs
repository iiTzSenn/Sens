use std::collections::BTreeSet;
use std::fs::OpenOptions;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, WPARAM};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE, QueryFullProcessImageNameW,
    TerminateProcess,
};
use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GW_OWNER, GetWindow, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, WM_CLOSE};
use windows::core::{BOOL, PWSTR};

use crate::progress::{self, CANCELLED, Report, Step};

const SHARING_VIOLATION: i32 = 32;
const PATIENCE: Duration = Duration::from_secs(30);
const GRACE: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_millis(250);
const STILL_OPEN: &str = "Sens sigue abierta y no se pudo cerrar";

pub enum Closing<'a> {
    Ask(&'a dyn Fn()),
    Wait(&'a dyn Fn()),
    Force,
}

pub fn is_open(app: &Path) -> bool {
    match OpenOptions::new().write(true).open(app) {
        Ok(_) => false,
        Err(error) => error.raw_os_error() == Some(SHARING_VIOLATION),
    }
}

pub fn settle(app: &Path, closing: &Closing, cancel: &AtomicBool, report: Report) -> Result<(), String> {
    if !is_open(app) {
        return Ok(());
    }
    report(Step::Close, 0.06, progress::WAITING);
    let closed = match closing {
        Closing::Ask(ask) => {
            ask();
            wait(app, None, cancel)?
        }
        Closing::Wait(ask) => {
            wait(app, Some(PATIENCE), cancel)? || {
                ask();
                wait(app, None, cancel)?
            }
        }
        Closing::Force => close(app, false) || close(app, true),
    };
    if !closed {
        return Err(STILL_OPEN.into());
    }
    report(Step::Close, 0.09, progress::CLOSED);
    Ok(())
}

pub fn close(app: &Path, force: bool) -> bool {
    let windows = top_windows();
    let ours = processes_of(app, &windows);
    for (window, process) in &windows {
        if ours.contains(process) && is_main(*window) {
            unsafe {
                let _ = PostMessageW(Some(*window), WM_CLOSE, WPARAM(0), LPARAM(0));
            }
        }
    }
    if force {
        ours.iter().for_each(|process| terminate(*process));
    }
    wait(app, Some(GRACE), &AtomicBool::new(false)).unwrap_or(false)
}

pub fn wait(app: &Path, limit: Option<Duration>, cancel: &AtomicBool) -> Result<bool, String> {
    let started = Instant::now();
    loop {
        if !is_open(app) {
            return Ok(true);
        }
        if cancel.load(Ordering::SeqCst) {
            return Err(CANCELLED.into());
        }
        if limit.is_some_and(|limit| started.elapsed() >= limit) {
            return Ok(false);
        }
        thread::sleep(POLL);
    }
}

fn top_windows() -> Vec<(HWND, u32)> {
    let mut found: Vec<(HWND, u32)> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut found as *mut Vec<(HWND, u32)> as isize));
    }
    found
}

unsafe extern "system" fn collect(window: HWND, found: LPARAM) -> BOOL {
    let found = unsafe { &mut *(found.0 as *mut Vec<(HWND, u32)>) };
    let mut process = 0u32;
    unsafe { GetWindowThreadProcessId(window, Some(&mut process)) };
    found.push((window, process));
    BOOL(1)
}

fn is_main(window: HWND) -> bool {
    unsafe { IsWindowVisible(window).as_bool() && GetWindow(window, GW_OWNER).is_err() }
}

fn processes_of(app: &Path, windows: &[(HWND, u32)]) -> BTreeSet<u32> {
    let wanted = app.to_string_lossy().to_lowercase();
    let candidates: BTreeSet<u32> = windows.iter().map(|(_, process)| *process).collect();
    candidates
        .into_iter()
        .filter(|process| image_of(*process).is_some_and(|image| image.to_lowercase() == wanted))
        .collect()
}

fn image_of(process: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process).ok()?;
        let mut buffer = [0u16; 1024];
        let mut length = buffer.len() as u32;
        let read = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut length);
        let _ = CloseHandle(handle);
        read.ok()?;
        Some(String::from_utf16_lossy(&buffer[..length as usize]))
    }
}

fn terminate(process: u32) {
    unsafe {
        if let Ok(handle) = OpenProcess(PROCESS_TERMINATE, false, process) {
            let _ = TerminateProcess(handle, 1);
            let _ = CloseHandle(handle);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs::{self, File};
    use std::os::windows::fs::OpenOptionsExt;
    use std::path::PathBuf;
    use std::sync::Mutex;
    use std::sync::atomic::AtomicUsize;

    use super::*;

    fn scratch_app(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sens-setup-running-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let app = dir.join("sens-app.exe");
        fs::write(&app, b"app").unwrap();
        app
    }

    fn held(app: &Path) -> File {
        OpenOptions::new().read(true).share_mode(1).open(app).unwrap()
    }

    #[test]
    fn an_exe_nobody_holds_is_not_open() {
        let app = scratch_app("free");

        assert!(!is_open(&app));
        assert!(!is_open(&app.with_file_name("missing.exe")));
        let _ = fs::remove_dir_all(app.parent().unwrap());
    }

    #[test]
    fn an_exe_held_without_write_sharing_counts_as_open() {
        let app = scratch_app("held");
        let lock = held(&app);

        assert!(is_open(&app));
        drop(lock);
        assert!(!is_open(&app));
        let _ = fs::remove_dir_all(app.parent().unwrap());
    }

    #[test]
    fn the_close_step_asks_once_and_goes_on_when_the_app_lets_go() {
        let app = scratch_app("asks");
        let lock = held(&app);
        let asked = AtomicUsize::new(0);
        let ask = || {
            asked.fetch_add(1, Ordering::SeqCst);
        };
        let lines = Mutex::new(Vec::new());
        let report = |_: Step, _: f64, line: &str| lines.lock().unwrap().push(line.to_string());

        let settled = thread::scope(|scope| {
            scope.spawn(move || {
                thread::sleep(Duration::from_millis(600));
                drop(lock);
            });
            settle(&app, &Closing::Ask(&ask), &AtomicBool::new(false), &report)
        });

        assert_eq!(settled, Ok(()));
        assert_eq!(asked.load(Ordering::SeqCst), 1);
        assert_eq!(*lines.lock().unwrap(), [progress::WAITING, progress::CLOSED]);
        let _ = fs::remove_dir_all(app.parent().unwrap());
    }

    #[test]
    fn an_update_waits_quietly_before_asking() {
        let app = scratch_app("waits");
        let lock = held(&app);
        let asked = AtomicUsize::new(0);
        let ask = || {
            asked.fetch_add(1, Ordering::SeqCst);
        };

        let settled = thread::scope(|scope| {
            scope.spawn(move || {
                thread::sleep(Duration::from_millis(600));
                drop(lock);
            });
            settle(&app, &Closing::Wait(&ask), &AtomicBool::new(false), &|_, _, _| {})
        });

        assert_eq!(settled, Ok(()));
        assert_eq!(asked.load(Ordering::SeqCst), 0);
        let _ = fs::remove_dir_all(app.parent().unwrap());
    }

    #[test]
    fn cancelling_while_waiting_for_the_app_rejects_with_cancelado() {
        let app = scratch_app("cancelled");
        let lock = held(&app);
        let cancel = AtomicBool::new(false);

        let settled = thread::scope(|scope| {
            scope.spawn(|| {
                thread::sleep(Duration::from_millis(400));
                cancel.store(true, Ordering::SeqCst);
            });
            settle(&app, &Closing::Ask(&|| {}), &cancel, &|_, _, _| {})
        });

        assert_eq!(settled, Err(CANCELLED.to_string()));
        drop(lock);
        let _ = fs::remove_dir_all(app.parent().unwrap());
    }

    #[test]
    fn closing_an_app_nobody_runs_finds_it_already_gone() {
        let app = scratch_app("nobody");

        assert!(close(&app, false));
        let _ = fs::remove_dir_all(app.parent().unwrap());
    }
}
