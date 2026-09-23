use std::collections::HashSet;
use std::path::{Path, PathBuf};

use ignore::WalkBuilder;
use serde::Serialize;

const GIT: &str = ".git";
const FOUND_CAP: usize = 200;

#[derive(Serialize, Debug, PartialEq)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub dir: bool,
    pub ignored: bool,
}

pub fn home(root: &Path) -> Result<PathBuf, String> {
    root.canonicalize()
        .map_err(|error| format!("proyecto ilegible: {error}"))
}

pub fn inside(root: &Path, path: &str) -> Result<PathBuf, String> {
    let base = home(root)?;
    let full = base
        .join(path)
        .canonicalize()
        .map_err(|_| format!("{path} no existe"))?;
    if !full.starts_with(&base) {
        return Err(format!("{path} está fuera del proyecto"));
    }
    Ok(full)
}

pub fn folder(root: &Path, path: &str) -> Result<Vec<Entry>, String> {
    let base = home(root)?;
    let here = inside(root, path)?;
    let kept: HashSet<PathBuf> = walker(&here)
        .max_depth(Some(1))
        .build()
        .flatten()
        .map(|entry| entry.into_path())
        .collect();

    let listed = std::fs::read_dir(&here).map_err(|error| format!("no pude leer {path}: {error}"))?;
    let mut entries: Vec<Entry> = listed
        .flatten()
        .filter(|entry| entry.file_name() != GIT)
        .map(|entry| {
            let full = entry.path();
            Entry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: relative(&base, &full),
                dir: full.is_dir(),
                ignored: !kept.contains(&full),
            }
        })
        .collect();
    entries.sort_by(|a, b| {
        b.dir
            .cmp(&a.dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

pub fn search(root: &Path, needle: &str) -> Result<Vec<Entry>, String> {
    let base = home(root)?;
    let needle = needle.to_lowercase();
    let mut found = Vec::new();
    for entry in walker(&base).build().flatten() {
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let path = relative(&base, entry.path());
        if !path.to_lowercase().contains(&needle) {
            continue;
        }
        found.push(Entry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path,
            dir: false,
            ignored: false,
        });
        if found.len() == FOUND_CAP {
            break;
        }
    }
    Ok(found)
}

fn walker(start: &Path) -> WalkBuilder {
    let mut walk = WalkBuilder::new(start);
    walk.hidden(false)
        .require_git(false)
        .filter_entry(|entry| entry.file_name() != GIT);
    walk
}

fn relative(base: &Path, full: &Path) -> String {
    full.strip_prefix(base)
        .unwrap_or(full)
        .components()
        .filter_map(|part| part.as_os_str().to_str())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let here = std::env::temp_dir().join(format!("sens-files-{name}"));
        let _ = std::fs::remove_dir_all(&here);
        std::fs::create_dir_all(&here).expect("scratch");
        here
    }

    fn touch(root: &Path, path: &str) {
        let full = root.join(path);
        std::fs::create_dir_all(full.parent().expect("parent")).expect("dirs");
        std::fs::write(full, "x").expect("file");
    }

    #[test]
    fn lists_one_level_with_folders_first_and_dims_what_git_ignores() {
        let here = scratch("folder");
        std::fs::create_dir_all(here.join(GIT)).expect("git");
        std::fs::write(here.join(".gitignore"), "dist/\n").expect("ignore");
        touch(&here, "src/app.ts");
        touch(&here, "dist/index.html");
        touch(&here, "README.md");
        touch(&here, "Zeta.txt");

        let top = folder(&here, "").expect("top");
        let names: Vec<&str> = top.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, ["dist", "src", ".gitignore", "README.md", "Zeta.txt"]);
        assert!(top[0].dir && top[0].ignored);
        assert!(top[1].dir && !top[1].ignored);
        assert!(!top[3].dir && !top[3].ignored);

        let nested = folder(&here, "src").expect("src");
        assert_eq!(nested, [Entry {
            name: "app.ts".into(),
            path: "src/app.ts".into(),
            dir: false,
            ignored: false,
        }]);
    }

    #[test]
    fn finds_files_deep_by_any_part_of_their_path() {
        let here = scratch("search");
        std::fs::write(here.join(".gitignore"), "node_modules/\n").expect("ignore");
        touch(&here, "web/css/estilos.css");
        touch(&here, "web/index.html");
        touch(&here, "node_modules/pkg/estilos.css");

        let found = search(&here, "ESTILOS").expect("search");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "estilos.css");
        assert_eq!(found[0].path, "web/css/estilos.css");

        let by_folder = search(&here, "web/").expect("folder");
        assert_eq!(by_folder.len(), 2);
    }

    #[test]
    fn refuses_paths_outside_the_project() {
        let here = scratch("outside");
        touch(&here, "web/index.html");
        touch(&here, "secreto.txt");

        assert!(inside(&here.join("web"), "../secreto.txt").is_err());
        assert!(folder(&here.join("web"), "..").is_err());
        assert!(inside(&here.join("web"), "index.html").is_ok());
    }
}
