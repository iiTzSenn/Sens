use std::collections::hash_map::RandomState;
use std::ffi::OsStr;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::chat::Event;

const TITLE_LIMIT: usize = 56;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Entry {
    Opened {
        at: u64,
        root: String,
    },
    Task {
        at: u64,
        text: String,
        #[serde(default)]
        files: Vec<String>,
        #[serde(default)]
        images: Vec<String>,
    },
    Agent {
        at: u64,
        event: Event,
    },
    Titled {
        at: u64,
        title: String,
        by: Namer,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Namer {
    Ai,
    User,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub title: String,
    pub started_at: u64,
    pub tasks: usize,
    pub archived: bool,
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis() as u64)
        .unwrap_or_default()
}

pub fn fresh_id() -> String {
    let random = |salt: u64| {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u64(salt);
        hasher.write_u128(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|since| since.as_nanos())
                .unwrap_or_default(),
        );
        hasher.finish() as u128
    };
    uuid_from((random(1) << 64) | random(2))
}

pub fn uuid_from(bits: u128) -> String {
    let versioned = (bits & !(0xF << 76)) | (0x4 << 76);
    let marked = (versioned & !(0x3 << 62)) | (0x2 << 62);
    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        marked >> 96,
        (marked >> 80) & 0xFFFF,
        (marked >> 64) & 0xFFFF,
        (marked >> 48) & 0xFFFF,
        marked & 0xFFFF_FFFF_FFFF
    )
}

pub fn is_uuid(text: &str) -> bool {
    text.len() == 36
        && text.char_indices().all(|(at, letter)| match at {
            8 | 13 | 18 | 23 => letter == '-',
            _ => letter.is_ascii_hexdigit(),
        })
}

pub fn dir(root: &Path) -> PathBuf {
    root.join(".sens").join("sessions")
}

fn shelf(root: &Path) -> PathBuf {
    dir(root).join("archive")
}

fn file(root: &Path, id: &str) -> PathBuf {
    dir(root).join(format!("{id}.jsonl"))
}

fn slot(root: &Path, id: &str, archived: bool) -> PathBuf {
    if archived {
        shelf(root).join(format!("{id}.jsonl"))
    } else {
        file(root, id)
    }
}

fn located(root: &Path, id: &str) -> Option<PathBuf> {
    [slot(root, id, false), slot(root, id, true)]
        .into_iter()
        .find(|path| path.is_file())
}

fn named(id: &str) -> Result<(), String> {
    if is_uuid(id) {
        return Ok(());
    }
    Err(format!("{id} no es un identificador de sesión válido"))
}

fn plain(id: &str) -> Result<(), String> {
    let inside = !id.is_empty()
        && !id.contains(['/', '\\', ':'])
        && Path::new(id).file_name().is_some_and(|name| name == OsStr::new(id));
    if inside {
        return Ok(());
    }
    Err(format!("{id} no es un identificador de sesión válido"))
}

pub fn open(root: &Path) -> Result<String, String> {
    open_as(root, &fresh_id())
}

pub fn open_as(root: &Path, id: &str) -> Result<String, String> {
    named(id)?;
    append(
        root,
        id,
        &Entry::Opened {
            at: now(),
            root: root.to_string_lossy().to_string(),
        },
    )?;
    Ok(id.to_string())
}

pub fn append(root: &Path, id: &str, entry: &Entry) -> Result<(), String> {
    let folder = dir(root);
    std::fs::create_dir_all(&folder)
        .map_err(|error| format!("no pude crear {}: {error}", folder.display()))?;
    append_to(&file(root, id), id, entry)
}

fn append_to(path: &Path, id: &str, entry: &Entry) -> Result<(), String> {
    let line = serde_json::to_string(entry).map_err(|error| error.to_string())?;
    let mut handle = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("no pude abrir la sesión {id}: {error}"))?;

    writeln!(handle, "{line}").map_err(|error| format!("no pude escribir la sesión: {error}"))
}

pub fn entitle(root: &Path, id: &str, title: &str, by: Namer) -> Result<String, String> {
    plain(id)?;
    let title = shorten(title);
    if title.is_empty() {
        return Err("el nombre no puede quedar vacío".into());
    }
    let path = located(root, id).ok_or_else(|| format!("no encuentro la sesión {id}"))?;
    append_to(&path, id, &Entry::Titled { at: now(), title: title.clone(), by })?;
    Ok(title)
}

pub fn named_by(entries: &[Entry]) -> Option<Namer> {
    entries.iter().rev().find_map(|entry| match entry {
        Entry::Titled { by, .. } => Some(*by),
        _ => None,
    })
}

pub fn read(root: &Path, id: &str) -> Vec<Entry> {
    let Some(path) = located(root, id) else {
        return Vec::new();
    };
    let Ok(handle) = std::fs::File::open(path) else {
        return Vec::new();
    };
    BufReader::new(handle)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str(&line).ok())
        .collect()
}

pub fn has_begun(root: &Path, id: &str) -> bool {
    read(root, id).iter().any(|entry| {
        matches!(
            entry,
            Entry::Agent {
                event: Event::Started { .. },
                ..
            }
        )
    })
}

pub fn list(root: &Path) -> Vec<Summary> {
    let mut sessions: Vec<Summary> = [false, true]
        .into_iter()
        .flat_map(|archived| listed(root, archived))
        .collect();

    sessions.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    sessions
}

fn listed(root: &Path, archived: bool) -> Vec<Summary> {
    let folder = if archived { shelf(root) } else { dir(root) };
    let Ok(entries) = std::fs::read_dir(folder) else {
        return Vec::new();
    };

    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension()? != "jsonl" {
                return None;
            }
            let id = path.file_stem()?.to_str()?.to_string();
            let mut summary = summarize(&id, &read(root, &id));
            summary.archived = archived;
            Some(summary)
        })
        .collect()
}

pub fn archive(root: &Path, id: &str, archived: bool) -> Result<(), String> {
    plain(id)?;
    let from = slot(root, id, !archived);
    let to = slot(root, id, archived);
    if !from.is_file() {
        return if to.is_file() {
            Ok(())
        } else {
            Err(format!("no encuentro la sesión {id}"))
        };
    }
    if let Some(folder) = to.parent() {
        std::fs::create_dir_all(folder)
            .map_err(|error| format!("no pude crear {}: {error}", folder.display()))?;
    }
    std::fs::rename(&from, &to).map_err(|error| format!("no pude mover la sesión {id}: {error}"))
}

pub fn erase(root: &Path, id: &str) -> Result<(), String> {
    plain(id)?;
    let path = located(root, id).ok_or_else(|| format!("no encuentro la sesión {id}"))?;
    std::fs::remove_file(path).map_err(|error| format!("no pude eliminar la sesión {id}: {error}"))
}

pub fn summarize(id: &str, entries: &[Entry]) -> Summary {
    let mut summary = Summary {
        id: id.to_string(),
        title: "Sesión vacía".into(),
        started_at: 0,
        tasks: 0,
        archived: false,
    };
    let mut named = None;

    for entry in entries {
        match entry {
            Entry::Opened { at, .. } => summary.started_at = *at,
            Entry::Task { at, text, .. } => {
                if summary.tasks == 0 {
                    summary.title = shorten(text);
                    if summary.started_at == 0 {
                        summary.started_at = *at;
                    }
                }
                summary.tasks += 1;
            }
            Entry::Titled { title, .. } => named = Some(title.clone()),
            Entry::Agent { .. } => {}
        }
    }

    if let Some(title) = named {
        summary.title = title;
    }
    summary
}

fn shorten(text: &str) -> String {
    let clean = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.chars().count() <= TITLE_LIMIT {
        return clean;
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

    fn task(at: u64, text: &str) -> Entry {
        Entry::Task { at, text: text.into(), files: Vec::new(), images: Vec::new() }
    }

    fn said(at: u64, text: &str) -> Entry {
        Entry::Agent { at, event: Event::Said { text: text.into() } }
    }

    #[test]
    fn a_session_keeps_every_entry_in_the_order_they_happened() {
        let root = temp_root("order");
        let id = open(&root).unwrap();

        append(&root, &id, &task(1, "una")).unwrap();
        append(&root, &id, &said(2, "hecho")).unwrap();
        append(&root, &id, &task(3, "otra")).unwrap();

        let entries = read(&root, &id);
        assert_eq!(entries.len(), 4);
        assert!(matches!(entries[0], Entry::Opened { .. }));
        assert!(matches!(entries[2], Entry::Agent { event: Event::Said { .. }, .. }));
        assert!(matches!(entries[3], Entry::Task { .. }));
    }

    #[test]
    fn the_summary_titles_the_session_with_its_first_task() {
        let entries = vec![
            Entry::Opened { at: 10, root: "p".into() },
            task(11, "Añade validación\nal arranque"),
            task(12, "Y ahora borra lo muerto"),
        ];
        let summary = summarize("s10", &entries);

        assert_eq!(summary.title, "Añade validación al arranque");
        assert_eq!(summary.tasks, 2);
        assert_eq!(summary.started_at, 10);
    }

    #[test]
    fn the_last_name_given_wins_over_the_first_task() {
        let named = |title: &str, by| Entry::Titled { at: 20, title: title.into(), by };
        let entries = vec![
            task(11, "arregla el login"),
            named("Login con token caducado", Namer::Ai),
            task(12, "y los tests"),
            named("Mi login", Namer::User),
        ];
        let summary = summarize("s", &entries);

        assert_eq!(summary.title, "Mi login");
        assert_eq!(summary.tasks, 2);
        assert_eq!(named_by(&entries), Some(Namer::User));
        assert_eq!(named_by(&entries[..2]), Some(Namer::Ai));
        assert_eq!(named_by(&entries[..1]), None);
    }

    #[test]
    fn renaming_writes_where_the_session_lives_even_when_archived() {
        let root = temp_root("rename");
        let id = open(&root).unwrap();
        append(&root, &id, &task(1, "hola")).unwrap();
        archive(&root, &id, true).unwrap();

        let kept = entitle(&root, &id, "  Nombre\n nuevo  ", Namer::User).unwrap();

        assert_eq!(kept, "Nombre nuevo");
        assert!(!file(&root, &id).exists());
        assert_eq!(list(&root)[0].title, "Nombre nuevo");
        assert!(list(&root)[0].archived);
    }

    #[test]
    fn a_blank_name_or_a_missing_session_cannot_be_renamed() {
        let root = temp_root("rename-refused");
        let id = open(&root).unwrap();

        assert!(entitle(&root, &id, "   ", Namer::User).unwrap_err().contains("vacío"));
        assert!(entitle(&root, &fresh_id(), "x", Namer::User).unwrap_err().contains("no encuentro"));
        assert!(entitle(&root, "../fuera", "x", Namer::User).is_err());
        assert_eq!(read(&root, &id).len(), 1);
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
    fn an_archived_session_still_reads_and_lists_but_flagged() {
        let root = temp_root("archive");
        let id = open(&root).unwrap();
        append(&root, &id, &task(1, "hola")).unwrap();

        archive(&root, &id, true).unwrap();

        let listed = list(&root);
        assert_eq!(listed.len(), 1);
        assert!(listed[0].archived);
        assert_eq!(listed[0].title, "hola");
        assert_eq!(read(&root, &id).len(), 2);

        archive(&root, &id, false).unwrap();
        assert!(!list(&root)[0].archived);
    }

    #[test]
    fn sessions_from_the_old_engine_can_still_be_archived_and_erased() {
        let root = temp_root("legacy-manage");
        let id = "s1790168569374";
        std::fs::create_dir_all(dir(&root)).unwrap();
        std::fs::write(file(&root, id), "{\"kind\":\"task\",\"at\":1,\"text\":\"vieja\"}
").unwrap();

        archive(&root, id, true).unwrap();
        assert!(list(&root)[0].archived);

        erase(&root, id).unwrap();
        assert!(list(&root).is_empty());
    }

    #[test]
    fn a_session_id_that_walks_out_of_the_folder_is_refused() {
        let root = temp_root("escape");
        for bad in ["../fuera", r"..\fuera", "sub/uno", "..", ".", "", "C:pwn"] {
            assert!(archive(&root, bad, true).is_err(), "{bad}");
            assert!(erase(&root, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_session_can_be_erased_wherever_it_lives() {
        let root = temp_root("erase");
        let kept = open(&root).unwrap();
        let gone = open(&root).unwrap();
        archive(&root, &gone, true).unwrap();

        erase(&root, &gone).unwrap();

        assert_eq!(list(&root).len(), 1);
        assert_eq!(list(&root)[0].id, kept);
        assert!(erase(&root, &gone).is_err());
    }

    #[test]
    fn a_long_task_is_cut_for_the_title_but_kept_whole_in_the_log() {
        let long = "a".repeat(200);
        let entries = vec![task(1, &long)];
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

    #[test]
    fn a_new_session_is_named_by_a_uuid_that_claude_code_accepts() {
        let id = fresh_id();
        assert!(is_uuid(&id), "{id}");
        assert_eq!(&id[14..15], "4");
        assert!("89ab".contains(&id[19..20]));
        assert_ne!(fresh_id(), id);
    }

    #[test]
    fn a_session_can_be_opened_under_an_id_chosen_beforehand() {
        let root = temp_root("chosen");
        let id = fresh_id();

        assert_eq!(open_as(&root, &id).unwrap(), id);
        assert!(matches!(read(&root, &id)[0], Entry::Opened { .. }));
        assert!(open_as(&root, "../fuera").is_err());
    }

    #[test]
    fn only_the_canonical_uuid_shape_counts_as_one() {
        assert!(is_uuid("819e8d71-4433-4aff-ac86-07939fe6241c"));
        assert!(!is_uuid("s1758620000000"));
        assert!(!is_uuid("819e8d71-4433-4aff-ac86-07939fe6241"));
        assert!(!is_uuid("819e8d71x4433-4aff-ac86-07939fe6241c"));
    }

    #[test]
    fn a_session_has_begun_once_claude_code_answered_it() {
        let root = temp_root("begun");
        let id = open(&root).unwrap();
        append(&root, &id, &task(1, "hola")).unwrap();
        assert!(!has_begun(&root, &id));

        append(&root, &id, &Entry::Agent { at: 2, event: Event::Started { model: "claude-opus-5-5".into() } }).unwrap();
        assert!(has_begun(&root, &id));
    }

    #[test]
    fn lines_from_the_old_engine_are_skipped_instead_of_breaking_the_session() {
        let root = temp_root("legacy");
        let id = "s100";
        std::fs::create_dir_all(dir(&root)).unwrap();
        std::fs::write(
            file(&root, id),
            "{\"kind\":\"task\",\"at\":1,\"text\":\"vieja\"}\n{\"kind\":\"beat\",\"at\":2,\"step\":{\"step\":\"oriented\",\"symbols\":1,\"files\":1}}\n",
        )
        .unwrap();

        let entries = read(&root, id);

        assert_eq!(entries.len(), 1);
        assert!(matches!(&entries[0], Entry::Task { text, files, .. } if text == "vieja" && files.is_empty()));
    }
}
