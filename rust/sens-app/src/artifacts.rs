use std::collections::{HashMap, HashSet};
use std::fs::DirEntry;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use sens_agent::Step;
use sens_agent::session::{self, Entry};
use serde::Serialize;

use crate::projects::{self, Registry, Workspace};

const MEGABYTE: u64 = 1024 * 1024;
const IMAGE_CAP: u64 = 8 * MEGABYTE;
const TEXT_CAP: u64 = MEGABYTE;
const ATTACHED: &str = "\n\n--- ";
const SCHEMES: [&str; 2] = ["http://", "https://"];
const DOCUMENTS: [&str; 16] = [
    "pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp", "rtf", "png", "jpg", "jpeg", "gif", "webp",
];
const TRAILING: &[char] = &['.', ',', ';', ':', '!', '?'];
const IMAGES: [(&str, &str); 6] = [
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("svg", "image/svg+xml"),
];

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub kind: Kind,
    pub root: String,
    pub project: String,
    pub name: String,
    pub target: String,
    pub session: Option<String>,
    pub session_title: Option<String>,
    pub at: u64,
    pub bytes: Option<u64>,
}

#[derive(Serialize, Clone, Copy, PartialEq, Default, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Image,
    #[default]
    File,
    Link,
}

#[derive(Debug, PartialEq)]
pub enum Outside {
    Web(String),
    File(String),
    Folder(String),
}

pub fn all(registry: &Registry) -> Vec<Artifact> {
    let mut found: Vec<Artifact> = projects::workspaces(registry)
        .iter()
        .flat_map(of_workspace)
        .collect();
    found.sort_by(|a, b| b.at.cmp(&a.at));
    found
}

fn of_workspace(workspace: &Workspace) -> Vec<Artifact> {
    let root = Path::new(&workspace.root);
    let titles: HashMap<&str, &str> = workspace
        .sessions
        .iter()
        .map(|summary| (summary.id.as_str(), summary.title.as_str()))
        .collect();
    let links = workspace
        .sessions
        .iter()
        .flat_map(|summary| links_of(&summary.id, &session::read(root, &summary.id)));

    files_of(root)
        .into_iter()
        .chain(links)
        .map(|artifact| Artifact {
            root: workspace.root.clone(),
            project: workspace.name.clone(),
            session_title: artifact
                .session
                .as_deref()
                .and_then(|id| titles.get(id))
                .map(|title| title.to_string()),
            ..artifact
        })
        .collect()
}

pub fn urls_in(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = text;
    while let Some(start) = SCHEMES.iter().filter_map(|scheme| rest.find(scheme)).min() {
        let tail = &rest[start..];
        let end = tail.find(ends_url).unwrap_or(tail.len());
        let url = trimmed(&tail[..end]);
        if !name_of_url(url).is_empty() {
            found.push(url.to_string());
        }
        rest = &tail[end..];
    }
    found
}

fn ends_url(letter: char) -> bool {
    letter.is_whitespace() || matches!(letter, '"' | '\'' | '`' | '<' | '>')
}

fn trimmed(mut url: &str) -> &str {
    while let Some(last) = url.chars().last() {
        let loose = TRAILING.contains(&last)
            || (last == ')' && unpaired(url, '(', ')'))
            || (last == ']' && unpaired(url, '[', ']'));
        if !loose {
            break;
        }
        url = &url[..url.len() - last.len_utf8()];
    }
    url
}

fn unpaired(url: &str, open: char, close: char) -> bool {
    url.matches(close).count() > url.matches(open).count()
}

fn name_of_url(url: &str) -> &str {
    let bare = url.split_once("://").map_or(url, |(_, bare)| bare);
    bare.split(['?', '#']).next().unwrap_or(bare).trim_end_matches('/')
}

pub fn links_of(id: &str, entries: &[Entry]) -> Vec<Artifact> {
    let mut seen = HashSet::new();
    let mut found = Vec::new();
    for (at, text) in entries.iter().filter_map(said) {
        for url in urls_in(text) {
            if seen.insert(url.clone()) {
                found.push(link(id, at, url));
            }
        }
    }
    found
}

fn said(entry: &Entry) -> Option<(u64, &str)> {
    match entry {
        Entry::Task { at, text } => Some((*at, asked(text))),
        Entry::Beat {
            at,
            step: Step::Proposed { note, .. },
        } => Some((*at, note)),
        _ => None,
    }
}

fn asked(text: &str) -> &str {
    text.split_once(ATTACHED).map_or(text, |(asked, _)| asked)
}

fn link(id: &str, at: u64, url: String) -> Artifact {
    Artifact {
        kind: Kind::Link,
        name: name_of_url(&url).to_string(),
        target: url,
        session: Some(id.to_string()),
        at,
        ..Default::default()
    }
}

fn shelf(root: &Path) -> PathBuf {
    root.join(".sens").join("artifacts")
}

pub fn files_of(root: &Path) -> Vec<Artifact> {
    visible(&shelf(root))
        .flat_map(|entry| {
            let path = entry.path();
            if !path.is_dir() {
                return file_at(&path, None).into_iter().collect();
            }
            let id = entry.file_name().to_string_lossy().into_owned();
            visible(&path)
                .filter_map(|inner| file_at(&inner.path(), Some(id.clone())))
                .collect::<Vec<_>>()
        })
        .collect()
}

fn visible(folder: &Path) -> impl Iterator<Item = DirEntry> {
    std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
}

fn file_at(path: &Path, session: Option<String>) -> Option<Artifact> {
    let meta = path.metadata().ok().filter(|meta| meta.is_file())?;
    Some(Artifact {
        kind: mime_of(path).map_or(Kind::File, |_| Kind::Image),
        name: path.file_name()?.to_string_lossy().into_owned(),
        target: path.to_string_lossy().into_owned(),
        session,
        at: meta.modified().map(millis).unwrap_or_default(),
        bytes: Some(meta.len()),
        ..Default::default()
    })
}

fn millis(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis() as u64)
        .unwrap_or_default()
}

fn mime_of(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_string_lossy().to_lowercase();
    IMAGES
        .iter()
        .find(|(known, _)| *known == extension)
        .map(|(_, mime)| *mime)
}

pub fn vetted(registry: &Registry, path: &str) -> Result<PathBuf, String> {
    let given = Path::new(path);
    if given.components().any(|part| part == Component::ParentDir) {
        return Err(format!("{path} intenta salir de la carpeta de artefactos"));
    }
    let full = given
        .canonicalize()
        .map_err(|_| format!("{path} no existe"))?;
    let held = registry.projects.iter().any(|known| {
        shelf(Path::new(&known.root))
            .canonicalize()
            .is_ok_and(|base| full.starts_with(base))
    });
    if !held || !full.is_file() {
        return Err(format!("{path} no es un artefacto de ningún proyecto"));
    }
    Ok(full)
}

pub fn data(registry: &Registry, path: &str) -> Result<String, String> {
    let full = vetted(registry, path)?;
    let mime = mime_of(&full).ok_or_else(|| format!("{path} no es una imagen"))?;
    let bytes = capped(&full, path, IMAGE_CAP)?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

pub fn text(registry: &Registry, path: &str) -> Result<String, String> {
    let bytes = capped(&vetted(registry, path)?, path, TEXT_CAP)?;
    String::from_utf8(bytes).map_err(|_| format!("{path} no es texto UTF-8"))
}

fn capped(full: &Path, path: &str, cap: u64) -> Result<Vec<u8>, String> {
    let size = full
        .metadata()
        .map_err(|error| format!("no pude leer {path}: {error}"))?
        .len();
    if size > cap {
        return Err(format!("{path} pasa de {} MB", cap / MEGABYTE));
    }
    std::fs::read(full).map_err(|error| format!("no pude leer {path}: {error}"))
}

pub fn destination(registry: &Registry, target: &str) -> Result<Outside, String> {
    if is_web(target) {
        return Ok(Outside::Web(target.to_string()));
    }
    if target.contains("://") {
        return Err(format!("solo abro enlaces http y https, no {target}"));
    }
    let full = vetted(registry, target)?;
    if is_document(&full) {
        return Ok(Outside::File(target.to_string()));
    }
    Ok(Outside::Folder(target.to_string()))
}

fn is_document(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| DOCUMENTS.contains(&extension.to_ascii_lowercase().as_str()))
}

fn is_web(target: &str) -> bool {
    let lower = target.to_ascii_lowercase();
    SCHEMES
        .iter()
        .any(|scheme| lower.len() > scheme.len() && lower.starts_with(scheme))
        && !target.chars().any(|letter| letter.is_whitespace() || letter.is_control())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::Known;

    fn temp_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("sens-artifacts-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn put(path: &Path, body: &[u8]) -> String {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn registry_of(roots: &[&Path]) -> Registry {
        Registry {
            last: None,
            projects: roots
                .iter()
                .map(|root| Known { root: root.to_string_lossy().into_owned(), opened: 1 })
                .collect(),
        }
    }

    fn task(at: u64, text: &str) -> Entry {
        Entry::Task { at, text: text.into() }
    }

    fn proposed(at: u64, note: &str) -> Entry {
        let step = Step::Proposed { paths: Vec::new(), model: "m".into(), note: note.into() };
        Entry::Beat { at, step }
    }

    #[test]
    fn trailing_punctuation_is_not_part_of_the_url() {
        let found = urls_in("Mira https://docs.rs/serde/latest. Y https://a.com/x?, luego https://b.com!");
        assert_eq!(found, vec!["https://docs.rs/serde/latest", "https://a.com/x", "https://b.com"]);
    }

    #[test]
    fn a_closing_parenthesis_stays_when_the_url_opened_it() {
        let found = urls_in("(ver https://en.wikipedia.org/wiki/Rust_(programming_language)) y [https://x.dev/a]");
        assert_eq!(
            found,
            vec!["https://en.wikipedia.org/wiki/Rust_(programming_language)", "https://x.dev/a"]
        );
    }

    #[test]
    fn a_url_ends_at_spaces_quotes_and_angle_brackets() {
        let found = urls_in("\"http://a.com/1\" <https://b.com/2> 'https://c.com/3'\nhttps://d.com/4");
        assert_eq!(found, vec!["http://a.com/1", "https://b.com/2", "https://c.com/3", "https://d.com/4"]);
    }

    #[test]
    fn text_without_urls_gives_nothing() {
        assert!(urls_in("sin enlaces, ni ftp://x.com ni https:// a secas").is_empty());
        assert!(urls_in("").is_empty());
    }

    #[test]
    fn links_come_only_from_what_was_asked_and_from_proposal_notes() {
        let entries = vec![
            task(10, "Usa https://a.com/doc\n\n--- src/x.rs ---\nhttps://adjunto.com"),
            proposed(20, "Sigo https://b.com/guia."),
            Entry::Failed { at: 30, reason: "https://fallo.com".into() },
        ];

        let found = links_of("s1", &entries);
        let targets: Vec<&str> = found.iter().map(|link| link.target.as_str()).collect();

        assert_eq!(targets, vec!["https://a.com/doc", "https://b.com/guia"]);
        assert_eq!(found[0].kind, Kind::Link);
        assert_eq!(found[0].name, "a.com/doc");
        assert_eq!(found[1].at, 20);
        assert_eq!(found[1].session.as_deref(), Some("s1"));
    }

    #[test]
    fn a_link_repeated_in_a_session_keeps_its_first_appearance() {
        let entries = vec![task(1, "https://a.com/x"), proposed(2, "otra vez https://a.com/x")];

        let found = links_of("s1", &entries);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].at, 1);
    }

    #[test]
    fn a_link_is_named_by_host_and_path_without_the_scheme() {
        let found = links_of("s1", &[task(1, "https://docs.rs/serde/latest/?q=1#top")]);
        assert_eq!(found[0].name, "docs.rs/serde/latest");
    }

    #[test]
    fn files_are_classified_by_extension_and_belong_to_their_folder_session() {
        let root = temp_root("classify");
        let shelf = shelf(&root);
        put(&shelf.join("s1").join("Captura.PNG"), b"png");
        put(&shelf.join("s1").join("logo.svg"), b"<svg/>");
        put(&shelf.join("informe.md"), b"# hola");

        let mut found = files_of(&root);
        found.sort_by(|a, b| a.name.cmp(&b.name));
        let seen: Vec<(&str, Kind, Option<&str>)> = found
            .iter()
            .map(|file| (file.name.as_str(), file.kind, file.session.as_deref()))
            .collect();

        assert_eq!(
            seen,
            vec![
                ("Captura.PNG", Kind::Image, Some("s1")),
                ("informe.md", Kind::File, None),
                ("logo.svg", Kind::Image, Some("s1")),
            ]
        );
        assert_eq!(found[1].bytes, Some(6));
        assert!(found[1].at > 0);
    }

    #[test]
    fn hidden_files_and_deeper_folders_are_ignored() {
        let root = temp_root("hidden");
        let shelf = shelf(&root);
        put(&shelf.join(".oculto"), b"x");
        put(&shelf.join(".sesion").join("a.txt"), b"x");
        put(&shelf.join("s1").join(".oculto.png"), b"x");
        put(&shelf.join("s1").join("hondo").join("b.txt"), b"x");
        put(&shelf.join("s1").join("c.txt"), b"x");

        let found = files_of(&root);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "c.txt");
    }

    #[test]
    fn a_project_without_artifacts_gives_nothing() {
        assert!(files_of(&temp_root("bare")).is_empty());
    }

    #[test]
    fn only_files_inside_a_known_artifacts_folder_are_accepted() {
        let root = temp_root("vetting");
        let inside = put(&shelf(&root).join("s1").join("a.txt"), b"x");
        let beside = put(&root.join("secreto.txt"), b"x");
        let registry = registry_of(&[&root]);

        assert!(vetted(&registry, &inside).is_ok());
        assert!(vetted(&registry, &beside).is_err());
        assert!(vetted(&registry_of(&[]), &inside).is_err());
        assert!(vetted(&registry, &shelf(&root).to_string_lossy()).is_err());
        assert!(vetted(&registry, &format!("{}/nada.txt", shelf(&root).display())).is_err());
    }

    #[test]
    fn a_path_that_climbs_out_is_rejected_even_if_it_lands_back_inside() {
        let root = temp_root("climb");
        put(&shelf(&root).join("s1").join("a.txt"), b"x");
        let registry = registry_of(&[&root]);
        let climbing = shelf(&root).join("s1").join("..").join("s1").join("a.txt");

        let refused = vetted(&registry, &climbing.to_string_lossy()).unwrap_err();

        assert!(refused.contains("salir"));
    }

    #[test]
    fn an_image_comes_back_as_a_data_url_with_its_mime() {
        let root = temp_root("data");
        let logo = put(&shelf(&root).join("logo.svg"), b"<svg/>");
        let notes = put(&shelf(&root).join("notas.txt"), b"hola");
        let registry = registry_of(&[&root]);

        assert_eq!(data(&registry, &logo).unwrap(), "data:image/svg+xml;base64,PHN2Zy8+");
        assert!(data(&registry, &notes).is_err());
    }

    #[test]
    fn text_is_read_whole_and_oversized_files_are_refused() {
        let root = temp_root("text");
        let notes = put(&shelf(&root).join("notas.md"), "añade".as_bytes());
        let huge = put(&shelf(&root).join("enorme.log"), &vec![b'a'; (TEXT_CAP + 1) as usize]);
        let registry = registry_of(&[&root]);

        assert_eq!(text(&registry, &notes).unwrap(), "añade");
        assert!(text(&registry, &huge).unwrap_err().contains("1 MB"));
    }

    #[test]
    fn opening_accepts_web_links_and_artifacts_but_nothing_else() {
        let root = temp_root("open");
        let inside = put(&shelf(&root).join("a.pdf"), b"x");
        let beside = put(&root.join("b.pdf"), b"x");
        let registry = registry_of(&[&root]);

        assert_eq!(
            destination(&registry, "https://a.com/x"),
            Ok(Outside::Web("https://a.com/x".into()))
        );
        assert_eq!(destination(&registry, &inside), Ok(Outside::File(inside.clone())));
        assert!(destination(&registry, &beside).is_err());
        assert!(destination(&registry, "file:///C:/Windows/notepad.exe").is_err());
        assert!(destination(&registry, "javascript:alert(1)").is_err());
        assert!(destination(&registry, "https://a.com/x y").is_err());
    }

    #[test]
    fn a_runnable_artifact_is_shown_in_its_folder_instead_of_opened() {
        let root = temp_root("runnable");
        let script = put(&shelf(&root).join("arranca.bat"), b"x");
        let registry = registry_of(&[&root]);

        assert_eq!(destination(&registry, &script), Ok(Outside::Folder(script.clone())));
    }

    #[test]
    fn everything_comes_back_newest_first_with_its_project_and_session_title() {
        let root = temp_root("all");
        session::append(&root, "s1", &task(100, "Añade validación https://a.com/x")).unwrap();
        session::append(&root, "s2", &proposed(200, "https://solo-nota.com")).unwrap();
        put(&shelf(&root).join("s1").join("captura.png"), b"png");
        let registry = registry_of(&[&root]);

        let found = all(&registry);
        let targets: Vec<&str> = found.iter().map(|artifact| artifact.name.as_str()).collect();

        assert_eq!(targets, vec!["captura.png", "a.com/x"]);
        assert!(found.iter().all(|artifact| artifact.project == "sens-artifacts-all"));
        assert!(found.iter().all(|artifact| artifact.root == root.to_string_lossy()));
        assert!(
            found
                .iter()
                .all(|artifact| artifact.session_title.as_deref() == Some("Añade validación https://a.com/x"))
        );
    }
}
