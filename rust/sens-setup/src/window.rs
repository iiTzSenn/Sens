use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::window::Color;
use tauri::{AppHandle, Emitter, RunEvent, State, Theme, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::demo::Asked;
use crate::install::{self, Job, Place};
use crate::language::{self, Language, said};
use crate::launch::{Launch, Mode};
use crate::layout::Layout;
use crate::log::Log;
use crate::look::{self, Look};
use crate::progress::{self, CANCELLED, Step};
use crate::registry::{self, Installed};
use crate::running::{self, Closing};
use crate::uninstall::{self, Removal};
use crate::{VERSION, demo, payload, system};

const BACKGROUND: Color = Color(0x0c, 0x0d, 0x0d, 0xff);
const HANDOFF: Duration = Duration::from_secs(8);

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
    #[serde(default)]
    language: Option<Language>,
}

#[derive(Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
struct Stopped {
    cancelled: bool,
    reason: String,
}

impl From<String> for Stopped {
    fn from(reason: String) -> Stopped {
        Stopped {
            cancelled: reason == CANCELLED,
            reason,
        }
    }
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

#[tauri::command]
fn setup_language(window: WebviewWindow, setup: State<Setup>, language: Language) {
    language::set(language);
    let _ = window.set_title(&title(setup.launch.mode));
}

#[tauri::command(async)]
fn setup_install(app: AppHandle, setup: State<Setup>, choice: Choice) -> Result<(), Stopped> {
    let dir = PathBuf::from(choice.dir.trim());
    if !dir.is_absolute() {
        return Err(progress::not_absolute().into());
    }
    setup.cancel.store(false, Ordering::SeqCst);
    let layout = {
        let mut current = setup.layout.lock().unwrap();
        *current = current.at(&dir);
        current.clone()
    };
    let report = reporter(&app, &setup.log);
    let Some(payload) = payload::embedded() else {
        let asked = Asked {
            start_menu: choice.start_menu,
            desktop: choice.desktop,
            look: choice.look.is_some(),
            language: choice.language.is_some(),
        };
        return demo::install(&dir, &asked, &setup.cancel, &report).map_err(Stopped::from);
    };
    let exe = std::env::current_exe().map_err(|error| {
        said!(
            en: "can’t find the installer: {error}",
            es: "no encuentro el instalador: {error}",
            fr: "impossible de trouver le programme d’installation : {error}",
            de: "das Installationsprogramm wurde nicht gefunden: {error}",
            ja: "インストーラーが見つかりません: {error}",
            zh: "找不到安装程序：{error}",
        )
    })?;
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
        language: choice.language,
    };
    install::run(&job, &report).map_err(|failure| {
        if failure.placed {
            *setup.placed.lock().unwrap() = Some(dir.clone());
        }
        setup.log.write(&progress::error(&failure.reason));
        Stopped::from(failure.reason)
    })
}

#[tauri::command(async)]
fn setup_uninstall(app: AppHandle, setup: State<Setup>, remove_data: bool) -> Result<(), Stopped> {
    setup.cancel.store(false, Ordering::SeqCst);
    let layout = setup.layout();
    let report = reporter(&app, &setup.log);
    if payload::embedded().is_none() {
        return demo::uninstall(&layout.dir, remove_data, &report).map_err(Stopped::from);
    }
    let ask = || ask_about_the_open_app(&app);
    let removal = Removal {
        layout: &layout,
        remove_data,
        closing: Closing::Ask(&ask),
        cancel: &setup.cancel,
    };
    uninstall::run(&removal, &report)
        .inspect_err(|reason| setup.log.write(&progress::error(reason)))
        .map_err(Stopped::from)
}

#[tauri::command]
fn setup_cancel(setup: State<Setup>) {
    setup.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command(async)]
fn setup_close_app(setup: State<Setup>, force: bool) -> bool {
    payload::embedded().is_none() || running::close(&setup.layout().app(), force)
}

#[tauri::command(async)]
fn setup_launch(setup: State<Setup>) -> Result<(), String> {
    if payload::embedded().is_none() {
        std::thread::sleep(Duration::from_millis(900));
        return Ok(());
    }
    let layout = setup.layout();
    system::launch_detached(&layout.app(), &layout.dir)?;
    running::shown(&layout.app(), HANDOFF);
    Ok(())
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

fn title(mode: Mode) -> String {
    match mode {
        Mode::Uninstall => said!(
            en: "Uninstall Sens",
            es: "Desinstalar Sens",
            fr: "Désinstaller Sens",
            de: "Sens deinstallieren",
            ja: "Sens をアンインストール",
            zh: "卸载 Sens",
        ),
        Mode::Install | Mode::Update => said!(
            en: "Install Sens",
            es: "Instalar Sens",
            fr: "Installer Sens",
            de: "Sens installieren",
            ja: "Sens をインストール",
            zh: "安装 Sens",
        ),
    }
}

pub fn run(launch: Launch, layout: Layout, log: Log) {
    let webview = std::env::temp_dir().join(format!("sens-setup-webview-{}", std::process::id()));
    let title = title(launch.mode);
    let spoken = language::script(language::read(&layout.settings));
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
                .initialization_script(spoken)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            setup_state,
            setup_dir,
            setup_language,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::language::speaking;

    #[test]
    fn a_cancelled_run_says_so_with_a_flag_and_not_with_words() {
        assert_eq!(
            Stopped::from(CANCELLED.to_string()),
            Stopped {
                cancelled: true,
                reason: CANCELLED.into()
            }
        );
        let failed = speaking(Language::Es, progress::not_absolute);
        assert_eq!(Stopped::from(failed.clone()), Stopped { cancelled: false, reason: failed });
        assert_eq!(serde_json::to_string(&Stopped::from("disk full".to_string())).unwrap(), r#"{"cancelled":false,"reason":"disk full"}"#);
    }

    #[test]
    fn the_window_is_titled_in_the_language_spoken() {
        assert_eq!(title(Mode::Install), "Install Sens");
        assert_eq!(speaking(Language::Fr, || title(Mode::Uninstall)), "Désinstaller Sens");
        assert_eq!(speaking(Language::Ja, || title(Mode::Update)), "Sens をインストール");
    }

    #[test]
    fn a_choice_from_an_older_page_carries_no_look_and_no_language() {
        let choice: Choice = serde_json::from_str(r#"{"dir":"C:/Sens","desktop":true,"startMenu":false}"#).unwrap();

        assert!(choice.look.is_none() && choice.language.is_none());
        let chosen: Choice = serde_json::from_str(r#"{"dir":"C:/Sens","desktop":true,"startMenu":true,"look":null,"language":"de"}"#).unwrap();
        assert_eq!(chosen.language, Some(Language::De));
    }
}
