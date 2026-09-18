//! Is the cached index still what is on disk?
//!
//! This is a deliberately *narrower* check than the TypeScript one. It answers
//! only the fast path: nothing moved at all. The moment anything differs — a
//! changed mtime, a missing file, no metadata — it returns `Unsure`, and the
//! caller hands the whole thing to Node, which can run the full scan and tell
//! an indexable new file from an ignored one.
//!
//! The asymmetry is the point: being wrong about "fresh" means answering the
//! model from a stale index, which is the one failure this tool cannot afford.
//! Being wrong about "unsure" just costs the Node round trip we pay today.

use std::path::Path;
use std::time::UNIX_EPOCH;

use rayon::prelude::*;

use crate::index::{IndexMeta, ProjectIndex};

#[derive(PartialEq, Debug)]
pub enum Freshness {
    /// Nothing moved: the index can be trusted as-is.
    Fresh,
    /// Something differs, or there is not enough information to tell.
    Unsure,
}

/// Modification time in milliseconds since the epoch, matching what Node's
/// `statSync().mtimeMs` records.
fn mtime_ms(path: &Path) -> Option<f64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let d = modified.duration_since(UNIX_EPOCH).ok()?;
    Some(d.as_secs_f64() * 1000.0)
}

/// Same instant, allowing for the last bit of float conversion on either side.
/// A change landing inside this window is the clock-granularity race the
/// TypeScript check already has, not something this tolerance introduces.
fn same_instant(a: f64, b: f64) -> bool {
    (a - b).abs() < 1.0
}

/// Thousands of independent `stat` calls, each one a syscall that spends most
/// of its time waiting. Running them across the pool is most of why this is
/// worth doing natively at all.
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
    // Structure first: far cheaper than stat-ing every indexed file, and a
    // directory whose mtime moved means something was added or removed.
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
