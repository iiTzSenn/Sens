use std::path::Path;
use std::time::UNIX_EPOCH;

use rayon::prelude::*;

use crate::index::{IndexMeta, ProjectIndex};

#[derive(PartialEq, Debug)]
pub enum Freshness {

    Fresh,

    Unsure,
}

fn mtime_ms(path: &Path) -> Option<f64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let d = modified.duration_since(UNIX_EPOCH).ok()?;
    Some(d.as_secs_f64() * 1000.0)
}

fn same_instant(a: f64, b: f64) -> bool {
    (a - b).abs() < 1.0
}

fn all_unchanged<T: Sync>(
    items: &[T],
    path_of: impl Fn(&T) -> std::path::PathBuf + Sync,
    recorded: impl Fn(&T) -> f64 + Sync,
) -> bool {
    items
        .par_iter()
        .all(|item| matches!(mtime_ms(&path_of(item)), Some(now) if same_instant(now, recorded(item))))
}

pub fn check(root: &Path, index: &ProjectIndex, meta: &IndexMeta) -> Freshness {

    let structure = all_unchanged(
        &meta.watched,
        |w| if w.path.is_empty() { root.to_path_buf() } else { root.join(&w.path) },
        |w| w.mtime_ms,
    );
    if !structure {
        return Freshness::Unsure;
    }

    if all_unchanged(&index.files, |f| root.join(&f.path), |f| f.mtime_ms) {
        Freshness::Fresh
    } else {
        Freshness::Unsure
    }
}
