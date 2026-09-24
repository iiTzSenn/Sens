use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::window::Color;
use tauri::{AppHandle, Emitter, RunEvent, State, Theme, WebviewUrl, WebviewWindowBuilder};

use crate::install::{self, Job, Place};
use crate::launch::{Launch, Mode};
use crate::layout::Layout;
use crate::log::Log;
use crate::look::{self, Look};
use crate::progress::Step;
use crate::registry::{self, Installed};
use crate::running::{self, Closing};
use crate::uninstall::{self, Removal};
use crate::{VERSION, demo, payload, system};

const BACKGROUND: Color = Color(0x0c, 0x0d, 0x0d, 0xff);

struct Setup {
    launch: Launch,
    layout: Mutex<Layout>,
    cancel: AtomicBool,
    placed: Mutex<Option<PathBuf>>,
    log: Log,
}

impl Setup {
    fn layout(&self) -> Layout {
        self.layout.lock().unwrap().clone()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupState {
    mode: Mode,
    version: &'static str,
    installed: Option<Installed>,
    dir: String,
    size: u64,
    free: Option<u64>,
    passive: bool,
    relaunch: bool,
    desktop: bool,
    demo: bool,
    look: Option<Look>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Choice {
    dir: String,
    desktop: bool,
    start_menu: bool,
    #[serde(default)]
    look: Option<Look>,
}

#[derive(Serialize, Clone)]
struct Progress<'a> {
    step: Step,
    progress: f64,
    line: &'a str,
}

#[derive(Serialize, Clone)]
struct Running {
    running: bool,
}

#[tauri::command]
fn setup_state(setup: State<Setup>) -> SetupState {
    let layout = setup.layout();
    let size = match setup.launch.mode {
        Mode::Uninstall => layout.placed_files().iter().map(|file| system::file_size(file)).sum(),
        _ => crate::needed(),
    };
    SetupState {
        mode: setup.launch.mode,
        version: VERSION,
        installed: registry::installed(&layout),
        dir: layout.dir.display().to_string(),
        size,
        free: system::free_space(&layout.dir),
        passive: setup.launch.passive,
        relaunch: setup.launch.relaunch,
        desktop: layout.desktop.exists(),
        demo: payload::embedded().is_none(),
        look: look::read(&layout.settings),
    }
}

#[tauri::command]
fn setup_dir(dir: String) -> Place {
    install::assess(Path::new(dir.trim()), crate::needed(), payload::embedded().is_some())
}

#[tauri::command(async)]
fn setup_install(app: AppHandle, setup: State<Setup>, choice: Choice) -> Result<(), String> {
    let dir = PathBuf::from(choice.dir.trim());
    if !dir.is_absolute() {
        return Err("elige una carpeta con su ruta completa".into());
    }
    setup.cancel.store(false, Ordering::SeqCst);
    let layout = {
        let mut current = setup.layout.lock().unwrap();
        *current = current.at(&dir);
        current.clone()
    };
    let report = reporter(&app, &setup.log);
    let Some(payload) = payload::embedded() else {
        return demo::install(&dir, choice.start_menu, choice.desktop, choice.look.is_some(), &setup.cancel, &report);
    };
    let exe = std::env::current_exe().map_err(|error| format!("no encuentro el instalador: {error}"))?;
    let ask = || ask_about_the_open_app(&app);
    let waits = setup.launch.passive || setup.launch.mode == Mode::Update;
    let job = Job {
        layout: &layout,
        payload,
        uninstaller: &exe,
        version: VERSION,
        start_menu: choice.start_menu,
        desktop: choice.desktop,
        update: setup.launch.mode == Mode::Update,
        placed: setup.placed.lock().unwrap().as_ref() == Some(&dir),
        closing: if waits { Closing::Wait(&ask) } else { Closing::Ask(&ask) },
        cancel: &setup.cancel,
        look: choice.look.as_ref(),
    };
    install::run(&job, &report).map_err(|failure| {
        if failure.placed {
            *setup.placed.lock().unwrap() = Some(dir.clone());
        }
        setup.log.write(&format!("Error: {}", failure.reason));
        failure.reason
    })
}

#[tauri::command(async)]
fn setup_uninstall(app: AppHandle, setup: State<Setup>, remove_data: bool) -> Result<(), String> {
    setup.cancel.store(false, Ordering::SeqCst);
    let layout = setup.layout();
    let report = reporter(&app, &setup.log);
    if payload::embedded().is_none() {
        return demo::uninstall(&layout.dir, remove_data, &report);
    }
    let ask = || ask_about_the_open_app(&app);
    let removal = Removal {
        layout: &layout,
        remove_data,
        closing: Closing::Ask(&ask),
        cancel: &setup.cancel,
    };
    uninstall::run(&removal, &report).inspect_err(|reason| setup.log.write(&format!("Error: {reason}")))
}

#[tauri::command]
fn setup_cancel(setup: State<Setup>) {
    setup.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command(async)]
fn setup_close_app(setup: State<Setup>, force: bool) -> bool {
    payload::embedded().is_none() || running::close(&setup.layout().app(), force)
}

#[tauri::command]
fn setup_launch(setup: State<Setup>) -> Result<(), String> {
    if payload::embedded().is_none() {
        return Ok(());
    }
    let layout = setup.layout();
    system::launch_detached(&layout.app(), &layout.dir)
}

#[tauri::command]
fn setup_quit(app: AppHandle) {
    app.exit(0);
}

fn reporter<'a>(app: &'a AppHandle, log: &'a Log) -> impl Fn(Step, f64, &str) + 'a {
    move |step, progress, line| {
        log.write(line);
        let _ = app.emit("setup", Progress { step, progress, line });
    }
}

fn ask_about_the_open_app(app: &AppHandle) {
    let _ = app.emit("setup-running", Running { running: true });
}

pub fn run(launch: Launch, layout: Layout, log: Log) {
    let webview = std::env::temp_dir().join(format!("sens-setup-webview-{}", std::process::id()));
    let title = if launch.mode == Mode::Uninstall { "Desinstalar Sens" } else { "Instalar Sens" };
    let data_directory = webview.clone();
    let setup = Setup {
        launch,
        layout: Mutex::new(layout),
        cancel: AtomicBool::new(false),
        placed: Mutex::new(None),
        log,
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(setup)
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("setup.html".into()))
                .title(title)
                .inner_size(880.0, 520.0)
                .resizable(false)
                .maximizable(false)
                .decorations(false)
                .shadow(true)
                .center()
                .visible(false)
                .background_color(BACKGROUND)
                .theme(Some(Theme::Dark))
                .data_directory(data_directory)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            setup_state,
            setup_dir,
            setup_install,
            setup_uninstall,
            setup_cancel,
            setup_close_app,
            setup_launch,
            setup_quit
        ])
        .build(tauri::generate_context!())
        .expect("sens setup")
        .run(move |_, event| {
            if let RunEvent::Exit = event {
                crate::sweep(&[&webview]);
            }
        });
}
