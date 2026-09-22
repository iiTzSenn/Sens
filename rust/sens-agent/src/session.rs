use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::Step;

const TITLE_LIMIT: usize = 56;

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Entry {
    Opened { at: u64, root: String },
    Task { at: u64, text: String },
    Beat { at: u64, step: Step },
    Failed { at: u64, reason: String },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub title: String,
    pub started_at: u64,
    pub tasks: usize,
    pub stops: usize,
    pub net_lines: i64,
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis() as u64)
        .unwrap_or_default()
}

pub fn dir(root: &Path) -> PathBuf {
    root.join(".sens").join("sessions")
}

fn file(root: &Path, id: &str) -> PathBuf {
    dir(root).join(format!("{id}.jsonl"))
}

pub fn open(root: &Path) -> Result<String, String> {
    let at = now();
    let id = format!("s{at}");
    append(
        root,
        &id,
        &Entry::Opened {
            at,
            root: root.to_string_lossy().to_string(),
        },
    )?;
    Ok(id)
}

pub fn append(root: &Path, id: &str, entry: &Entry) -> Result<(), String> {
    let folder = dir(root);
    std::fs::create_dir_all(&folder)
        .map_err(|error| format!("no pude crear {}: {error}", folder.display()))?;

    let line = serde_json::to_string(entry).map_err(|error| error.to_string())?;
    let mut handle = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(file(root, id))
        .map_err(|error| format!("no pude abrir la sesión {id}: {error}"))?;

    writeln!(handle, "{line}").map_err(|error| format!("no pude escribir la sesión: {error}"))
}

pub fn read(root: &Path, id: &str) -> Vec<Entry> {
    let Ok(handle) = std::fs::File::open(file(root, id)) else {
        return Vec::new();
    };
    BufReader::new(handle)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str(&line).ok())
        .collect()
}

pub fn list(root: &Path) -> Vec<Summary> {
    let Ok(entries) = std::fs::read_dir(dir(root)) else {
        return Vec::new();
    };

    let mut sessions: Vec<Summary> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension()? != "jsonl" {
                return None;
            }
            let id = path.file_stem()?.to_str()?.to_string();
            Some(summarize(&id, &read(root, &id)))
        })
        .collect();

    sessions.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    sessions
}

pub fn summarize(id: &str, entries: &[Entry]) -> Summary {
    let mut summary = Summary {
        id: id.to_string(),
        title: "Sesión vacía".into(),
        started_at: 0,
        tasks: 0,
        stops: 0,
        net_lines: 0,
    };

    for entry in entries {
        match entry {
            Entry::Opened { at, .. } => summary.started_at = *at,
            Entry::Task { at, text } => {
                if summary.tasks == 0 {
                    summary.title = shorten(text);
                    if summary.started_at == 0 {
                        summary.started_at = *at;
                    }
                }
                summary.tasks += 1;
            }
            Entry::Beat { step, .. } => match step {
                Step::Repairing { .. } => summary.stops += 1,
                Step::Applied { net, .. } => summary.net_lines += net,
                _ => {}
            },
            Entry::Failed { .. } => {}
        }
    }

    summary
}

fn shorten(text: &str) -> String {
    let clean = text.trim();
    if clean.chars().count() <= TITLE_LIMIT {
        return clean.to_string();
    }
    let cut: String = clean.chars().take(TITLE_LIMIT).collect();
    format!("{}…", cut.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("sens-session-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn a_session_keeps_every_entry_in_the_order_they_happened() {
        let root = temp_root("order");
        let id = open(&root).unwrap();

        append(&root, &id, &Entry::Task { at: 1, text: "una".into() }).unwrap();
        append(&root, &id, &Entry::Beat { at: 2, step: Step::Applied { net: -14, files: Vec::new() } }).unwrap();
        append(&root, &id, &Entry::Task { at: 3, text: "otra".into() }).unwrap();

        let entries = read(&root, &id);
        assert_eq!(entries.len(), 4);
        assert!(matches!(entries[0], Entry::Opened { .. }));
        assert!(matches!(entries[3], Entry::Task { .. }));
    }

    #[test]
    fn the_summary_titles_the_session_with_its_first_task() {
        let entries = vec![
            Entry::Opened { at: 10, root: "p".into() },
            Entry::Task { at: 11, text: "Añade validación al arranque".into() },
            Entry::Task { at: 12, text: "Y ahora borra lo muerto".into() },
        ];
        let summary = summarize("s10", &entries);

        assert_eq!(summary.title, "Añade validación al arranque");
        assert_eq!(summary.tasks, 2);
        assert_eq!(summary.started_at, 10);
    }

    #[test]
    fn the_summary_adds_up_written_lines_and_counts_refusals() {
        let entries = vec![
            Entry::Task { at: 1, text: "algo".into() },
            Entry::Beat { at: 2, step: Step::Repairing { gate: "G1".into(), attempt: 1 } },
            Entry::Beat { at: 3, step: Step::Applied { net: -14, files: Vec::new() } },
            Entry::Beat { at: 4, step: Step::Applied { net: 3, files: Vec::new() } },
        ];
        let summary = summarize("s1", &entries);

        assert_eq!(summary.stops, 1);
        assert_eq!(summary.net_lines, -11);
    }

    #[test]
    fn sessions_come_back_newest_first() {
        let root = temp_root("listing");
        let first = open(&root).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(3));
        let second = open(&root).unwrap();

        let listed = list(&root);

        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, second);
        assert_eq!(listed[1].id, first);
    }

    #[test]
    fn a_long_task_is_cut_for_the_title_but_kept_whole_in_the_log() {
        let long = "a".repeat(200);
        let entries = vec![Entry::Task { at: 1, text: long.clone() }];
        let summary = summarize("s1", &entries);

        assert!(summary.title.ends_with('…'));
        assert_eq!(summary.title.chars().count(), TITLE_LIMIT + 1);
        assert!(matches!(&entries[0], Entry::Task { text, .. } if text.len() == 200));
    }

    #[test]
    fn a_session_that_does_not_exist_reads_as_empty_instead_of_failing() {
        let root = temp_root("missing");
        assert!(read(&root, "s404").is_empty());
        assert!(list(&root).is_empty());
    }
}
