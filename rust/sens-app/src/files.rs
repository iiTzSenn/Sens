use std::collections::HashSet;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use ignore::WalkBuilder;
use serde::Serialize;

use crate::artifacts::{self, IMAGE_CAP, MEGABYTE};

const GIT: &str = ".git";
const FOUND_CAP: usize = 200;
const TEXT_CAP: u64 = 8 * MEGABYTE;
const SNIFF: u64 = 8000;

#[derive(Serialize, Debug, PartialEq)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub dir: bool,
    pub ignored: bool,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Opened {
    Text { text: String },
    Picture { data: String, bytes: u64 },
    TooBig { bytes: u64, cap: u64 },
    Binary { bytes: u64 },
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

pub fn open(root: &Path, path: &str) -> Result<Opened, String> {
    let full = inside(root, path)?;
    let unread = |error: std::io::Error| format!("no pude leer {path}: {error}");
    let meta = full.metadata().map_err(unread)?;
    if !meta.is_file() {
        return Err(format!("{path} no es un fichero"));
    }
    let bytes = meta.len();

    let mut file = File::open(&full).map_err(unread)?;
    let mut head = Vec::new();
    file.by_ref().take(SNIFF).read_to_end(&mut head).map_err(unread)?;
    let text = starts_as_text(&head);
    let mime = if text { None } else { artifacts::mime_of(&full) };
    if !text && mime.is_none() {
        return Ok(Opened::Binary { bytes });
    }

    let cap = if text { TEXT_CAP } else { IMAGE_CAP };
    if bytes > cap {
        return Ok(Opened::TooBig { bytes, cap });
    }
    let Some(raw) = rest(file, head, cap).map_err(unread)? else {
        let bytes = full.metadata().map_or(cap + 1, |meta| meta.len());
        return Ok(Opened::TooBig { bytes, cap });
    };
    Ok(match mime {
        Some(mime) => Opened::Picture { data: artifacts::data_url(mime, &raw), bytes: raw.len() as u64 },
        None => String::from_utf8(raw).map_or(Opened::Binary { bytes }, |text| Opened::Text { text }),
    })
}

pub fn bounded(full: &Path, cap: u64) -> std::io::Result<Option<Vec<u8>>> {
    if full.metadata()?.len() > cap {
        return Ok(None);
    }
    rest(File::open(full)?, Vec::new(), cap)
}

fn rest(file: File, mut read: Vec<u8>, cap: u64) -> std::io::Result<Option<Vec<u8>>> {
    file.take((cap + 1).saturating_sub(read.len() as u64))
        .read_to_end(&mut read)?;
    Ok((read.len() as u64 <= cap).then_some(read))
}

fn starts_as_text(head: &[u8]) -> bool {
    !head.contains(&0)
        && std::str::from_utf8(head).map_or_else(|error| error.error_len().is_none(), |_| true)
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

    fn put(root: &Path, path: &str, body: &[u8]) {
        std::fs::write(root.join(path), body).expect("file");
    }

    fn grow(root: &Path, path: &str, head: &[u8], size: u64) {
        put(root, path, head);
        File::options().write(true).open(root.join(path)).expect("file").set_len(size).expect("size");
    }

    #[test]
    fn opens_text_as_text_and_svg_as_code() {
        let here = scratch("open-text");
        put(&here, "notas.md", "# Año\n".as_bytes());
        put(&here, "logo.svg", b"<svg/>");

        assert_eq!(open(&here, "notas.md"), Ok(Opened::Text { text: "# Año\n".into() }));
        assert_eq!(open(&here, "logo.svg"), Ok(Opened::Text { text: "<svg/>".into() }));
    }

    #[test]
    fn opens_a_picture_as_a_data_url_unless_it_is_too_big() {
        let here = scratch("open-picture");
        put(&here, "gandhi.JPG", &[0xff, 0xd8, 0xff]);
        put(&here, "favicon.ico", &[0, 0, 1, 0]);
        put(&here, "notas.png", b"hola");
        grow(&here, "enorme.png", b"", IMAGE_CAP + 1);

        assert_eq!(open(&here, "gandhi.JPG"), Ok(Opened::Picture { data: "data:image/jpeg;base64,/9j/".into(), bytes: 3 }));
        assert_eq!(open(&here, "favicon.ico"), Ok(Opened::Picture { data: "data:image/x-icon;base64,AAABAA==".into(), bytes: 4 }));
        assert_eq!(open(&here, "notas.png"), Ok(Opened::Text { text: "hola".into() }));
        assert_eq!(open(&here, "enorme.png"), Ok(Opened::TooBig { bytes: IMAGE_CAP + 1, cap: IMAGE_CAP }));
    }

    #[test]
    fn does_not_send_a_text_too_big_to_show() {
        let here = scratch("open-huge");
        grow(&here, "enorme.log", &[b'a'; SNIFF as usize], TEXT_CAP + 1);

        assert_eq!(open(&here, "enorme.log"), Ok(Opened::TooBig { bytes: TEXT_CAP + 1, cap: TEXT_CAP }));
    }

    #[test]
    fn a_bounded_read_stops_past_its_cap_whatever_the_size_said() {
        let here = scratch("bounded");
        put(&here, "crece.bin", b"abcd");
        let file = || File::open(here.join("crece.bin")).expect("file");

        assert_eq!(rest(file(), Vec::new(), 3).expect("read"), None);
        assert_eq!(rest(file(), Vec::new(), 4).expect("read"), Some(b"abcd".to_vec()));
        assert_eq!(bounded(&here.join("crece.bin"), 3).expect("read"), None);
    }

    #[test]
    fn opens_what_is_not_utf8_text_as_its_size() {
        let here = scratch("open-binary");
        put(&here, "app.exe", b"MZ\x90\0\x03");
        put(&here, "latin1.txt", b"a\xf1o");
        let mut late = vec![b'a'; SNIFF as usize + 10];
        late.push(0xff);
        put(&here, "late.log", &late);

        assert_eq!(open(&here, "app.exe"), Ok(Opened::Binary { bytes: 5 }));
        assert_eq!(open(&here, "latin1.txt"), Ok(Opened::Binary { bytes: 3 }));
        assert_eq!(open(&here, "late.log"), Ok(Opened::Binary { bytes: SNIFF + 11 }));
    }

    #[test]
    fn a_character_split_by_the_first_read_is_still_text() {
        let here = scratch("open-split");
        let text = format!("{}ñ", "a".repeat(SNIFF as usize - 1));
        put(&here, "split.txt", text.as_bytes());

        assert_eq!(open(&here, "split.txt"), Ok(Opened::Text { text }));
    }

    #[test]
    fn does_not_open_a_folder_or_what_is_missing() {
        let here = scratch("open-missing");
        touch(&here, "src/app.ts");

        assert_eq!(open(&here, "src"), Err("src no es un fichero".into()));
        assert_eq!(open(&here, "nada.txt"), Err("nada.txt no existe".into()));
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
