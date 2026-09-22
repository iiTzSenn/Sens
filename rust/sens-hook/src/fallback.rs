use std::path::{Path, PathBuf};

const MAX_ANCESTORS: usize = 8;

pub fn node_hook_path() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os("SENS_NODE_HOOK") {
        let path = PathBuf::from(explicit);
        return path.exists().then_some(path);
    }
    let exe = std::env::current_exe().ok()?;
    let mut dir = exe.parent()?;
    for _ in 0..MAX_ANCESTORS {
        if let Some(found) = hook_under(dir) {
            return Some(found);
        }
        dir = dir.parent()?;
    }
    None
}

fn hook_under(dir: &Path) -> Option<PathBuf> {
    let candidates = [
        dir.join("dist").join("hook.js"),
        dir.join("node_modules").join("sens-mcp").join("dist").join("hook.js"),
    ];
    candidates.into_iter().find(|p| p.exists())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn finds_a_sibling_dist_directory() {
        let root = std::env::temp_dir().join("sens-fallback-sibling");
        let dist = root.join("dist");
        fs::create_dir_all(&dist).unwrap();
        fs::write(dist.join("hook.js"), "").unwrap();
        assert_eq!(hook_under(&root), Some(dist.join("hook.js")));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn finds_the_package_inside_node_modules() {
        let root = std::env::temp_dir().join("sens-fallback-nm");
        let dist = root.join("node_modules").join("sens-mcp").join("dist");
        fs::create_dir_all(&dist).unwrap();
        fs::write(dist.join("hook.js"), "").unwrap();
        assert_eq!(hook_under(&root), Some(dist.join("hook.js")));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn reports_nothing_when_there_is_no_node_half() {
        let root = std::env::temp_dir().join("sens-fallback-empty");
        fs::create_dir_all(&root).unwrap();
        assert_eq!(hook_under(&root), None);
        fs::remove_dir_all(&root).ok();
    }
}
