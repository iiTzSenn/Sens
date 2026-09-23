#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod artifacts;
mod browser;
mod capabilities;
mod files;
mod icon;
mod git;
mod market;
mod preview;
mod profile;
mod projects;
mod providers;
mod snapshot;
mod store;
mod web;

use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use sens_agent::account;
use sens_agent::catalog;
use sens_agent::chat::{self, Decision, Engine, Event, Message, Settings, Sink};
use sens_agent::session;
use sens_agent::title;
use sens_hook::engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileRow {
    path: String,
    symbols: usize,
}

#[tauri::command]
fn tree(root: String) -> Vec<FileRow> {
    let Some((index, _)) = engine::load(&PathBuf::from(&root)) else {
        return Vec::new();
    };

    let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for symbol in &index.symbols {
        *counts.entry(symbol.file.as_str()).or_default() += 1;
    }

    let mut rows: Vec<FileRow> = index
        .files
        .iter()
        .map(|file| FileRow {
            symbols: counts.get(file.path.as_str()).copied().unwrap_or_default(),
            path: file.path.clone(),
        })
        .collect();
    rows.sort_by(|a, b| a.path.cmp(&b.path));
    rows
}

#[tauri::command]
fn repo(root: String) -> Option<git::Repo> {
    git::read(&PathBuf::from(root))
}

#[tauri::command]
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

#[tauri::command]
fn open_file(root: String, path: String) -> Result<String, String> {
    let full = files::inside(Path::new(&root), &path)?;
    std::fs::read_to_string(&full).map_err(|error| format!("no pude leer {path}: {error}"))
}

#[tauri::command(async)]
fn attach(root: String, paths: Vec<String>) -> artifacts::Attachments {
    artifacts::attach(Path::new(&root), &paths)
}

#[tauri::command]
fn providers() -> &'static [catalog::Provider] {
    catalog::PROVIDERS
}

#[tauri::command(async)]
fn models(provider: String) -> Result<Vec<catalog::Card>, String> {
    catalog::discover(&provider)
}

#[tauri::command(async)]
fn claude_account() -> Result<account::Account, String> {
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

#[tauri::command]
fn provider_sign_in(method: providers::Method) -> Result<(), String> {
    match method {
        providers::Method::Subscription => account::sign_in(account::Door::Subscription),
        providers::Method::Console => account::sign_in(account::Door::Console),
        providers::Method::ApiKey => Err("con una clave de API no hace falta iniciar sesión".into()),
    }
}

#[tauri::command(async)]
fn provider_sign_out() -> Result<(), String> {
    account::sign_out()
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

#[tauri::command]
fn chat_send(
    app: AppHandle,
    engine: State<Arc<Engine>>,
    root: String,
    session_id: String,
    mut message: Message,
    mut settings: Settings,
) -> Result<(), String> {
    if engine.busy(&session_id) {
        return Err(chat::BUSY.into());
    }
    let here = Path::new(&root);
    for (at, image) in message.images.iter_mut().enumerate() {
        image.kept = artifacts::keep_picture(here, &session_id, at, &image.media_type, &image.data)?;
    }
    for file in message.files.iter_mut() {
        *file = artifacts::keep_file(here, &session_id, file)?;
    }
    equip(&app, &root, &mut settings)?;
    engine.send(here, &session_id, &message, settings, relay(app))
}

#[tauri::command(async)]
fn chat_warm(app: AppHandle, engine: State<Arc<Engine>>, root: String, session_id: String, mut settings: Settings) -> Result<(), String> {
    equip(&app, &root, &mut settings)?;
    engine.warm(Path::new(&root), &session_id, settings, relay(app))
}

fn equip(app: &AppHandle, root: &str, settings: &mut Settings) -> Result<(), String> {
    let base = data_dir(app)?;
    let launch = capabilities::launch(&base, root)?;
    settings.extra = launch.args;
    settings.env = launch.env;
    settings.env.extend(providers::environment(&base));
    Ok(())
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

#[tauri::command]
fn chat_busy(engine: State<Arc<Engine>>, session_id: String) -> bool {
    engine.busy(&session_id)
}

#[tauri::command]
fn chat_tasks(engine: State<Arc<Engine>>, session_id: String) -> Vec<String> {
    engine.tasks(&session_id)
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
        return Err("esa ruta no es la salida de una tarea".into());
    }
    let mut opened = std::fs::File::open(&file).map_err(|error| format!("no pude leer la salida: {error}"))?;
    let size = opened.metadata().map(|meta| meta.len()).unwrap_or_default();
    let skipped = size.saturating_sub(TASK_TAIL);
    opened
        .seek(SeekFrom::Start(skipped))
        .map_err(|error| format!("no pude leer la salida: {error}"))?;
    let mut bytes = Vec::new();
    opened
        .read_to_end(&mut bytes)
        .map_err(|error| format!("no pude leer la salida: {error}"))?;
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

#[tauri::command]
fn delete_session(root: String, id: String) -> Result<(), String> {
    session::erase(&PathBuf::from(root), &id)
}

#[tauri::command(async)]
fn title_session(root: String, id: String) -> Result<Option<String>, String> {
    title::suggest(&PathBuf::from(root), &id)
}

#[tauri::command]
fn rename_session(root: String, id: String, title: String) -> Result<String, String> {
    session::entitle(&PathBuf::from(root), &id, &title, session::Namer::User)
}

#[tauri::command]
fn replay(root: String, id: String) -> Vec<session::Entry> {
    session::read(&PathBuf::from(root), &id)
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("no encuentro la carpeta de datos: {error}"))
}

fn registry(app: &AppHandle) -> Result<projects::Registry, String> {
    Ok(projects::load(&data_dir(app)?))
}

#[tauri::command]
fn workspaces(app: AppHandle) -> Result<Vec<projects::Workspace>, String> {
    Ok(projects::workspaces(&registry(&app)?))
}

#[tauri::command]
fn remember(app: AppHandle, root: String) -> Result<(), String> {
    projects::remember(&data_dir(&app)?, &root)
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
    .map_err(|error| format!("no pude abrir {target}: {error}"))
}

#[tauri::command]
fn profile(app: AppHandle) -> Result<profile::Profile, String> {
    Ok(profile::load(&data_dir(&app)?))
}

#[tauri::command]
fn save_profile(app: AppHandle, name: String) -> Result<(), String> {
    profile::save(&data_dir(&app)?, &profile::Profile { name })
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
        .manage(Arc::new(Engine::default()))
        .manage(preview::Site::default())
        .setup(|app| {
            icon::sharpen(app);
            if let Ok(base) = data_dir(app.handle()) {
                share_environment(&base);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            chat_send,
            chat_stop,
            chat_answer,
            chat_busy,
            chat_tasks,
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
            attach,
            open_session,
            archive_session,
            delete_session,
            title_session,
            rename_session,
            replay,
            tree,
            folder,
            find_files,
            open_file,
            repo,
            checkout,
            changes,
            workspaces,
            remember,
            last_project,
            profile,
            save_profile,
            artifacts,
            artifact_data,
            artifact_text,
            open_external,
            preview_url,
            browser_open,
            browser_place,
            browser_show,
            browser_act,
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
            }
        });
}
