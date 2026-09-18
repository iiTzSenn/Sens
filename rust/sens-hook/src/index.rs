//! The on-disk index, as the TypeScript side writes it.
//!
//! Deliberately a *reader*: indexing stays in Node for now, and this side only
//! has to agree on the shape. Anything it does not need is skipped rather than
//! modelled, so a field added on the TypeScript side cannot break the hook.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::value::RawValue;

/// Must match `INDEX_SCHEMA_VERSION` in src/types.ts. A different version means
/// the shape or the indexing logic changed, so the cache is not ours to read.
pub const INDEX_SCHEMA_VERSION: u32 = 6;

#[derive(Deserialize)]
pub struct SymbolInfo {
    pub id: String,
    pub name: String,
    pub file: String,
    pub line: u32,
    pub signature: String,
    #[serde(default)]
    pub exported: bool,
}

#[derive(Deserialize)]
pub struct Reference {
    pub file: String,
    pub line: u32,
    /// Id of the symbol whose body contains this use, if any.
    #[serde(default)]
    pub from: Option<String>,
}

#[derive(Deserialize)]
pub struct FileInfo {
    pub path: String,
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: f64,
}

/// The references map is the bulk of the file — tens of thousands of entries,
/// of which one query needs a handful. Capturing each value as raw JSON skips
/// building all of them and parses only what is actually asked for.
#[derive(Deserialize)]
pub struct ProjectIndex<'a> {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    #[serde(rename = "createdAt")]
    pub created_at: f64,
    pub files: Vec<FileInfo>,
    pub symbols: Vec<SymbolInfo>,
    #[serde(borrow)]
    pub references: HashMap<&'a str, &'a RawValue>,
}

impl ProjectIndex<'_> {
    /// Use sites for a symbol id, parsed on demand.
    pub fn references_for(&self, id: &str) -> Vec<Reference> {
        self.references
            .get(id)
            .and_then(|raw| serde_json::from_str(raw.get()).ok())
            .unwrap_or_default()
    }
}

/// `.sens/meta.json` — the freshness metadata written alongside the index.
#[derive(Deserialize)]
pub struct IndexMeta {
    pub version: u32,
    #[serde(rename = "indexCreatedAt")]
    pub index_created_at: f64,
    pub watched: Vec<WatchedPath>,
}

#[derive(Deserialize)]
pub struct WatchedPath {
    pub path: String,
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: f64,
}

pub const META_VERSION: u32 = 1;

pub fn sens_dir(root: &Path) -> PathBuf {
    root.join(".sens")
}

/// Read the index file into memory. Kept separate from parsing because the
/// parsed form borrows from this buffer.
pub fn read_index(root: &Path) -> Option<Vec<u8>> {
    std::fs::read(sens_dir(root).join("index.json")).ok()
}

pub fn parse_index(raw: &[u8]) -> Option<ProjectIndex<'_>> {
    let index: ProjectIndex = serde_json::from_slice(raw).ok()?;
    (index.schema_version == INDEX_SCHEMA_VERSION).then_some(index)
}

pub fn load_meta(root: &Path, index_created_at: f64) -> Option<IndexMeta> {
    let raw = std::fs::read(sens_dir(root).join("meta.json")).ok()?;
    let meta: IndexMeta = serde_json::from_slice(&raw).ok()?;
    (meta.version == META_VERSION
        && meta.index_created_at == index_created_at
        && !meta.watched.is_empty())
    .then_some(meta)
}
