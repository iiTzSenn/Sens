#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod artifacts;
mod git;
mod profile;
mod projects;
mod store;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use sens_agent::catalog::{self, Choice};
use sens_agent::{Crew, HALTED, Halt, Step, session};
use sens_hook::engine;
use sens_hook::freshness::{self, Freshness};
use sens_hook::gate::{self, Gauntlet, Outcome, Patch};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

const ATTACH_CAP: usize = 24_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    root: String,
    seal: String,
    files: usize,
    symbols: usize,
    fresh: bool,
    indexed: bool,
}

#[tauri::command]
fn status(root: String) -> Status {
    let path = PathBuf::from(&root);
    let seal = Gauntlet::sealed().seal();

    let Some((index, meta)) = engine::load(&path) else {
        return Status {
            root,
            seal,
            files: 0,
            symbols: 0,
            fresh: false,
            indexed: false,
        };
    };

    Status {
        root,
        seal,
        files: index.files.len(),
        symbols: index.symbols.len(),
        fresh: freshness::check(&path, &index.files, &meta) == Freshness::Fresh,
        indexed: true,
    }
}

#[tauri::command]
fn judge(root: String, mut patch: Patch) -> Option<Outcome> {
    gate::judge(&PathBuf::from(root), &mut patch)
}

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

struct Held {
    full: PathBuf,
    relative: String,
}

fn inside(root: &str, path: &str) -> Result<Held, String> {
    let base = PathBuf::from(root)
        .canonicalize()
        .map_err(|error| format!("proyecto ilegible: {error}"))?;
    let full = base
        .join(path)
        .canonicalize()
        .map_err(|_| format!("{path} no existe"))?;

    let relative = full
        .strip_prefix(&base)
        .map_err(|_| format!("{path} está fuera del proyecto"))?
        .to_string_lossy()
        .replace('\\', "/");

    Ok(Held { full, relative })
}

#[tauri::command]
fn open_file(root: String, path: String) -> Result<String, String> {
    let held = inside(&root, &path)?;
    std::fs::read_to_string(&held.full).map_err(|error| format!("no pude leer {path}: {error}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Attachment {
    path: String,
    bytes: usize,
}

#[tauri::command]
fn attach(root: String, paths: Vec<String>) -> Vec<Attachment> {
    paths
        .iter()
        .filter_map(|given| {
            let held = inside(&root, given).ok()?;
            let bytes = std::fs::metadata(&held.full).ok()?.len() as usize;
            Some(Attachment {
                path: held.relative,
                bytes,
            })
        })
        .collect()
}

#[tauri::command]
fn providers() -> &'static [catalog::Provider] {
    catalog::PROVIDERS
}

#[tauri::command]
fn stop(halt: State<Arc<Halt>>) {
    halt.raise();
}

#[tauri::command]
fn open_session(root: String) -> Result<String, String> {
    session::open(&PathBuf::from(root))
}

#[tauri::command]
fn sessions(root: String) -> Vec<session::Summary> {
    session::list(&PathBuf::from(root))
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

fn clip(text: &str, cap: usize) -> (&str, bool) {
    if text.len() <= cap {
        return (text, false);
    }
    let end = (0..=cap)
        .rev()
        .find(|at| text.is_char_boundary(*at))
        .unwrap_or_default();
    (&text[..end], true)
}

fn briefed(root: &Path, task: &str, attachments: &[String]) -> String {
    let mut out = task.to_string();
    for path in attachments {
        let Ok(text) = std::fs::read_to_string(root.join(path)) else {
            continue;
        };
        let (body, clipped) = clip(&text, ATTACH_CAP);
        out.push_str(&format!("\n\n--- {path} ---\n{body}"));
        if clipped {
            out.push_str("\n[recortado]");
        }
    }
    out
}

#[tauri::command]
fn work(
    app: AppHandle,
    halt: State<Arc<Halt>>,
    root: String,
    task: String,
    choice: Choice,
    attachments: Vec<String>,
    session_id: String,
) -> Result<(), String> {
    catalog::vet(&choice)?;
    let halt = halt.inner().clone();
    halt.clear();

    std::thread::spawn(move || {
        let here = PathBuf::from(&root);
        let keep = |entry: session::Entry| {
            let _ = session::append(&here, &session_id, &entry);
        };

        let asked = briefed(&here, &task, &attachments);

        keep(session::Entry::Task {
            at: session::now(),
            text: asked.clone(),
        });

        let pair = match catalog::hire(&choice) {
            Ok(pair) => pair,
            Err(reason) => {
                keep(session::Entry::Failed {
                    at: session::now(),
                    reason: reason.clone(),
                });
                let _ = app.emit("failed", reason);
                return;
            }
        };

        let crew = Crew {
            writer: pair.writer.as_ref(),
            dieter: pair.dieter.as_ref(),
        };

        let mut emit = |step: Step| {
            keep(session::Entry::Beat {
                at: session::now(),
                step: step.clone(),
            });
            let _ = app.emit("step", step);
        };

        match sens_agent::run(&here, &asked, &crew, &halt, &mut emit) {
            Ok(landed) => {
                let _ = app.emit("done", (landed.paths, landed.net));
            }
            Err(reason) => {
                keep(session::Entry::Failed {
                    at: session::now(),
                    reason: reason.clone(),
                });
                let event = if reason == HALTED { "stopped" } else { "failed" };
                let _ = app.emit(event, reason);
            }
        }
    });

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(Halt::default()))
        .invoke_handler(tauri::generate_handler![
            status,
            judge,
            work,
            stop,
            providers,
            attach,
            open_session,
            sessions,
            replay,
            tree,
            open_file,
            repo,
            checkout,
            workspaces,
            remember,
            last_project,
            profile,
            save_profile,
            artifacts,
            artifact_data,
            artifact_text,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("sens app");
}
