use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::value::RawValue;

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

    #[serde(default)]
    pub from: Option<String>,
}

#[derive(Deserialize)]
pub struct FileInfo {
    pub path: String,
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: f64,
}

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

    pub fn references_for(&self, id: &str) -> Vec<Reference> {
        self.references
            .get(id)
            .and_then(|raw| serde_json::from_str(raw.get()).ok())
            .unwrap_or_default()
    }
}

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
