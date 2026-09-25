use std::cmp::Reverse;
use std::collections::{HashMap, HashSet};
use std::fs::DirEntry;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use sens_agent::chat::Event;
use sens_agent::said;
use sens_agent::session::{self, Entry};
use serde::Serialize;

use crate::files;
use crate::projects::{self, Registry, Workspace};

pub const MEGABYTE: u64 = 1024 * 1024;
pub const IMAGE_CAP: u64 = 8 * MEGABYTE;
const TEXT_CAP: u64 = MEGABYTE;
const SCHEMES: [&str; 2] = ["http://", "https://"];
const DOCUMENTS: [&str; 16] = [
    "pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp", "rtf", "png", "jpg", "jpeg", "gif", "webp",
];
const TRAILING: &[char] = &['.', ',', ';', ':', '!', '?'];
const PICTURE_CAP: usize = 5 * 1024 * 1024;
const OUTSIDE_CAP: u64 = 20 * MEGABYTE;
const RAW_PICTURE_CAP: u64 = 25 * MEGABYTE;
const FOLDER_COUNT: usize = 10_000;
const STAGED_FOR: Duration = Duration::from_secs(24 * 60 * 60);
const UNSAFE: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
const VERBATIM: &str = r"\\?\";
const VERBATIM_SHARE: &str = r"\\?\UNC\";
const NAME_CAP: usize = 120;
const RESERVED: [&str; 6] = ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"];
const PASTEABLE: [(&str, &str); 4] = [
    ("image/png", "png"),
    ("image/jpeg", "jpg"),
    ("image/gif", "gif"),
    ("image/webp", "webp"),
];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Attached {
    File {
        path: String,
        name: String,
        bytes: u64,
        outside: bool,
    },
    Folder {
        path: String,
        name: String,
        entries: u64,
        outside: bool,
    },
    Picture {
        path: String,
        name: String,
        media_type: String,
        data: String,
        bytes: u64,
        outside: bool,
    },
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Why {
    Missing,
    Unreadable,
    TooBig,
    Project,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Refused {
    pub name: String,
    pub why: Why,
}

#[derive(Serialize, Default, Debug)]
pub struct Attachments {
    pub items: Vec<Attached>,
    pub refused: Vec<Refused>,
}
const IMAGES: [(&str, &str); 9] = [
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("svg", "image/svg+xml"),
    ("avif", "image/avif"),
    ("bmp", "image/bmp"),
    ("ico", "image/x-icon"),
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
    found.sort_by_key(|artifact| Reverse(artifact.at));
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
        Entry::Task { at, text, .. } => Some((*at, text)),
        Entry::Agent {
            at,
            event: Event::Said { text },
        } => Some((*at, text)),
        _ => None,
    }
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

fn session_shelf(root: &Path, session: &str) -> Result<PathBuf, String> {
    if session.is_empty() || !session.chars().all(|letter| letter.is_ascii_alphanumeric() || letter == '-') {
        return Err(said!(
            en: "the session {session} doesn’t have a valid name",
            es: "la sesión {session} no tiene un nombre válido",
            fr: "la session {session} n’a pas de nom valide",
            de: "die Sitzung {session} hat keinen gültigen Namen",
            ja: "セッション {session} の名前が無効です",
            zh: "会话 {session} 的名称无效",
        ));
    }
    Ok(shelf(root).join(session))
}

fn made(root: &Path, folder: &Path) -> Result<(), String> {
    std::fs::create_dir_all(folder).map_err(|error| files::uncreated(folder, error))?;
    session::keep_from_git(root);
    Ok(())
}

fn too_big(name: &str, cap: u64) -> String {
    said!(
        en: "{name} is over {cap} MB",
        es: "{name} pasa de {cap} MB",
        fr: "{name} dépasse {cap} Mo",
        de: "{name} ist größer als {cap} MB",
        ja: "{name} が {cap} MB を超えています",
        zh: "{name} 超过 {cap} MB",
        cap = cap / MEGABYTE,
    )
}

fn slashed(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn keep_picture(root: &Path, session: &str, at: usize, media_type: &str, data: &str) -> Result<String, String> {
    let extension = PASTEABLE
        .iter()
        .find(|(mime, _)| *mime == media_type)
        .map(|(_, extension)| *extension)
        .ok_or_else(|| {
            said!(
                en: "{media_type} pictures aren’t supported: use PNG, JPEG, GIF or WebP",
                es: "no admito imágenes {media_type}: usa PNG, JPEG, GIF o WebP",
                fr: "les images {media_type} ne sont pas prises en charge : utilisez PNG, JPEG, GIF ou WebP",
                de: "Bilder im Format {media_type} werden nicht unterstützt: nutze PNG, JPEG, GIF oder WebP",
                ja: "{media_type} の画像には対応していません。PNG、JPEG、GIF、WebP を使ってください",
                zh: "不支持 {media_type} 图片：请使用 PNG、JPEG、GIF 或 WebP",
            )
        })?;
    let folder = session_shelf(root, session)?;
    let bytes = STANDARD.decode(data).map_err(|error| {
        said!(
            en: "the picture arrived corrupted: {error}",
            es: "la imagen llegó rota: {error}",
            fr: "l’image est arrivée corrompue : {error}",
            de: "das Bild kam beschädigt an: {error}",
            ja: "画像が壊れた状態で届きました: {error}",
            zh: "图片已损坏：{error}",
        )
    })?;
    if bytes.len() > PICTURE_CAP {
        return Err(said!(
            en: "the picture is over {cap} MB",
            es: "la imagen pasa de {cap} MB",
            fr: "l’image dépasse {cap} Mo",
            de: "das Bild ist größer als {cap} MB",
            ja: "画像が {cap} MB を超えています",
            zh: "图片超过 {cap} MB",
            cap = PICTURE_CAP / 1024 / 1024,
        ));
    }

    made(root, &folder)?;
    let name = format!("imagen-{}-{at}.{extension}", session::now());
    std::fs::write(folder.join(&name), bytes).map_err(|error| {
        said!(
            en: "couldn’t save the picture: {error}",
            es: "no pude guardar la imagen: {error}",
            fr: "impossible d’enregistrer l’image : {error}",
            de: "das Bild konnte nicht gespeichert werden: {error}",
            ja: "画像を保存できませんでした: {error}",
            zh: "无法保存图片：{error}",
        )
    })?;
    Ok(format!(".sens/artifacts/{session}/{name}"))
}

fn within(root: &Path, full: &Path) -> Option<String> {
    let base = root.canonicalize().ok()?;
    full.strip_prefix(base).ok().map(slashed)
}

fn plain(path: &Path) -> String {
    let text = path.to_string_lossy();
    match text.strip_prefix(VERBATIM_SHARE) {
        Some(share) => format!(r"\\{share}"),
        None => text.strip_prefix(VERBATIM).unwrap_or(&text).to_string(),
    }
}

fn as_folder(path: &str) -> String {
    format!("{}/", path.trim_end_matches(['/', '\\']))
}

pub fn attach(root: &Path, paths: &[String]) -> Attachments {
    let mut found = Attachments::default();
    for given in paths {
        match attached(root, given) {
            Ok(item) => found.items.push(item),
            Err(refused) => found.refused.push(refused),
        }
    }
    found
}

fn last_part(given: &str) -> String {
    let part = given.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or_default();
    if part.is_empty() { given.to_string() } else { part.to_string() }
}

fn attached(root: &Path, given: &str) -> Result<Attached, Refused> {
    let refused = |name: &str, why: Why| Refused { name: name.to_string(), why };
    let full = root
        .join(given)
        .canonicalize()
        .map_err(|_| refused(&last_part(given), Why::Missing))?;
    let name = full
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| last_part(given));
    let meta = full.metadata().map_err(|_| refused(&name, Why::Unreadable))?;
    let inside = within(root, &full);
    let outside = inside.is_none();

    if meta.is_dir() {
        let path = match inside {
            Some(inside) if inside.is_empty() => return Err(refused(&name, Why::Project)),
            Some(inside) => inside,
            None => plain(&full),
        };
        let entries = std::fs::read_dir(&full).map_or(0, |read| read.take(FOLDER_COUNT).count() as u64);
        return Ok(Attached::Folder { path: as_folder(&path), name, entries, outside });
    }
    if !meta.is_file() {
        return Err(refused(&name, Why::Unreadable));
    }

    let path = inside.unwrap_or_else(|| plain(&full));
    if let Some(media_type) = mime_of(&full).filter(|_| meta.len() <= RAW_PICTURE_CAP) {
        let bytes = files::bounded(&full, RAW_PICTURE_CAP).ok().flatten().ok_or_else(|| refused(&name, Why::Unreadable))?;
        return Ok(Attached::Picture {
            path,
            name,
            media_type: media_type.to_string(),
            data: STANDARD.encode(bytes),
            bytes: meta.len(),
            outside,
        });
    }

    if outside && meta.len() > OUTSIDE_CAP {
        return Err(refused(&name, Why::TooBig));
    }
    Ok(Attached::File { path, name, bytes: meta.len(), outside })
}

pub fn stage(folder: &Path, name: &str, data: &str) -> Result<Attached, String> {
    if data.len() as u64 > OUTSIDE_CAP.div_ceil(3) * 4 {
        return Err(too_big(name, OUTSIDE_CAP));
    }
    let bytes = STANDARD.decode(data).map_err(|error| {
        said!(
            en: "{name} arrived corrupted: {error}",
            es: "{name} llegó roto: {error}",
            fr: "{name} est arrivé corrompu : {error}",
            de: "{name} kam beschädigt an: {error}",
            ja: "{name} が壊れた状態で届きました: {error}",
            zh: "{name} 已损坏：{error}",
        )
    })?;
    if bytes.len() as u64 > OUTSIDE_CAP {
        return Err(too_big(name, OUTSIDE_CAP));
    }
    let clean = safe_name(name);
    sweep(folder, SystemTime::now());
    std::fs::create_dir_all(folder).map_err(|error| files::uncreated(folder, error))?;
    let place = fresh_place(folder, session::now())?;
    let target = place.join(&clean);
    std::fs::write(&target, &bytes).map_err(|error| {
        said!(
            en: "couldn’t save {clean}: {error}",
            es: "no pude guardar {clean}: {error}",
            fr: "impossible d’enregistrer {clean} : {error}",
            de: "{clean} konnte nicht gespeichert werden: {error}",
            ja: "{clean} を保存できませんでした: {error}",
            zh: "无法保存 {clean}：{error}",
        )
    })?;
    Ok(Attached::File {
        path: plain(&target),
        name: clean,
        bytes: bytes.len() as u64,
        outside: true,
    })
}

fn fresh_place(folder: &Path, stamp: u64) -> Result<PathBuf, String> {
    let mut copy = 0;
    loop {
        let place = folder.join(format!("{stamp}-{copy}"));
        match std::fs::create_dir(&place) {
            Ok(()) => return Ok(place),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => copy += 1,
            Err(error) => return Err(files::uncreated(&place, error)),
        }
    }
}

fn safe_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|letter| if UNSAFE.contains(&letter) || letter.is_control() { '_' } else { letter })
        .collect();
    let clean = clean.trim_matches(|letter: char| letter == '.' || letter.is_whitespace());
    let clean = shortened(if clean.is_empty() { "file" } else { clean });
    if reserved(&clean) { format!("_{clean}") } else { clean }
}

fn shortened(name: &str) -> String {
    if name.chars().count() <= NAME_CAP {
        return name.to_string();
    }
    let extension = name
        .rsplit_once('.')
        .map(|(_, extension)| extension)
        .filter(|extension| extension.chars().count() < NAME_CAP / 4)
        .map_or_else(String::new, |extension| format!(".{extension}"));
    let stem: String = name.chars().take(NAME_CAP - extension.chars().count()).collect();
    format!("{}{extension}", stem.trim_end_matches(|letter: char| letter == '.' || letter.is_whitespace()))
}

fn reserved(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or_default().trim_end().to_ascii_uppercase();
    let numbered = stem
        .strip_prefix("COM")
        .or_else(|| stem.strip_prefix("LPT"))
        .is_some_and(|rest| rest.chars().count() == 1 && rest.chars().all(|digit| digit.is_ascii_digit() || "¹²³".contains(digit)));
    numbered || RESERVED.contains(&stem.as_str())
}

fn sweep(folder: &Path, now: SystemTime) {
    for entry in std::fs::read_dir(folder).into_iter().flatten().filter_map(Result::ok) {
        let old = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > STAGED_FOR);
        if old {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

pub fn keep_file(root: &Path, work: &Path, session: &str, given: &str) -> Result<String, String> {
    if !Path::new(given).is_absolute() {
        return Ok(given.to_string());
    }
    let full = Path::new(given).canonicalize().map_err(|_| {
        said!(
            en: "{given} no longer exists",
            es: "{given} ya no existe",
            fr: "{given} n’existe plus",
            de: "{given} existiert nicht mehr",
            ja: "{given} はもう存在しません",
            zh: "{given} 已不存在",
        )
    })?;
    let folder = full.is_dir();
    if let Some(inside) = within(work, &full) {
        return Ok(if folder { as_folder(&inside) } else { inside });
    }
    if folder {
        return Ok(as_folder(&plain(&full)));
    }
    let size = full.metadata().map_err(|error| files::unread(given, error))?.len();
    if size > OUTSIDE_CAP {
        return Err(too_big(given, OUTSIDE_CAP));
    }

    let folder = session_shelf(root, session)?;
    made(root, &folder)?;
    let original = full.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    let target = unused(&folder, &original);
    std::fs::copy(&full, &target).map_err(|error| {
        said!(
            en: "couldn’t copy {given}: {error}",
            es: "no pude copiar {given}: {error}",
            fr: "impossible de copier {given} : {error}",
            de: "{given} konnte nicht kopiert werden: {error}",
            ja: "{given} をコピーできませんでした: {error}",
            zh: "无法复制 {given}：{error}",
        )
    })?;
    let name = target.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    let kept = format!(".sens/artifacts/{session}/{name}");
    Ok(match work == root {
        true => kept,
        false => slashed(&root.join(kept)),
    })
}

fn unused(folder: &Path, original: &str) -> PathBuf {
    let wanted = Path::new(original);
    let stem = wanted.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
    let extension = wanted.extension().map(|extension| format!(".{}", extension.to_string_lossy())).unwrap_or_default();
    (0..)
        .map(|copy| match copy {
            0 => folder.join(original),
            _ => folder.join(format!("{stem}-{copy}{extension}")),
        })
        .find(|candidate| !candidate.exists())
        .unwrap_or_else(|| folder.join(original))
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

pub fn mime_of(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_string_lossy().to_lowercase();
    IMAGES
        .iter()
        .find(|(known, _)| *known == extension)
        .map(|(_, mime)| *mime)
}

pub fn vetted(registry: &Registry, path: &str) -> Result<PathBuf, String> {
    let given = Path::new(path);
    if given.components().any(|part| part == Component::ParentDir) {
        return Err(said!(
            en: "{path} tries to leave the artifacts folder",
            es: "{path} intenta salir de la carpeta de artefactos",
            fr: "{path} tente de sortir du dossier des artefacts",
            de: "{path} versucht, den Artefaktordner zu verlassen",
            ja: "{path} はアーティファクトのフォルダーの外を指しています",
            zh: "{path} 试图跳出工件文件夹",
        ));
    }
    let full = given
        .canonicalize()
        .map_err(|_| files::missing(path))?;
    let held = registry.projects.iter().any(|known| {
        shelf(Path::new(&known.root))
            .canonicalize()
            .is_ok_and(|base| full.starts_with(base))
    });
    if !held || !full.is_file() {
        return Err(said!(
            en: "{path} isn’t an artifact of any project",
            es: "{path} no es un artefacto de ningún proyecto",
            fr: "{path} n’est un artefact d’aucun projet",
            de: "{path} ist kein Artefakt eines Projekts",
            ja: "{path} はどのプロジェクトのアーティファクトでもありません",
            zh: "{path} 不是任何项目的工件",
        ));
    }
    Ok(full)
}

pub fn data(registry: &Registry, path: &str) -> Result<String, String> {
    let full = vetted(registry, path)?;
    let mime = mime_of(&full).ok_or_else(|| {
        said!(
            en: "{path} isn’t a picture",
            es: "{path} no es una imagen",
            fr: "{path} n’est pas une image",
            de: "{path} ist kein Bild",
            ja: "{path} は画像ではありません",
            zh: "{path} 不是图片",
        )
    })?;
    let bytes = capped(&full, path, IMAGE_CAP)?;
    Ok(data_url(mime, &bytes))
}

pub fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}

pub fn text(registry: &Registry, path: &str) -> Result<String, String> {
    let bytes = capped(&vetted(registry, path)?, path, TEXT_CAP)?;
    String::from_utf8(bytes).map_err(|_| {
        said!(
            en: "{path} isn’t UTF-8 text",
            es: "{path} no es texto UTF-8",
            fr: "{path} n’est pas du texte UTF-8",
            de: "{path} ist kein UTF-8-Text",
            ja: "{path} は UTF-8 のテキストではありません",
            zh: "{path} 不是 UTF-8 文本",
        )
    })
}

fn capped(full: &Path, path: &str, cap: u64) -> Result<Vec<u8>, String> {
    files::bounded(full, cap)
        .map_err(|error| files::unread(path, error))?
        .ok_or_else(|| too_big(path, cap))
}

pub fn destination(registry: &Registry, target: &str) -> Result<Outside, String> {
    if is_web(target) {
        return Ok(Outside::Web(target.to_string()));
    }
    if target.contains("://") {
        return Err(said!(
            en: "only http and https links can be opened, not {target}",
            es: "solo abro enlaces http y https, no {target}",
            fr: "seuls les liens http et https peuvent être ouverts, pas {target}",
            de: "nur http- und https-Links lassen sich öffnen, nicht {target}",
            ja: "開けるのは http と https のリンクだけです（{target} は開けません）",
            zh: "只能打开 http 和 https 链接，无法打开 {target}",
        ));
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
    use sens_agent::language::{Language, speaking};

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
                .map(|root| Known { root: root.to_string_lossy().into_owned(), opened: 1, trusted: false })
                .collect(),
        }
    }

    fn task(at: u64, text: &str) -> Entry {
        Entry::Task { at, text: text.into(), files: Vec::new(), images: Vec::new() }
    }

    fn agent(at: u64, event: Event) -> Entry {
        Entry::Agent { at, event }
    }

    fn said(at: u64, text: &str) -> Entry {
        agent(at, Event::Said { text: text.into() })
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
    fn links_come_only_from_what_was_asked_and_from_what_the_agent_said() {
        let entries = vec![
            task(10, "Usa https://a.com/doc"),
            said(20, "Sigo https://b.com/guia."),
            agent(25, Event::Thought { text: "quizá https://pensado.com".into() }),
            agent(30, Event::Failed { reason: "https://fallo.com".into() }),
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
        let entries = vec![task(1, "https://a.com/x"), said(2, "otra vez https://a.com/x")];

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

        assert!(refused.contains("tries to leave the artifacts folder"), "{refused}");
        assert!(speaking(Language::Es, || vetted(&registry, &climbing.to_string_lossy())).unwrap_err().contains("intenta salir"));
        assert!(speaking(Language::De, || vetted(&registry, &climbing.to_string_lossy())).unwrap_err().contains("Artefaktordner"));
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
    fn a_pasted_picture_is_kept_as_an_artifact_of_its_session() {
        let root = temp_root("pasted");
        let kept = keep_picture(&root, "s1", 0, "image/png", &STANDARD.encode(b"png")).unwrap();

        assert!(kept.starts_with(".sens/artifacts/s1/imagen-"));
        assert!(kept.ends_with("-0.png"));
        assert_eq!(std::fs::read(root.join(&kept)).unwrap(), b"png");
        assert_eq!(std::fs::read_to_string(root.join(".sens").join(".gitignore")).unwrap(), "*\n");
        let found = files_of(&root);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, Kind::Image);
        assert_eq!(found[0].session.as_deref(), Some("s1"));
    }

    #[test]
    fn a_picture_that_cannot_be_trusted_is_refused_before_touching_the_disk() {
        let root = temp_root("refused");
        let fine = STANDARD.encode(b"png");

        assert!(keep_picture(&root, "s1", 0, "image/svg+xml", &fine).unwrap_err().contains("PNG"));
        assert!(keep_picture(&root, "../fuera", 0, "image/png", &fine).is_err());
        assert!(keep_picture(&root, "s1", 0, "image/png", "esto no es base64").unwrap_err().contains("corrupted"));
        let huge = STANDARD.encode(vec![0u8; PICTURE_CAP + 1]);
        assert!(keep_picture(&root, "s1", 0, "image/png", &huge).unwrap_err().contains("5 MB"));
        assert!(!shelf(&root).exists());
    }

    fn full(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn a_picture_from_anywhere_is_attached_as_a_picture() {
        let root = temp_root("attach-project");
        let elsewhere = temp_root("attach-elsewhere");
        put(&elsewhere.join("captura.PNG"), b"png");

        let found = attach(&root, &[full(&elsewhere.join("captura.PNG"))]);

        assert!(found.refused.is_empty());
        let Attached::Picture { path, name, media_type, data, bytes, outside } = &found.items[0] else { panic!("{found:?}") };
        assert_eq!((name.as_str(), media_type.as_str(), *bytes, *outside), ("captura.PNG", "image/png", 3, true));
        assert_eq!(data, &STANDARD.encode(b"png"));
        assert!(Path::new(path).is_absolute() && !path.starts_with(VERBATIM), "{path}");
    }

    #[test]
    fn any_picture_the_window_can_draw_comes_back_as_a_picture_to_be_converted() {
        let root = temp_root("attach-formats");
        put(&root.join("icono.ico"), b"ico");
        put(&root.join("dibujo.svg"), b"<svg/>");
        put(&root.join("foto.avif"), b"avif");
        put(&root.join("mapa.bmp"), b"bmp");

        let found = attach(&root, &["icono.ico".into(), "dibujo.svg".into(), "foto.avif".into(), "mapa.bmp".into()]);

        let kinds: Vec<(&str, &str)> = found
            .items
            .iter()
            .filter_map(|item| match item {
                Attached::Picture { path, media_type, .. } => Some((path.as_str(), media_type.as_str())),
                _ => None,
            })
            .collect();
        assert_eq!(kinds, vec![("icono.ico", "image/x-icon"), ("dibujo.svg", "image/svg+xml"), ("foto.avif", "image/avif"), ("mapa.bmp", "image/bmp")]);
    }

    #[test]
    fn a_folder_is_attached_for_claude_to_explore_with_what_it_holds() {
        let root = temp_root("attach-folder");
        let elsewhere = temp_root("attach-folder-elsewhere");
        put(&root.join("src").join("a.rs"), b"x");
        put(&root.join("src").join("b.rs"), b"y");
        put(&elsewhere.join("docs").join("c.md"), b"z");

        let found = attach(&root, &["src".into(), full(&elsewhere.join("docs"))]);

        assert_eq!(found.items[0], Attached::Folder { path: "src/".into(), name: "src".into(), entries: 2, outside: false });
        let Attached::Folder { path, entries, outside, .. } = &found.items[1] else { panic!("{found:?}") };
        assert!(path.ends_with("docs/") && Path::new(path).is_absolute(), "{path}");
        assert_eq!((*entries, *outside), (1, true));
    }

    #[test]
    fn a_file_inside_the_project_travels_by_its_relative_path() {
        let root = temp_root("attach-inside");
        put(&root.join("src").join("a.rs"), b"fn a() {}");

        let found = attach(&root, &[full(&root.join("src").join("a.rs")), "src/a.rs".into()]);

        let expected = Attached::File { path: "src/a.rs".into(), name: "a.rs".into(), bytes: 9, outside: false };
        assert_eq!(found.items, vec![expected.clone(), expected]);
    }

    #[test]
    fn a_file_outside_the_project_is_attached_by_its_full_path() {
        let root = temp_root("attach-outside-project");
        let elsewhere = temp_root("attach-outside");
        put(&elsewhere.join("informe.pdf"), b"%PDF");

        let found = attach(&root, &[full(&elsewhere.join("informe.pdf"))]);

        let Attached::File { path, outside, name, .. } = &found.items[0] else { panic!("{found:?}") };
        assert!(*outside);
        assert_eq!(name, "informe.pdf");
        assert!(Path::new(path).is_absolute());
    }

    #[test]
    fn a_picture_too_big_even_to_convert_is_attached_as_a_file_instead() {
        let root = temp_root("attach-big-picture");
        put(&root.join("enorme.png"), &vec![0u8; RAW_PICTURE_CAP as usize + 1]);

        let found = attach(&root, &["enorme.png".into()]);

        assert!(matches!(&found.items[0], Attached::File { path, .. } if path == "enorme.png"));
    }

    #[test]
    fn what_cannot_be_attached_says_why_without_stopping_the_rest() {
        let root = temp_root("attach-refused");
        let elsewhere = temp_root("attach-refused-elsewhere");
        put(&root.join("bien.txt"), b"x");
        put(&elsewhere.join("enorme.zip"), &vec![0u8; OUTSIDE_CAP as usize + 1]);

        let found = attach(&root, &["nada.txt".into(), full(&root), "bien.txt".into(), full(&elsewhere.join("enorme.zip"))]);

        assert_eq!(found.items.len(), 1);
        let reasons: Vec<(&str, Why)> = found.refused.iter().map(|refused| (refused.name.as_str(), refused.why)).collect();
        let project = root.file_name().unwrap().to_string_lossy().into_owned();
        assert_eq!(reasons, vec![("nada.txt", Why::Missing), (project.as_str(), Why::Project), ("enorme.zip", Why::TooBig)]);
    }

    #[test]
    fn a_pasted_file_waits_in_the_staging_folder_under_its_own_name() {
        let staging = temp_root("stage");

        let first = stage(&staging, "informe.pdf", &STANDARD.encode(b"%PDF")).unwrap();
        let second = stage(&staging, "informe.pdf", &STANDARD.encode(b"%PDF-2")).unwrap();

        let (Attached::File { path: one, name, bytes, outside }, Attached::File { path: other, .. }) = (&first, &second) else { panic!("{first:?}") };
        assert_eq!((name.as_str(), *bytes, *outside), ("informe.pdf", 4, true));
        assert_ne!(one, other);
        assert_eq!(std::fs::read(one).unwrap(), b"%PDF");
        assert_eq!(std::fs::read(other).unwrap(), b"%PDF-2");
        assert!(Path::new(one).starts_with(&staging));
    }

    #[test]
    fn a_staged_name_cannot_climb_out_and_what_is_broken_or_huge_is_refused() {
        let staging = temp_root("stage-refused");

        let Attached::File { path, name, .. } = stage(&staging, "../../fuera:mal?.txt", &STANDARD.encode(b"x")).unwrap() else { panic!() };
        assert_eq!(name, "_.._fuera_mal_.txt");
        assert!(Path::new(&path).starts_with(&staging));
        assert!(matches!(stage(&staging, "..", &STANDARD.encode(b"x")).unwrap(), Attached::File { name, .. } if name == "file"));
        assert!(stage(&staging, "roto.bin", "esto no es base64").unwrap_err().contains("corrupted"));
        let huge = STANDARD.encode(vec![0u8; OUTSIDE_CAP as usize + 1]);
        assert_eq!(stage(&staging, "enorme.bin", &huge).unwrap_err(), "enorme.bin is over 20 MB");
        assert_eq!(speaking(Language::Es, || stage(&staging, "enorme.bin", &huge)).unwrap_err(), "enorme.bin pasa de 20 MB");
        assert_eq!(speaking(Language::Fr, || stage(&staging, "enorme.bin", &huge)).unwrap_err(), "enorme.bin dépasse 20 Mo");
    }

    #[test]
    fn a_staged_name_windows_keeps_for_a_device_or_too_long_to_hold_is_made_safe() {
        assert_eq!(safe_name("CON"), "_CON");
        assert_eq!(safe_name("nul.txt"), "_nul.txt");
        assert_eq!(safe_name("Com1.tar.gz"), "_Com1.tar.gz");
        assert_eq!(safe_name("lpt¹"), "_lpt¹");
        assert_eq!(safe_name("console.log"), "console.log");
        assert_eq!(safe_name("COM10.txt"), "COM10.txt");
        assert_eq!(safe_name(" . notas . "), "notas");
        assert_eq!(safe_name(" . . "), "file");

        let long = safe_name(&format!("{}.pdf", "a".repeat(400)));
        assert_eq!(long.chars().count(), NAME_CAP);
        assert!(long.ends_with("a.pdf"), "{long}");
        let staging = temp_root("stage-long");
        let Attached::File { path, .. } = stage(&staging, &"é".repeat(300), &STANDARD.encode(b"x")).unwrap() else { panic!() };
        assert_eq!(std::fs::read(&path).unwrap(), b"x");
    }

    #[test]
    fn files_staged_at_the_same_moment_never_share_a_place() {
        let staging = temp_root("stage-together");

        let staged: Vec<String> = (0..8)
            .map(|each| {
                let staging = staging.clone();
                std::thread::spawn(move || stage(&staging, "captura.png", &STANDARD.encode([each])).unwrap())
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|thread| match thread.join().unwrap() {
                Attached::File { path, .. } => path,
                other => panic!("{other:?}"),
            })
            .collect();

        let places: HashSet<&String> = staged.iter().collect();
        assert_eq!(places.len(), 8);
        let mut kept: Vec<u8> = staged.iter().map(|path| std::fs::read(path).unwrap()[0]).collect();
        kept.sort_unstable();
        assert_eq!(kept, (0..8).collect::<Vec<u8>>());
    }

    #[test]
    fn a_payload_too_long_to_fit_is_refused_before_it_is_decoded() {
        let staging = temp_root("stage-precheck");
        let oversized = "*".repeat(OUTSIDE_CAP.div_ceil(3) as usize * 4 + 4);

        assert_eq!(stage(&staging, "enorme.bin", &oversized).unwrap_err(), "enorme.bin is over 20 MB");
        assert_eq!(std::fs::read_dir(&staging).unwrap().count(), 0);
    }

    #[test]
    fn a_path_outside_is_handed_over_without_the_verbatim_prefix() {
        assert_eq!(plain(Path::new(r"\\?\C:\Users\ana\notas.md")), r"C:\Users\ana\notas.md");
        assert_eq!(plain(Path::new(r"\\?\UNC\servidor\compartido\informe.pdf")), r"\\servidor\compartido\informe.pdf");
        assert_eq!(plain(Path::new("/home/ana/notas.md")), "/home/ana/notas.md");
    }

    #[test]
    fn staged_files_left_for_a_day_are_swept_away() {
        let staging = temp_root("stage-sweep");
        put(&staging.join("1-0").join("viejo.txt"), b"x");

        sweep(&staging, SystemTime::now());
        assert!(staging.join("1-0").exists());

        sweep(&staging, SystemTime::now() + STAGED_FOR + Duration::from_secs(60));
        assert!(!staging.join("1-0").exists());
    }

    #[test]
    fn sending_copies_outside_files_into_the_session_and_leaves_project_files_alone() {
        let root = temp_root("keep-project");
        let elsewhere = temp_root("keep-elsewhere");
        put(&elsewhere.join("notas.md"), b"hola");
        put(&root.join("src").join("a.rs"), b"x");

        let first = keep_file(&root, &root, "s1", &full(&elsewhere.join("notas.md"))).unwrap();
        let second = keep_file(&root, &root, "s1", &full(&elsewhere.join("notas.md"))).unwrap();

        assert_eq!(first, ".sens/artifacts/s1/notas.md");
        assert_eq!(second, ".sens/artifacts/s1/notas-1.md");
        assert_eq!(std::fs::read(root.join(&second)).unwrap(), b"hola");
        assert_eq!(keep_file(&root, &root, "s1", "src/a.rs").unwrap(), "src/a.rs");
        assert_eq!(keep_file(&root, &root, "s1", &full(&root.join("src").join("a.rs"))).unwrap(), "src/a.rs");
        assert!(keep_file(&root, &root, "../fuera", &full(&elsewhere.join("notas.md"))).is_err());
    }

    #[test]
    fn a_folder_is_handed_over_by_its_path_and_never_copied() {
        let root = temp_root("keep-folder");
        let elsewhere = temp_root("keep-folder-elsewhere");
        put(&root.join("src").join("a.rs"), b"x");
        put(&elsewhere.join("docs").join("b.md"), b"y");

        assert_eq!(keep_file(&root, &root, "s1", "src/").unwrap(), "src/");
        assert_eq!(keep_file(&root, &root, "s1", &format!("{}/", full(&root.join("src")))).unwrap(), "src/");
        let outside = keep_file(&root, &root, "s1", &full(&elsewhere.join("docs"))).unwrap();
        assert!(outside.ends_with("docs/") && Path::new(&outside).is_absolute(), "{outside}");
        assert!(!shelf(&root).exists());
    }

    #[test]
    fn a_session_working_in_a_worktree_is_handed_paths_it_can_reach_from_there() {
        let root = temp_root("keep-isolated");
        let work = root.join(".sens").join("worktrees").join("ab12cd34");
        let elsewhere = temp_root("keep-isolated-elsewhere");
        put(&elsewhere.join("notas.md"), b"hola");
        put(&work.join("src").join("a.rs"), b"x");
        put(&root.join("src").join("b.rs"), b"y");

        let copied = keep_file(&root, &work, "s1", &full(&elsewhere.join("notas.md"))).unwrap();

        assert!(Path::new(&copied).is_absolute(), "{copied}");
        assert_eq!(std::fs::read(&copied).unwrap(), b"hola");
        assert_eq!(keep_file(&root, &work, "s1", &full(&work.join("src").join("a.rs"))).unwrap(), "src/a.rs");
        assert!(Path::new(&keep_file(&root, &work, "s1", &full(&root.join("src").join("b.rs"))).unwrap()).is_absolute());
    }

    #[test]
    fn everything_comes_back_newest_first_with_its_project_and_session_title() {
        let root = temp_root("all");
        session::append(&root, "s1", &task(100, "Añade validación https://a.com/x")).unwrap();
        session::append(&root, "s2", &said(200, "https://solo-dicho.com")).unwrap();
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
