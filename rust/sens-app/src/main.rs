#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod artifacts;
mod browser;
mod capabilities;
mod claude_code;
mod files;
mod icon;
mod git;
mod language;
mod look;
mod market;
mod mcp;
mod news;
mod preview;
mod profile;
mod projects;
mod providers;
mod served;
mod snapshot;
mod store;
mod terminal;
mod update;
mod web;
mod welcome;
mod worktree;

use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use sens_agent::account;
use sens_agent::catalog;
use sens_agent::chat::{self, Decision, Engine, Event, Message, Settings, Sink, Slash};
use sens_agent::language::Language;
use sens_agent::said;
use sens_agent::session;
use sens_agent::title;
use serde::Serialize;
use tauri::{App, AppHandle, Emitter, Manager, RunEvent, State, Theme, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

#[tauri::command(async)]
fn repo(root: String) -> Option<git::Repo> {
    git::read(&PathBuf::from(root))
}

#[tauri::command(async)]
fn checkout(root: String, branch: String) -> Result<git::Repo, String> {
    git::checkout(&PathBuf::from(root), &branch)
}

#[tauri::command(async)]
fn changes(root: String) -> Option<git::Changes> {
    git::changes(&PathBuf::from(root))
}

#[tauri::command(async)]
fn folder(root: String, path: String) -> Result<Vec<files::Entry>, String> {
    files::folder(Path::new(&root), &path)
}

#[tauri::command(async)]
fn find_files(root: String, needle: String) -> Result<Vec<files::Entry>, String> {
    files::search(Path::new(&root), &needle)
}

#[tauri::command(async)]
fn open_file(root: String, path: String) -> Result<files::Opened, String> {
    files::open(Path::new(&root), &path)
}

#[tauri::command(async)]
fn attach(root: String, paths: Vec<String>) -> artifacts::Attachments {
    artifacts::attach(Path::new(&root), &paths)
}

#[tauri::command(async)]
fn stage_file(app: AppHandle, name: String, data: String) -> Result<artifacts::Attached, String> {
    artifacts::stage(&data_dir(&app)?.join("staged"), &name, &data)
}

#[tauri::command]
fn providers() -> &'static [catalog::Provider] {
    catalog::PROVIDERS
}

#[tauri::command(async)]
fn models(provider: String) -> Result<Option<Vec<catalog::Card>>, String> {
    let served = std::thread::spawn(served::models);
    let offered = catalog::discover(&provider)?;
    Ok(offered.map(|offered| catalog::with_served(offered, &served.join().unwrap_or_default())))
}

#[tauri::command(async)]
fn claude_account() -> Result<Option<account::Account>, String> {
    account::read()
}

#[tauri::command(async)]
fn providers_state(app: AppHandle) -> Result<Vec<providers::State>, String> {
    Ok(providers::state(&data_dir(&app)?))
}

fn share_environment(base: &Path) {
    sens_agent::process::set_environment(providers::environment(base));
}

#[tauri::command]
fn set_provider_method(app: AppHandle, id: String, method: providers::Method) -> Result<(), String> {
    let base = data_dir(&app)?;
    providers::set_method(&base, &id, method)?;
    share_environment(&base);
    Ok(())
}

#[tauri::command]
fn save_api_key(app: AppHandle, id: String, key: String) -> Result<(), String> {
    let base = data_dir(&app)?;
    providers::save_key(&base, &id, &key)?;
    share_environment(&base);
    Ok(())
}

#[tauri::command]
fn forget_api_key(app: AppHandle, id: String) -> Result<(), String> {
    let base = data_dir(&app)?;
    providers::forget_key(&base, &id)?;
    share_environment(&base);
    Ok(())
}

#[tauri::command(async)]
fn provider_sign_in(method: providers::Method) -> Result<(), String> {
    match method {
        providers::Method::Subscription => account::sign_in(account::Door::Subscription),
        providers::Method::Console => account::sign_in(account::Door::Console),
        providers::Method::ApiKey => Err(said!(
            en: "with an API key there’s no need to sign in",
            es: "con una clave de API no hace falta iniciar sesión",
            fr: "avec une clé API, inutile de se connecter",
            de: "mit einem API-Schlüssel musst du dich nicht anmelden",
            ja: "API キーを使う場合、サインインは不要です",
            zh: "使用 API 密钥时无需登录",
        )),
    }
}

#[tauri::command(async)]
fn provider_sign_out() -> Result<(), String> {
    account::sign_out()
}

#[tauri::command(async)]
fn claude_code_install(app: AppHandle) -> Result<String, String> {
    claude_code::install(&data_dir(&app)?, |progress| {
        let _ = app.emit("claude-code", progress);
    })
}

#[tauri::command(async)]
fn claude_code_newer() -> Result<Option<String>, String> {
    claude_code::newer()
}

#[tauri::command(async)]
fn claude_code_update(app: AppHandle) -> Result<String, String> {
    claude_code::update(|progress| {
        let _ = app.emit("claude-code", progress);
    })
}

#[derive(Serialize, Clone)]
struct Heard<'a> {
    session: &'a str,
    event: &'a Event,
}

fn relay(app: AppHandle) -> Sink {
    Arc::new(move |session, event| {
        let _ = app.emit("chat", Heard { session, event });
    })
}

#[tauri::command(async)]
fn chat_send(
    app: AppHandle,
    engine: State<Arc<Engine>>,
    root: String,
    session_id: String,
    mut message: Message,
    mut settings: Settings,
) -> Result<(), String> {
    if engine.busy(&session_id) {
        return Err(chat::still_working());
    }
    let here = Path::new(&root);
    equip(&app, &root, &session_id, &mut settings)?;
    let work = settings.cwd.clone().unwrap_or_else(|| here.to_path_buf());
    for (at, image) in message.images.iter_mut().enumerate() {
        image.kept = artifacts::keep_picture(here, &session_id, at, &image.media_type, &image.data)?;
    }
    for file in message.files.iter_mut() {
        *file = artifacts::keep_file(here, &work, &session_id, file)?;
    }
    engine.send(here, &session_id, &message, settings, relay(app))
}

#[tauri::command(async)]
fn chat_warm(app: AppHandle, engine: State<Arc<Engine>>, root: String, session_id: String, mut settings: Settings) -> Result<Vec<Slash>, String> {
    equip(&app, &root, &session_id, &mut settings)?;
    engine.warm(Path::new(&root), &session_id, settings, relay(app))
}

fn equip(app: &AppHandle, root: &str, session_id: &str, settings: &mut Settings) -> Result<(), String> {
    let base = data_dir(app)?;
    projects::allows(&projects::load(&base), root, &settings.mode)?;
    settings.cwd = worktree::work_dir(Path::new(root), session_id)?;
    let launch = capabilities::launch(&base, root)?;
    settings.extra = launch.args;
    settings.extra.extend(bridged(app, root, settings.cwd.as_deref()));
    settings.env = launch.env;
    settings.env.extend(providers::environment(&base));
    Ok(())
}

fn bridged(app: &AppHandle, root: &str, work: Option<&Path>) -> Vec<String> {
    let within = std::iter::once(root.to_string()).chain(work.map(|work| work.to_string_lossy().into_owned())).collect();
    let asking = app.clone();
    let config = app.state::<mcp::Bridge>().config(within, move |reading| {
        let _ = asking.emit("terminal-read", reading);
    });
    match config {
        Ok(config) => vec!["--mcp-config".into(), config, "--allowedTools".into(), mcp::allowed()],
        Err(_) => Vec::new(),
    }
}

#[tauri::command]
fn new_session_id() -> String {
    session::fresh_id()
}

#[tauri::command]
fn chat_stop(engine: State<Arc<Engine>>, session_id: String) -> Result<(), String> {
    engine.stop(&session_id)
}

#[tauri::command]
fn chat_answer(engine: State<Arc<Engine>>, session_id: String, request: String, decision: Decision) -> Result<(), String> {
    engine.answer(&session_id, &request, &decision)
}

#[tauri::command(async)]
fn chat_busy(engine: State<Arc<Engine>>, session_id: String) -> bool {
    engine.busy(&session_id)
}

#[tauri::command(async)]
fn chat_tasks(engine: State<Arc<Engine>>, session_id: String) -> Vec<String> {
    engine.tasks(&session_id)
}

#[tauri::command(async)]
fn chat_working(engine: State<Arc<Engine>>) -> usize {
    engine.working()
}

#[tauri::command]
fn chat_stop_task(engine: State<Arc<Engine>>, session_id: String, task_id: String) -> Result<(), String> {
    engine.stop_task(&session_id, &task_id)
}

const TASK_TAIL: u64 = 64 * 1024;

#[tauri::command(async)]
fn task_output(path: String) -> Result<String, String> {
    let file = PathBuf::from(&path);
    let in_tasks = file.parent().and_then(Path::file_name).is_some_and(|name| name == "tasks");
    if !in_tasks || file.extension().is_none_or(|extension| extension != "output") {
        return Err(said!(
            en: "that path isn’t the output of a task",
            es: "esa ruta no es la salida de una tarea",
            fr: "ce chemin n’est pas la sortie d’une tâche",
            de: "dieser Pfad ist nicht die Ausgabe einer Aufgabe",
            ja: "このパスはタスクの出力ではありません",
            zh: "该路径不是任务的输出",
        ));
    }
    let unread = |error: std::io::Error| {
        said!(
            en: "couldn’t read the output: {error}",
            es: "no pude leer la salida: {error}",
            fr: "impossible de lire la sortie : {error}",
            de: "die Ausgabe konnte nicht gelesen werden: {error}",
            ja: "出力を読み取れませんでした: {error}",
            zh: "无法读取输出：{error}",
        )
    };
    let mut opened = std::fs::File::open(&file).map_err(unread)?;
    let size = opened.metadata().map(|meta| meta.len()).unwrap_or_default();
    let skipped = size.saturating_sub(TASK_TAIL);
    opened.seek(SeekFrom::Start(skipped)).map_err(unread)?;
    let mut bytes = Vec::new();
    opened.read_to_end(&mut bytes).map_err(unread)?;
    let text = String::from_utf8_lossy(&bytes);
    Ok(match skipped {
        0 => text.into_owned(),
        _ => text.split_once('\n').map(|(_, rest)| rest).unwrap_or(&text).to_string(),
    })
}

#[tauri::command(async)]
fn browser_open(app: AppHandle, url: String, frame: browser::Frame, zoom: f64) -> Result<(), String> {
    browser::open(&app, &url, frame, zoom)
}

#[tauri::command(async)]
fn browser_place(app: AppHandle, frame: browser::Frame, zoom: f64) -> Result<(), String> {
    browser::place(&app, frame, zoom)
}

#[tauri::command(async)]
fn browser_show(app: AppHandle, shown: bool) -> Result<(), String> {
    browser::show(&app, shown)
}

#[tauri::command(async)]
fn browser_act(app: AppHandle, act: String) -> Result<(), String> {
    browser::act(&app, &act)
}

#[tauri::command(async)]
fn terminal_open(app: AppHandle, consoles: State<terminal::Consoles>, root: String, cols: u16, rows: u16) -> Result<terminal::Opened, String> {
    consoles.open(Path::new(&root), cols, rows, move |heard| {
        let _ = app.emit("terminal", heard);
    })
}

#[tauri::command(async)]
fn terminal_write(consoles: State<terminal::Consoles>, id: u32, data: String) -> Result<(), String> {
    consoles.write(id, &data)
}

#[tauri::command]
fn terminal_resize(consoles: State<terminal::Consoles>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    consoles.resize(id, cols, rows)
}

#[tauri::command]
fn terminal_close(consoles: State<terminal::Consoles>, id: u32) -> Result<(), String> {
    consoles.close(id)
}

#[tauri::command]
fn terminal_screen(bridge: State<mcp::Bridge>, ask: u64, text: String) -> Result<(), String> {
    bridge.answer(ask, text)
}

#[tauri::command]
fn open_session(root: String, id: Option<String>) -> Result<String, String> {
    let root = PathBuf::from(root);
    match id {
        Some(id) => session::open_as(&root, &id),
        None => session::open(&root),
    }
}

#[tauri::command]
fn archive_session(root: String, id: String, archived: bool) -> Result<(), String> {
    session::archive(&PathBuf::from(root), &id, archived)
}

#[tauri::command(async)]
fn delete_session(engine: State<Arc<Engine>>, consoles: State<terminal::Consoles>, root: String, id: String) -> Result<(), String> {
    let root = PathBuf::from(root);
    worktree::release(&root, &id, |work| {
        engine.forget(&id);
        consoles.close_within(work);
    })?;
    engine.forget(&id);
    session::erase(&root, &id)
}

#[tauri::command(async)]
fn isolate_session(root: String, id: String) -> Result<session::Isolation, String> {
    worktree::isolate(Path::new(&root), &id)
}

#[tauri::command(async)]
fn title_session(root: String, id: String) -> Result<Option<String>, String> {
    title::suggest(&PathBuf::from(root), &id)
}

#[tauri::command]
fn rename_session(root: String, id: String, title: String) -> Result<String, String> {
    session::entitle(&PathBuf::from(root), &id, &title, session::Namer::User)
}

#[tauri::command(async)]
fn replay(root: String, id: String) -> Vec<session::Entry> {
    session::read(&PathBuf::from(root), &id)
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| {
        said!(
            en: "can’t find the data folder: {error}",
            es: "no encuentro la carpeta de datos: {error}",
            fr: "dossier de données introuvable : {error}",
            de: "Datenordner nicht gefunden: {error}",
            ja: "データフォルダーが見つかりません: {error}",
            zh: "找不到数据文件夹：{error}",
        )
    })
}

fn registry(app: &AppHandle) -> Result<projects::Registry, String> {
    Ok(projects::load(&data_dir(app)?))
}

#[tauri::command(async)]
fn workspaces(app: AppHandle) -> Result<Vec<projects::Workspace>, String> {
    Ok(projects::workspaces(&registry(&app)?))
}

#[tauri::command]
fn remember(app: AppHandle, root: String) -> Result<(), String> {
    projects::remember(&data_dir(&app)?, &root)
}

#[tauri::command]
fn trust_project(app: AppHandle, root: String, trusted: bool) -> Result<(), String> {
    projects::trust(&data_dir(&app)?, &root, trusted)
}

#[tauri::command]
fn project_trusted(app: AppHandle, root: String) -> Result<bool, String> {
    Ok(projects::trusted(&registry(&app)?, &root))
}

#[tauri::command]
fn last_project(app: AppHandle) -> Result<Option<String>, String> {
    Ok(projects::last(&registry(&app)?))
}

#[tauri::command(async)]
fn artifacts(app: AppHandle) -> Result<Vec<artifacts::Artifact>, String> {
    Ok(artifacts::all(&registry(&app)?))
}

#[tauri::command(async)]
fn artifact_data(app: AppHandle, path: String) -> Result<String, String> {
    artifacts::data(&registry(&app)?, &path)
}

#[tauri::command(async)]
fn artifact_text(app: AppHandle, path: String) -> Result<String, String> {
    artifacts::text(&registry(&app)?, &path)
}

#[tauri::command]
fn open_external(app: AppHandle, target: String) -> Result<(), String> {
    let opener = app.opener();
    match artifacts::destination(&registry(&app)?, &target)? {
        artifacts::Outside::Web(url) => opener.open_url(url, None::<&str>),
        artifacts::Outside::File(path) => opener.open_path(path, None::<&str>),
        artifacts::Outside::Folder(path) => opener.reveal_item_in_dir(path),
    }
    .map_err(|error| {
        said!(
            en: "couldn’t open {target}: {error}",
            es: "no pude abrir {target}: {error}",
            fr: "impossible d’ouvrir {target} : {error}",
            de: "{target} konnte nicht geöffnet werden: {error}",
            ja: "{target} を開けませんでした: {error}",
            zh: "无法打开 {target}：{error}",
        )
    })
}

#[tauri::command]
fn profile(app: AppHandle) -> Result<profile::Profile, String> {
    Ok(profile::load(&data_dir(&app)?))
}

#[tauri::command]
fn save_profile(app: AppHandle, name: String) -> Result<(), String> {
    profile::rename(&data_dir(&app)?, &name)
}

#[tauri::command]
fn set_update_check(app: AppHandle, on: bool) -> Result<(), String> {
    profile::set_update_check(&data_dir(&app)?, on)
}

#[tauri::command]
fn set_notify(app: AppHandle, on: bool) -> Result<(), String> {
    profile::set_notify(&data_dir(&app)?, on)
}

#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| {
            said!(
                en: "couldn’t send the notification: {error}",
                es: "no pude avisar: {error}",
                fr: "impossible d’envoyer la notification : {error}",
                de: "die Benachrichtigung konnte nicht gesendet werden: {error}",
                ja: "通知を送れませんでした: {error}",
                zh: "无法发送通知：{error}",
            )
        })
}

#[tauri::command]
fn set_welcomed(app: AppHandle, on: bool) -> Result<(), String> {
    profile::set_welcomed(&data_dir(&app)?, on)
}

#[tauri::command(async)]
fn news(app: AppHandle) -> Result<Vec<news::News>, String> {
    news::since(&profile::load(&data_dir(&app)?).seen)
}

#[tauri::command]
fn saw_news(app: AppHandle) -> Result<(), String> {
    profile::saw_news(&data_dir(&app)?)
}

#[tauri::command]
fn set_look(app: AppHandle, look: look::Look) -> Result<(), String> {
    look::save(&data_dir(&app)?, look)
}

#[tauri::command]
fn set_language(app: AppHandle, language: Language) -> Result<(), String> {
    language::save(&data_dir(&app)?, language)?;
    sens_agent::language::set(language);
    Ok(())
}

const UNPAINTED: std::time::Duration = std::time::Duration::from_secs(4);

fn open_window(app: &App) -> tauri::Result<()> {
    let Some(config) = app.config().app.windows.first().cloned() else {
        return Ok(());
    };
    let base = data_dir(app.handle()).ok();
    let look = base.as_deref().map(look::load).unwrap_or_default();
    let person = base.as_deref().map(profile::load).unwrap_or_default();
    let theme = look.theme();
    let window = WebviewWindowBuilder::from_config(app.handle(), &config)?
        .theme(theme)
        .background_color(look::ground(theme.unwrap_or(Theme::Dark)))
        .initialization_script(look.script())
        .initialization_script(person.script())
        .initialization_script(language::script(base.as_deref().and_then(language::load)))
        .build()?;
    if theme.is_none() {
        window.set_background_color(Some(look::ground(window.theme()?)))?;
    }
    std::thread::spawn(move || {
        std::thread::sleep(UNPAINTED);
        if !window.is_visible().unwrap_or(true) {
            let _ = window.show();
        }
    });
    Ok(())
}

#[tauri::command(async)]
fn welcome_scan(app: AppHandle) -> Result<welcome::Found, String> {
    Ok(welcome::scan(&data_dir(&app)?, &welcome::Places::current()?))
}

#[derive(Serialize, Clone)]
struct Welcoming {
    done: usize,
    total: usize,
}

#[tauri::command(async)]
fn welcome_adopt(app: AppHandle, roots: Vec<String>) -> Result<welcome::Adopted, String> {
    let base = data_dir(&app)?;
    Ok(welcome::adopt(&base, &welcome::Places::current()?, &roots, |done, total| {
        let _ = app.emit("welcome", Welcoming { done, total });
    }))
}

#[tauri::command(async)]
fn welcome_servers(app: AppHandle, ids: Vec<String>, roots: Vec<String>) -> Result<welcome::Imported, String> {
    Ok(welcome::import_servers(&data_dir(&app)?, &welcome::Places::current()?, &ids, &roots))
}

#[tauri::command(async)]
fn update_check(manual: bool) -> Result<update::Check, String> {
    update::check(manual)
}

#[derive(Serialize, Clone)]
struct Updating<'a> {
    version: &'a str,
    stage: update::Stage,
}

#[tauri::command(async)]
fn update_install(app: AppHandle) -> Result<(), String> {
    update::install(&data_dir(&app)?, |version, stage| {
        let _ = app.emit("update", Updating { version, stage });
    })?;
    app.state::<Arc<Engine>>().shutdown();
    app.state::<terminal::Consoles>().shutdown();
    app.cleanup_before_exit();
    std::process::exit(0)
}

#[tauri::command(async)]
fn capabilities(app: AppHandle, root: String) -> Result<capabilities::Capabilities, String> {
    Ok(capabilities::all(&data_dir(&app)?, &root))
}

#[tauri::command]
fn skill_text(app: AppHandle, name: String) -> Result<String, String> {
    capabilities::skill_text(&data_dir(&app)?, &name)
}

#[tauri::command]
fn create_skill(app: AppHandle, root: String, name: String, description: String, body: String) -> Result<(), String> {
    capabilities::create_skill(&data_dir(&app)?, &root, &name, &description, &body)
}

#[tauri::command(async)]
fn import_skill(app: AppHandle, root: String, path: String) -> Result<String, String> {
    capabilities::import_skill(&data_dir(&app)?, &root, Path::new(&path))
}

#[tauri::command]
fn preview_url(site: State<preview::Site>, root: String, path: String) -> Result<String, String> {
    preview::url(&site, Path::new(&root), &path)
}

#[tauri::command]
fn remove_skill(app: AppHandle, name: String) -> Result<(), String> {
    capabilities::remove_skill(&data_dir(&app)?, &name)
}

#[tauri::command]
fn set_skill(app: AppHandle, root: String, name: String, enabled: bool) -> Result<(), String> {
    capabilities::set_skill(&data_dir(&app)?, &root, &name, enabled)
}

#[tauri::command]
fn add_server(app: AppHandle, root: String, server: capabilities::NewServer) -> Result<(), String> {
    capabilities::add_server(&data_dir(&app)?, &root, &server)
}

#[tauri::command]
fn remove_server(app: AppHandle, name: String) -> Result<(), String> {
    capabilities::remove_server(&data_dir(&app)?, &name)
}

#[tauri::command]
fn set_server(app: AppHandle, root: String, name: String, enabled: bool) -> Result<(), String> {
    capabilities::set_server(&data_dir(&app)?, &root, &name, enabled)
}

#[tauri::command]
fn set_plugin(app: AppHandle, root: String, name: String, enabled: bool) -> Result<(), String> {
    capabilities::set_plugin(&data_dir(&app)?, &root, &name, enabled)
}

#[tauri::command]
fn remove_plugin(app: AppHandle, name: String) -> Result<(), String> {
    capabilities::remove_plugin(&data_dir(&app)?, &name)
}

#[tauri::command(async)]
fn market(app: AppHandle, refresh: bool) -> Result<market::Market, String> {
    Ok(market::market(&data_dir(&app)?, refresh))
}

#[tauri::command(async)]
fn market_search(app: AppHandle, query: String) -> Result<Vec<market::Listing>, String> {
    market::search(&data_dir(&app)?, &query)
}

#[tauri::command(async)]
fn market_detail(app: AppHandle, id: String) -> Result<market::Detail, String> {
    market::detail(&data_dir(&app)?, &id)
}

#[tauri::command(async)]
fn market_file(app: AppHandle, id: String, path: String) -> Result<String, String> {
    market::file(&data_dir(&app)?, &id, &path)
}

#[tauri::command(async)]
fn market_install(app: AppHandle, root: String, id: String, values: BTreeMap<String, String>) -> Result<String, String> {
    market::install(&data_dir(&app)?, &root, &id, &values)
}

#[tauri::command(async)]
fn market_update(app: AppHandle, id: String, name: String) -> Result<(), String> {
    market::update(&data_dir(&app)?, &id, &name)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Arc::new(Engine::default()))
        .manage(preview::Site::default())
        .manage(terminal::Consoles::default())
        .manage(mcp::Bridge::default())
        .setup(|app| {
            let base = data_dir(app.handle());
            language::speak(base.as_deref().ok());
            open_window(app)?;
            icon::sharpen(app);
            if let Ok(base) = base {
                share_environment(&base);
                update::sweep(&base);
                claude_code::sweep(&base);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            chat_send,
            chat_stop,
            chat_answer,
            chat_busy,
            chat_tasks,
            chat_working,
            chat_stop_task,
            task_output,
            chat_warm,
            new_session_id,
            providers,
            models,
            claude_account,
            providers_state,
            set_provider_method,
            save_api_key,
            forget_api_key,
            provider_sign_in,
            provider_sign_out,
            claude_code_install,
            claude_code_newer,
            claude_code_update,
            attach,
            stage_file,
            open_session,
            archive_session,
            delete_session,
            isolate_session,
            title_session,
            rename_session,
            replay,
            folder,
            find_files,
            open_file,
            repo,
            checkout,
            changes,
            workspaces,
            remember,
            trust_project,
            project_trusted,
            last_project,
            profile,
            save_profile,
            set_update_check,
            set_notify,
            notify,
            set_welcomed,
            news,
            saw_news,
            set_look,
            set_language,
            welcome_scan,
            welcome_adopt,
            welcome_servers,
            update_check,
            update_install,
            artifacts,
            artifact_data,
            artifact_text,
            open_external,
            preview_url,
            browser_open,
            browser_place,
            browser_show,
            browser_act,
            terminal_open,
            terminal_write,
            terminal_resize,
            terminal_close,
            terminal_screen,
            capabilities,
            skill_text,
            create_skill,
            import_skill,
            remove_skill,
            set_skill,
            add_server,
            remove_server,
            set_server,
            set_plugin,
            remove_plugin,
            market,
            market_search,
            market_detail,
            market_file,
            market_install,
            market_update
        ])
        .build(tauri::generate_context!())
        .expect("sens app")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Arc<Engine>>().shutdown();
                app.state::<terminal::Consoles>().shutdown();
            }
        });
}
