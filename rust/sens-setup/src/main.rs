#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod demo;
mod install;
mod language;
mod launch;
mod layout;
mod log;
mod look;
mod payload;
mod progress;
mod registry;
mod running;
mod shortcut;
mod system;
mod uninstall;
mod window;

use std::path::Path;
use std::process::ExitCode;
use std::sync::atomic::AtomicBool;

use install::Job;
use language::said;
use launch::{Launch, Mode};
use layout::Layout;
use log::Log;
use running::Closing;
use uninstall::Removal;

const VERSION: &str = env!("SENS_VERSION");

fn main() -> ExitCode {
    language::set(language::system());
    let exe = std::env::current_exe().unwrap_or_default();
    let launch = launch::read(&exe, std::env::args_os().skip(1));
    let layout = match Layout::for_user(launch.dir.clone()) {
        Ok(layout) => layout,
        Err(reason) => return refuse(&launch, &reason),
    };
    if let Some(saved) = language::read(&layout.settings) {
        language::set(saved);
    }
    if launch.mode == Mode::Uninstall {
        let _ = std::env::set_current_dir(std::env::temp_dir());
        if payload::embedded().is_some() && uninstall::runs_inside(&exe, &layout.dir) {
            return match uninstall::relocate(&exe, &layout.dir, launch.silent) {
                Ok(()) => ExitCode::SUCCESS,
                Err(reason) => refuse(&launch, &reason),
            };
        }
    }
    let log = journal(&launch);
    if launch.silent {
        return quietly(&launch, &layout, &exe, &log);
    }
    if !system::webview_present() {
        system::explain_missing_webview();
        return ExitCode::FAILURE;
    }
    window::run(launch, layout, log);
    ExitCode::SUCCESS
}

fn quietly(launch: &Launch, layout: &Layout, exe: &Path, log: &Log) -> ExitCode {
    let report = |_: progress::Step, _: f64, line: &str| log.write(line);
    let cancel = AtomicBool::new(false);
    let done = match (launch.mode, payload::embedded()) {
        (Mode::Uninstall, None) => demo::uninstall(&layout.dir, false, &report),
        (_, None) => {
            let asked = demo::Asked {
                start_menu: true,
                desktop: false,
                look: false,
                language: false,
            };
            demo::install(&layout.dir, &asked, &cancel, &report)
        }
        (Mode::Uninstall, Some(_)) => {
            let removal = Removal {
                layout,
                remove_data: false,
                closing: Closing::Force,
                cancel: &cancel,
            };
            uninstall::run(&removal, &report)
        }
        (mode, Some(payload)) => {
            let job = Job {
                layout,
                payload,
                uninstaller: exe,
                version: VERSION,
                start_menu: true,
                desktop: layout.desktop.exists(),
                update: mode == Mode::Update,
                placed: false,
                closing: Closing::Force,
                cancel: &cancel,
                look: None,
                language: None,
            };
            install::run(&job, &report)
                .map_err(|failure| failure.reason)
                .and_then(|()| if launch.relaunch { system::launch_detached(&layout.app(), &layout.dir) } else { Ok(()) })
        }
    };
    sweep(&[]);
    match done {
        Ok(()) => ExitCode::SUCCESS,
        Err(reason) => {
            log.write(&progress::error(&reason));
            ExitCode::FAILURE
        }
    }
}

fn refuse(launch: &Launch, reason: &str) -> ExitCode {
    if !launch.silent {
        system::alert(reason);
    }
    ExitCode::FAILURE
}

fn journal(launch: &Launch) -> Log {
    if payload::embedded().is_none() {
        return Log::quiet();
    }
    let doing = match launch.mode {
        Mode::Install => said!(en: "install", es: "instalar", fr: "installer", de: "installieren", ja: "インストール", zh: "安装"),
        Mode::Update => said!(en: "update", es: "actualizar", fr: "mettre à jour", de: "aktualisieren", ja: "アップデート", zh: "更新"),
        Mode::Uninstall => said!(en: "uninstall", es: "desinstalar", fr: "désinstaller", de: "deinstallieren", ja: "アンインストール", zh: "卸载"),
    };
    Log::open(&format!("Sens {VERSION} · {doing}"))
}

fn needed() -> u64 {
    let app = payload::embedded().map_or(Ok(demo::SIZE), payload::size).unwrap_or(0);
    let own = std::env::current_exe().map(|exe| system::file_size(&exe)).unwrap_or(0);
    app + own
}

fn sweep(folders: &[&Path]) {
    let exe = std::env::current_exe().ok().filter(|exe| uninstall::is_relocated(exe));
    let files: Vec<&Path> = exe.iter().map(|exe| exe.as_path()).collect();
    system::sweep_later(folders, &files);
}
