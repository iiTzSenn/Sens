#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

use sens_agent::model::{Anthropic, Cli, Model};
use sens_agent::{Crew, Step, session};
use sens_hook::engine;
use sens_hook::freshness::{self, Freshness};
use sens_hook::gate::{self, Gauntlet, Outcome, Patch};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

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
fn open_file(root: String, path: String) -> Result<String, String> {
    let base = PathBuf::from(&root)
        .canonicalize()
        .map_err(|error| format!("proyecto ilegible: {error}"))?;
    let target = base
        .join(&path)
        .canonicalize()
        .map_err(|_| format!("{path} no existe"))?;

    if !target.starts_with(&base) {
        return Err("ese fichero está fuera del proyecto".into());
    }
    std::fs::read_to_string(&target).map_err(|error| format!("no pude leer {path}: {error}"))
}

enum Hands {
    Api(String),
    Command(String),
}

impl Hands {
    fn pick(provider: &str, key: &str) -> Result<Self, String> {
        if provider.trim() != "api" {
            return Ok(Hands::Command(provider.trim().to_string()));
        }
        match key.trim() {
            "" => std::env::var("ANTHROPIC_API_KEY")
                .map(Hands::Api)
                .map_err(|_| "Sin clave: pégala arriba o define ANTHROPIC_API_KEY.".to_string()),
            given => Ok(Hands::Api(given.to_string())),
        }
    }

    fn crew(&self) -> Result<(Box<dyn Model>, Box<dyn Model>), String> {
        Ok(match self {
            Hands::Api(key) => (
                Box::new(Anthropic::writer(key.clone())),
                Box::new(Anthropic::dieter(key.clone())),
            ),
            Hands::Command(command) => (
                Box::new(Self::launcher(command)?),
                Box::new(Self::launcher(command)?),
            ),
        })
    }

    fn launcher(command: &str) -> Result<Cli, String> {
        match command {
            "claude" => Ok(Cli::claude()),
            given => Cli::parse(given),
        }
    }
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

#[tauri::command]
fn work(
    app: AppHandle,
    root: String,
    task: String,
    key: String,
    provider: String,
    session_id: String,
) -> Result<(), String> {
    let hands = Hands::pick(&provider, &key)?;

    std::thread::spawn(move || {
        let here = PathBuf::from(&root);
        let keep = |entry: session::Entry| {
            let _ = session::append(&here, &session_id, &entry);
        };

        keep(session::Entry::Task {
            at: session::now(),
            text: task.clone(),
        });

        let (writer, dieter) = match hands.crew() {
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
            writer: writer.as_ref(),
            dieter: dieter.as_ref(),
        };

        let mut emit = |step: Step| {
            keep(session::Entry::Beat {
                at: session::now(),
                step: step.clone(),
            });
            let _ = app.emit("step", step);
        };

        match sens_agent::run(&here, &task, &crew, &mut emit) {
            Ok(landed) => {
                let _ = app.emit("done", (landed.paths, landed.net));
            }
            Err(reason) => {
                keep(session::Entry::Failed {
                    at: session::now(),
                    reason: reason.clone(),
                });
                let _ = app.emit("failed", reason);
            }
        }
    });

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![status, judge, work, open_session, sessions, replay, tree, open_file])
        .run(tauri::generate_context!())
        .expect("sens app");
}
