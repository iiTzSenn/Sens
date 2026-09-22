use std::path::Path;

use crate::binindex::{self, BinIndex};
use crate::index::{self, IndexMeta};

pub fn load(root: &Path) -> Option<(BinIndex, IndexMeta)> {
    let json_path = index::sens_dir(root).join("index.json");
    let json_len = std::fs::metadata(&json_path).ok()?.len();

    let use_cache = std::env::var_os("SENS_NO_BINCACHE").is_none();
    if let Some(cached) = use_cache.then(|| binindex::load(root, json_len)).flatten() {
        let meta = index::load_meta(root, cached.created_at)?;
        return Some((cached, meta));
    }

    let buffer = std::fs::read(&json_path).ok()?;
    let built = binindex::from_json(&buffer)?;
    if built.schema_version != index::INDEX_SCHEMA_VERSION {
        return None;
    }
    let meta = index::load_meta(root, built.created_at)?;
    if use_cache {
        binindex::save(root, &built);
    }
    Some((built, meta))
}
