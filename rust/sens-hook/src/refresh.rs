use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

use crate::{binindex, index, indexer};

#[derive(Debug, PartialEq)]
pub enum Refreshed {
    Untouched,
    Native { files: usize, millis: u128 },
    Delegated { millis: u128 },
}

impl Refreshed {
    pub fn millis(&self) -> u128 {
        match self {
            Refreshed::Untouched => 0,
            Refreshed::Native { millis, .. } | Refreshed::Delegated { millis } => *millis,
        }
    }
}

pub fn rebuild(root: &Path) -> Result<Refreshed, String> {
    refresh(root, &[] as &[&str])
}

pub fn update(root: &Path, touched: &[impl AsRef<str>]) -> Result<Refreshed, String> {
    refresh(root, touched)
}

fn refresh(root: &Path, touched: &[impl AsRef<str>]) -> Result<Refreshed, String> {
    if reads_as_fresh(root) {
        return Ok(Refreshed::Untouched);
    }

    let started = Instant::now();
    match indexer::build(root) {
        Some(built) => {
            let files = built.files.len();
            write_native(root, built)?;
            Ok(Refreshed::Native {
                files,
                millis: started.elapsed().as_millis(),
            })
        }
        None => {
            delegate(root, touched)?;
            drop_cache(root);
            Ok(Refreshed::Delegated {
                millis: started.elapsed().as_millis(),
            })
        }
    }
}

fn reads_as_fresh(root: &Path) -> bool {
    let Some((index, meta)) = crate::engine::load(root) else {
        return false;
    };
    crate::freshness::check(root, &index.files, &meta) == crate::freshness::Freshness::Fresh
}

fn write_native(root: &Path, built: indexer::Built) -> Result<(), String> {
    let created_at = now_millis();
    let folder = index::sens_dir(root);
    std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;

    let document = json!({
        "schemaVersion": index::INDEX_SCHEMA_VERSION,
        "root": root.to_string_lossy(),
        "createdAt": created_at,
        "files": built.files,
        "symbols": built.symbols,
        "references": built.references,
        "imports": built.imports,
    });

    let handle = std::fs::File::create(folder.join("index.json"))
        .map_err(|error| format!("no pude escribir el índice: {error}"))?;
    serde_json::to_writer(std::io::BufWriter::new(handle), &document)
        .map_err(|error| error.to_string())?;

    restamp_meta(root, created_at)?;
    drop_cache(root);
    Ok(())
}

fn restamp_meta(root: &Path, created_at: f64) -> Result<(), String> {
    let path = index::sens_dir(root).join("meta.json");
    let mut meta: Value = std::fs::read(&path)
        .ok()
        .and_then(|raw| serde_json::from_slice(&raw).ok())
        .unwrap_or_else(|| blank_meta(root));

    meta["indexCreatedAt"] = json!(created_at);
    if let Some(watched) = meta["watched"].as_array_mut() {
        for entry in watched {
            let Some(relative) = entry["path"].as_str() else {
                continue;
            };
            let target = if relative.is_empty() {
                root.to_path_buf()
            } else {
                root.join(relative)
            };
            if let Some(stamp) = mtime_ms(&target) {
                entry["mtimeMs"] = json!(stamp);
            }
        }
    }

    std::fs::write(&path, meta.to_string()).map_err(|error| error.to_string())
}

fn blank_meta(root: &Path) -> Value {
    json!({
        "version": index::META_VERSION,
        "indexCreatedAt": 0.0,
        "watched": [{ "path": "", "mtimeMs": mtime_ms(root).unwrap_or_default() }],
        "entryPoints": []
    })
}

fn delegate(root: &Path, touched: &[impl AsRef<str>]) -> Result<(), String> {
    let script = node_cli(root).ok_or("no encuentro el indexador de Node para este proyecto")?;
    let mut command = Command::new("node");
    command.arg(&script).arg("index");
    if !touched.is_empty() {
        command.arg("--only");
        for path in touched {
            command.arg(path.as_ref());
        }
    }
    let finished = command
        .current_dir(root)
        .output()
        .map_err(|error| format!("no pude lanzar node: {error}"))?;

    if finished.status.success() {
        return Ok(());
    }
    Err(format!(
        "el indexador falló: {}",
        String::from_utf8_lossy(&finished.stderr).trim()
    ))
}

pub fn node_cli(root: &Path) -> Option<PathBuf> {
    let near_project = [
        root.join("node_modules").join("sens-mcp").join("dist").join("cli.js"),
        root.join("dist").join("cli.js"),
    ];
    if let Some(found) = near_project.into_iter().find(|path| path.exists()) {
        return Some(found);
    }
    let beside_hook = crate::fallback::node_hook_path()?;
    let candidate = beside_hook.with_file_name("cli.js");
    candidate.exists().then_some(candidate)
}

fn drop_cache(root: &Path) {
    let _ = std::fs::remove_file(binindex::path(root));
}

fn mtime_ms(path: &Path) -> Option<f64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let since = modified.duration_since(UNIX_EPOCH).ok()?;
    Some(since.as_secs_f64() * 1000.0)
}

fn now_millis() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_secs_f64() * 1000.0)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("sens-refresh-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(path.join(".sens")).unwrap();
        path
    }

    fn write_meta(root: &Path) {
        let meta = json!({
            "version": 1,
            "indexCreatedAt": 1.0,
            "watched": [{ "path": "", "mtimeMs": 1.0 }],
            "entryPoints": []
        });
        std::fs::write(root.join(".sens").join("meta.json"), meta.to_string()).unwrap();
    }

    #[test]
    fn a_native_rebuild_leaves_the_index_and_the_meta_agreeing() {
        let root = temp_root("native");
        write_meta(&root);
        std::fs::write(root.join("boot.rs"), "pub fn boot() {}\n").unwrap();

        let refreshed = rebuild(&root).unwrap();
        assert!(matches!(refreshed, Refreshed::Native { files: 1, .. }));

        let raw = std::fs::read(root.join(".sens").join("index.json")).unwrap();
        let written: Value = serde_json::from_slice(&raw).unwrap();
        let meta = index::load_meta(&root, written["createdAt"].as_f64().unwrap());

        assert!(meta.is_some());
        assert_eq!(written["symbols"][0]["name"], "boot");
    }

    #[test]
    fn a_rebuild_throws_away_the_binary_cache() {
        let root = temp_root("cache");
        write_meta(&root);
        std::fs::write(root.join("boot.rs"), "pub fn boot() {}\n").unwrap();
        std::fs::write(binindex::path(&root), b"viejo").unwrap();

        rebuild(&root).unwrap();

        assert!(!binindex::path(&root).exists());
    }

    #[test]
    fn a_rebuild_refreshes_the_watched_stamps_so_the_index_reads_as_fresh() {
        let root = temp_root("watched");
        write_meta(&root);
        std::fs::write(root.join("boot.rs"), "pub fn boot() {}\n").unwrap();

        rebuild(&root).unwrap();

        let (index, meta) = crate::engine::load(&root).unwrap();
        assert_eq!(
            crate::freshness::check(&root, &index.files, &meta),
            crate::freshness::Freshness::Fresh
        );
    }

    #[test]
    fn a_project_sens_never_touched_gets_its_own_meta() {
        let root = temp_root("virgin");
        std::fs::write(root.join("boot.rs"), "pub fn boot() {}\n").unwrap();

        rebuild(&root).unwrap();

        let (index, meta) = crate::engine::load(&root).unwrap();
        assert_eq!(
            crate::freshness::check(&root, &index.files, &meta),
            crate::freshness::Freshness::Fresh
        );
        assert_eq!(index.symbols.len(), 1);
    }

    #[test]
    fn an_index_that_is_already_fresh_is_left_alone() {
        let root = temp_root("fresh");
        write_meta(&root);
        std::fs::write(root.join("boot.rs"), "pub fn boot() {}
").unwrap();

        assert!(matches!(rebuild(&root).unwrap(), Refreshed::Native { .. }));
        assert_eq!(rebuild(&root).unwrap(), Refreshed::Untouched);

        std::fs::write(root.join("boot.rs"), "pub fn boot() {}
pub fn start() {}
").unwrap();
        std::fs::File::options()
            .write(true)
            .open(root.join("boot.rs"))
            .unwrap()
            .set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(2))
            .unwrap();

        assert!(matches!(rebuild(&root).unwrap(), Refreshed::Native { .. }));
    }

    #[test]
    fn a_typescript_project_never_takes_the_native_path() {
        let root = temp_root("delegated");
        write_meta(&root);
        std::fs::write(root.join("boot.ts"), "export function boot() {}\n").unwrap();

        match rebuild(&root) {
            Ok(refreshed) => assert!(matches!(refreshed, Refreshed::Delegated { .. })),
            Err(failure) => assert!(failure.contains("indexador de Node")),
        }
    }

    #[test]
    fn the_native_indexer_refuses_a_project_it_would_index_only_halfway() {
        let root = temp_root("mixed");
        std::fs::write(root.join("boot.ts"), "export function boot() {}\n").unwrap();
        std::fs::write(root.join("boot.rs"), "pub fn boot() {}\n").unwrap();

        assert!(indexer::build(&root).is_none());
    }
}
