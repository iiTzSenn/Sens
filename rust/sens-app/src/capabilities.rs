use std::collections::{BTreeMap, BTreeSet};
use std::fs::DirEntry;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::store;

const SKILLS: &str = "skills";
const SKILL_FILE: &str = "SKILL.md";
const SERVERS_FILE: &str = "mcp.json";
const STATE_FILE: &str = "capabilities.json";
const STAGING: &str = ".importando-";
const NO_PROJECT: &str = "abre un proyecto para activar capacidades";
const FENCE: &str = "---";
const NAME_CAP: usize = 64;
const DESCRIPTION_CAP: usize = 1024;
const FILE_CAP: usize = 200;
const MEGABYTE: u64 = 1024 * 1024;
const BYTE_CAP: u64 = 10 * MEGABYTE;
const INDICATORS: [char; 15] = ['-', '?', ',', '[', ']', '{', '}', '&', '*', '!', '|', '>', '%', '@', '`'];
const RISKY: [char; 5] = [':', '#', '\'', '"', '\\'];

#[derive(Serialize, Debug, PartialEq)]
pub struct Capabilities {
    pub skills: Vec<Skill>,
    pub servers: Vec<Server>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub enabled: bool,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env_keys: Vec<String>,
    pub enabled: bool,
}

#[derive(Deserialize)]
pub struct NewServer {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, PartialEq)]
pub struct Header {
    pub name: String,
    pub description: String,
}

#[derive(Serialize, Deserialize, Default)]
struct Servers {
    #[serde(default)]
    servers: BTreeMap<String, Entry>,
}

#[derive(Serialize, Deserialize)]
struct Entry {
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    command: String,
    #[serde(default)]
    env: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Default)]
struct State {
    #[serde(default)]
    projects: BTreeMap<String, Project>,
}

#[derive(Serialize, Deserialize, Default)]
struct Project {
    #[serde(default)]
    skills: BTreeSet<String>,
    #[serde(default)]
    servers: BTreeSet<String>,
}

#[derive(Clone, Copy)]
enum Kind {
    Skill,
    Server,
}

#[derive(Default)]
struct Survey {
    folders: Vec<PathBuf>,
    files: Vec<PathBuf>,
    bytes: u64,
}

impl Project {
    fn names(&mut self, kind: Kind) -> &mut BTreeSet<String> {
        match kind {
            Kind::Skill => &mut self.skills,
            Kind::Server => &mut self.servers,
        }
    }

    fn is_empty(&self) -> bool {
        self.skills.is_empty() && self.servers.is_empty()
    }
}

impl Kind {
    fn present(self, base: &Path, name: &str) -> Result<(), String> {
        let found = match self {
            Kind::Skill => described(&skill_folder(base, name)?).is_some(),
            Kind::Server => editable_servers(base)?.servers.contains_key(name),
        };
        if found { Ok(()) } else { Err(self.missing(name)) }
    }

    fn missing(self, name: &str) -> String {
        match self {
            Kind::Skill => missing_skill(name),
            Kind::Server => missing_server(name),
        }
    }
}

pub fn is_skill_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    (1..=NAME_CAP).contains(&bytes.len())
        && bytes[0] != b'-'
        && bytes.iter().all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'-'))
}

pub fn is_server_name(name: &str) -> bool {
    (1..=NAME_CAP).contains(&name.len())
        && name.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

pub fn header(text: &str) -> Option<Header> {
    let mut lines = text.trim_start_matches('\u{feff}').lines();
    if lines.next()?.trim_end() != FENCE {
        return None;
    }
    let mut name = None;
    let mut description = None;
    for line in lines {
        if line.trim_end() == FENCE {
            return Some(Header {
                name: present(name)?,
                description: present(description)?,
            });
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        match key.trim() {
            "name" => name = Some(unquoted(value.trim())),
            "description" => description = Some(unquoted(value.trim())),
            _ => {}
        }
    }
    None
}

fn present(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.is_empty())
}

fn unquoted(value: &str) -> String {
    if let Some(inner) = enclosed(value, '"') {
        return unescaped(inner);
    }
    if let Some(inner) = enclosed(value, '\'') {
        return inner.replace("''", "'");
    }
    value.to_string()
}

fn enclosed(value: &str, quote: char) -> Option<&str> {
    value.strip_prefix(quote)?.strip_suffix(quote)
}

fn unescaped(inner: &str) -> String {
    let mut out = String::with_capacity(inner.len());
    let mut letters = inner.chars();
    while let Some(letter) = letters.next() {
        match (letter, letters.clone().next()) {
            ('\\', Some(next @ ('"' | '\\'))) => {
                out.push(next);
                letters.next();
            }
            _ => out.push(letter),
        }
    }
    out
}

fn field(value: &str) -> String {
    if is_plain(value) {
        return value.to_string();
    }
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn is_plain(value: &str) -> bool {
    value.trim() == value && !value.starts_with(INDICATORS) && !value.contains(RISKY)
}

fn skill_md(name: &str, description: &str, body: &str) -> String {
    format!(
        "{FENCE}\nname: {name}\ndescription: {}\n{FENCE}\n\n{}\n",
        field(description),
        body.trim_end()
    )
}

pub fn all(base: &Path, root: &str) -> Capabilities {
    let active = active(base, root);
    Capabilities {
        skills: skills(base, &active.skills),
        servers: servers(base, &active.servers),
    }
}

fn shelf(base: &Path) -> PathBuf {
    base.join(SKILLS)
}

fn state(base: &Path) -> State {
    store::stored(&base.join(STATE_FILE))
}

fn editable_state(base: &Path) -> Result<State, String> {
    store::editable(&base.join(STATE_FILE))
}

fn active(base: &Path, root: &str) -> Project {
    state(base)
        .projects
        .remove(root)
        .filter(|_| !root.is_empty())
        .unwrap_or_default()
}

fn update(base: &Path, change: impl FnOnce(&mut State)) -> Result<(), String> {
    let mut kept = editable_state(base)?;
    change(&mut kept);
    kept.projects.retain(|_, project| !project.is_empty());
    store::store(base, STATE_FILE, &kept)
}

fn switch(base: &Path, root: &str, kind: Kind, name: &str, enabled: bool) -> Result<(), String> {
    if root.is_empty() {
        return Err(NO_PROJECT.into());
    }
    kind.present(base, name)?;
    update(base, |kept| {
        let names = kept.projects.entry(root.to_string()).or_default().names(kind);
        if enabled {
            names.insert(name.to_string());
        } else {
            names.remove(name);
        }
    })
}

fn activatable(base: &Path, root: &str) -> Result<(), String> {
    if !root.is_empty() {
        editable_state(base)?;
    }
    Ok(())
}

fn adopt(base: &Path, root: &str, kind: Kind, name: &str) -> Result<(), String> {
    if root.is_empty() {
        return Ok(());
    }
    switch(base, root, kind, name, true)
}

fn forget(base: &Path, kind: Kind, name: &str) -> Result<(), String> {
    update(base, |kept| {
        for project in kept.projects.values_mut() {
            project.names(kind).remove(name);
        }
    })
}

fn known_servers(base: &Path) -> Servers {
    store::stored(&base.join(SERVERS_FILE))
}

fn editable_servers(base: &Path) -> Result<Servers, String> {
    store::editable(&base.join(SERVERS_FILE))
}

fn skills(base: &Path, active: &BTreeSet<String>) -> Vec<Skill> {
    let mut found: Vec<Skill> = std::fs::read_dir(shelf(base))
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter_map(|entry| described(&entry.path()))
        .map(|header| Skill {
            enabled: active.contains(&header.name),
            name: header.name,
            description: header.description,
        })
        .collect();
    found.sort_by(|a, b| a.name.cmp(&b.name));
    found
}

fn described(folder: &Path) -> Option<Header> {
    let found = header(&std::fs::read_to_string(folder.join(SKILL_FILE)).ok()?)?;
    let named = folder.file_name()?.to_str()? == found.name;
    (named && is_skill_name(&found.name)).then_some(found)
}

fn servers(base: &Path, active: &BTreeSet<String>) -> Vec<Server> {
    known_servers(base)
        .servers
        .into_iter()
        .map(|(name, entry)| Server {
            enabled: active.contains(&name),
            name,
            command: entry.command,
            args: entry.args,
            env_keys: entry.env.into_keys().collect(),
        })
        .collect()
}

fn skill_folder(base: &Path, name: &str) -> Result<PathBuf, String> {
    if !is_skill_name(name) {
        return Err(format!(
            "nombre de skill no válido: «{name}». Usa minúsculas, números y guiones, hasta {NAME_CAP}, sin empezar por guion"
        ));
    }
    Ok(shelf(base).join(name))
}

fn missing_skill(name: &str) -> String {
    format!("no existe la skill {name}")
}

fn missing_server(name: &str) -> String {
    format!("no existe el servidor {name}")
}

fn unclaimed(base: &Path, name: &str) -> Result<PathBuf, String> {
    let folder = skill_folder(base, name)?;
    if folder.symlink_metadata().is_ok() {
        return Err(format!("ya existe una skill llamada {name}"));
    }
    Ok(folder)
}

fn vetted_description(description: &str) -> Result<&str, String> {
    let description = description.trim();
    if description.is_empty() {
        return Err("la descripción es obligatoria".into());
    }
    if description.contains(['\n', '\r']) {
        return Err("la descripción tiene que ir en una sola línea".into());
    }
    if description.chars().count() > DESCRIPTION_CAP {
        return Err(format!("la descripción pasa de {DESCRIPTION_CAP} caracteres"));
    }
    Ok(description)
}

fn unreadable(path: &Path) -> impl Fn(std::io::Error) -> String {
    move |error| format!("no pude leer {}: {error}", path.display())
}

fn unwritable(path: &Path) -> impl Fn(std::io::Error) -> String {
    move |error| format!("no pude escribir {}: {error}", path.display())
}

pub fn skill_text(base: &Path, name: &str) -> Result<String, String> {
    let folder = skill_folder(base, name)?;
    std::fs::read_to_string(folder.join(SKILL_FILE)).map_err(|_| missing_skill(name))
}

pub fn create_skill(base: &Path, root: &str, name: &str, description: &str, body: &str) -> Result<(), String> {
    let name = name.trim();
    let description = vetted_description(description)?;
    activatable(base, root)?;
    let folder = unclaimed(base, name)?;
    std::fs::create_dir_all(&folder).map_err(unwritable(&folder))?;
    std::fs::write(folder.join(SKILL_FILE), skill_md(name, description, body)).map_err(|error| {
        let _ = std::fs::remove_dir_all(&folder);
        format!("no pude guardar la skill {name}: {error}")
    })?;
    adopt(base, root, Kind::Skill, name)
}

pub fn import_skill(base: &Path, root: &str, source: &Path) -> Result<String, String> {
    let found = survey(source)?;
    let parsed = header_of(source, &found)?;
    vetted_description(&parsed.description)?;
    activatable(base, root)?;
    let target = unclaimed(base, &parsed.name)?;
    let staging = shelf(base).join(format!("{STAGING}{}", parsed.name));
    let _ = std::fs::remove_dir_all(&staging);
    let placed = copy_all(source, &staging, &found).and_then(|()| {
        std::fs::rename(&staging, &target)
            .map_err(|error| format!("no pude guardar la skill {}: {error}", parsed.name))
    });
    if placed.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    placed?;
    adopt(base, root, Kind::Skill, &parsed.name)?;
    Ok(parsed.name)
}

fn header_of(source: &Path, found: &Survey) -> Result<Header, String> {
    let shown = source.display();
    if !found.files.iter().any(|file| file == Path::new(SKILL_FILE)) {
        return Err(format!("{shown} no tiene {SKILL_FILE}"));
    }
    let path = source.join(SKILL_FILE);
    let text = std::fs::read_to_string(&path).map_err(unreadable(&path))?;
    header(&text).ok_or_else(|| format!("el {SKILL_FILE} de {shown} no tiene name y description en la cabecera"))
}

fn survey(source: &Path) -> Result<Survey, String> {
    if !source.symlink_metadata().is_ok_and(|meta| meta.is_dir()) {
        return Err(format!("{} no es una carpeta", source.display()));
    }
    let mut found = Survey::default();
    let mut pending = vec![PathBuf::new()];
    while let Some(relative) = pending.pop() {
        for entry in entries(&source.join(&relative))? {
            pending.extend(found.note(&relative, &entry)?);
            found.within(source)?;
        }
    }
    Ok(found)
}

fn entries(folder: &Path) -> Result<Vec<DirEntry>, String> {
    std::fs::read_dir(folder)
        .and_then(|listing| listing.collect())
        .map_err(unreadable(folder))
}

impl Survey {
    fn note(&mut self, relative: &Path, entry: &DirEntry) -> Result<Option<PathBuf>, String> {
        let path = entry.path();
        let kind = entry.file_type().map_err(unreadable(&path))?;
        let inner = relative.join(entry.file_name());
        if kind.is_dir() {
            self.folders.push(inner.clone());
            return Ok(Some(inner));
        }
        if kind.is_file() {
            self.bytes += entry.metadata().map_err(unreadable(&path))?.len();
            self.files.push(inner);
        }
        Ok(None)
    }

    fn within(&self, source: &Path) -> Result<(), String> {
        if self.files.len() > FILE_CAP {
            return Err(format!("{} tiene más de {FILE_CAP} ficheros", source.display()));
        }
        if self.bytes > BYTE_CAP {
            return Err(format!("{} pasa de {} MB", source.display(), BYTE_CAP / MEGABYTE));
        }
        Ok(())
    }
}

fn copy_all(source: &Path, staging: &Path, found: &Survey) -> Result<(), String> {
    std::fs::create_dir_all(staging).map_err(unwritable(staging))?;
    for folder in &found.folders {
        let to = staging.join(folder);
        std::fs::create_dir_all(&to).map_err(unwritable(&to))?;
    }
    for file in &found.files {
        let to = staging.join(file);
        std::fs::copy(source.join(file), &to).map_err(unwritable(&to))?;
    }
    Ok(())
}

pub fn remove_skill(base: &Path, name: &str) -> Result<(), String> {
    editable_state(base)?;
    let folder = skill_folder(base, name)?;
    if !folder.symlink_metadata().is_ok_and(|meta| meta.is_dir()) {
        return Err(missing_skill(name));
    }
    let held = folder.canonicalize().map_err(|_| missing_skill(name))?;
    let inside = shelf(base)
        .canonicalize()
        .is_ok_and(|skills| held.parent() == Some(skills.as_path()));
    if !inside {
        return Err(format!("{name} no está dentro de la carpeta de skills"));
    }
    std::fs::remove_dir_all(&held).map_err(|error| format!("no pude quitar la skill {name}: {error}"))?;
    forget(base, Kind::Skill, name)
}

pub fn set_skill(base: &Path, root: &str, name: &str, enabled: bool) -> Result<(), String> {
    switch(base, root, Kind::Skill, name, enabled)
}

fn vetted_server(server: &NewServer) -> Result<(&str, Entry), String> {
    let name = server.name.trim();
    if !is_server_name(name) {
        return Err(format!(
            "nombre de servidor no válido: «{name}». Usa letras, números, guiones o guiones bajos, hasta {NAME_CAP}"
        ));
    }
    let command = server.command.trim();
    if command.is_empty() {
        return Err("el comando es obligatorio".into());
    }
    if server.env.keys().any(|key| key.trim().is_empty()) {
        return Err("hay una variable de entorno sin nombre".into());
    }
    let entry = Entry {
        args: server.args.clone(),
        command: command.to_string(),
        env: server.env.clone(),
    };
    Ok((name, entry))
}

pub fn add_server(base: &Path, root: &str, server: &NewServer) -> Result<(), String> {
    let (name, entry) = vetted_server(server)?;
    let mut known = editable_servers(base)?;
    activatable(base, root)?;
    if known.servers.contains_key(name) {
        return Err(format!("ya existe un servidor llamado {name}"));
    }
    known.servers.insert(name.to_string(), entry);
    store::store(base, SERVERS_FILE, &known)?;
    adopt(base, root, Kind::Server, name)
}

pub fn remove_server(base: &Path, name: &str) -> Result<(), String> {
    let mut known = editable_servers(base)?;
    editable_state(base)?;
    known.servers.remove(name).ok_or_else(|| missing_server(name))?;
    store::store(base, SERVERS_FILE, &known)?;
    forget(base, Kind::Server, name)
}

pub fn set_server(base: &Path, root: &str, name: &str, enabled: bool) -> Result<(), String> {
    switch(base, root, Kind::Server, name, enabled)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HERE: &str = "P:\\SGT-Portal";
    const THERE: &str = "P:\\Otro";

    fn skill_flags(base: &Path, root: &str) -> Vec<bool> {
        all(base, root).skills.iter().map(|skill| skill.enabled).collect()
    }

    fn server_flags(base: &Path, root: &str) -> Vec<bool> {
        all(base, root).servers.iter().map(|found| found.enabled).collect()
    }

    fn state_text(base: &Path) -> String {
        std::fs::read_to_string(base.join(STATE_FILE)).unwrap()
    }

    fn temp_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("sens-capabilities-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn put(path: &Path, body: &[u8]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    fn names(base: &Path) -> Vec<String> {
        all(base, "").skills.into_iter().map(|skill| skill.name).collect()
    }

    fn leftovers(base: &Path) -> Vec<String> {
        std::fs::read_dir(shelf(base))
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect()
    }

    fn source_skill(root: &Path, name: &str) -> PathBuf {
        let source = root.join("origen");
        put(&source.join(SKILL_FILE), skill_md(name, "Importada.", "Hazlo bien.").as_bytes());
        source
    }

    fn server(name: &str, env: &[(&str, &str)]) -> NewServer {
        NewServer {
            name: name.into(),
            command: "npx".into(),
            args: vec!["-y".into(), format!("@x/{name}")],
            env: env.iter().map(|(key, value)| (key.to_string(), value.to_string())).collect(),
        }
    }

    fn linked(target: &Path, link: &Path) -> bool {
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_dir(target, link);
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(target, link);
        made.is_ok()
    }

    fn head(name: &str, description: &str) -> Option<Header> {
        Some(Header { name: name.into(), description: description.into() })
    }

    #[test]
    fn a_header_reads_plain_values_between_the_two_fences() {
        let text = "---\nname: revisar-prs\ndescription: Revisa un PR contra la guía.\n---\n\nCuerpo";
        assert_eq!(header(text), head("revisar-prs", "Revisa un PR contra la guía."));
    }

    #[test]
    fn a_header_unwraps_single_and_double_quotes() {
        let double = "---\nname: \"a\"\ndescription: \"Dice \\\"hola\\\": C:\\\\x\"\n---\n";
        let single = "---\nname: 'b'\ndescription: 'It''s: fine'\n---\n";
        assert_eq!(header(double), head("a", "Dice \"hola\": C:\\x"));
        assert_eq!(header(single), head("b", "It's: fine"));
    }

    #[test]
    fn a_header_ignores_spaces_around_keys_and_values_and_windows_line_ends() {
        let text = "\u{feff}---  \r\n  name  :   x-1  \r\ndescription:   Algo: más  \r\nversion: 2\r\n---\r\n";
        assert_eq!(header(text), head("x-1", "Algo: más"));
    }

    #[test]
    fn a_header_without_name_or_description_is_not_valid() {
        assert_eq!(header("---\nname: a\n---\n"), None);
        assert_eq!(header("---\ndescription: b\n---\n"), None);
        assert_eq!(header("---\nname: a\ndescription: \"\"\n---\n"), None);
    }

    #[test]
    fn text_without_a_closed_header_is_not_valid() {
        assert_eq!(header("name: a\ndescription: b\n"), None);
        assert_eq!(header("\n---\nname: a\ndescription: b\n---\n"), None);
        assert_eq!(header("---\nname: a\ndescription: b\n"), None);
        assert_eq!(header(""), None);
    }

    #[test]
    fn skill_names_are_lowercase_digits_and_inner_hyphens_up_to_64() {
        for good in ["a", "revisar-prs", "0-9", "a-", &"a".repeat(64)] {
            assert!(is_skill_name(good), "{good}");
        }
        for bad in ["", "-a", "Revisar", "a_b", "a b", "../a", "ñ", &"a".repeat(65)] {
            assert!(!is_skill_name(bad), "{bad}");
        }
    }

    #[test]
    fn server_names_are_letters_digits_hyphens_and_underscores_up_to_64() {
        for good in ["github", "My_Server-2", "-", &"A".repeat(64)] {
            assert!(is_server_name(good), "{good}");
        }
        for bad in ["", "a b", "a.b", "a/b", "ñ", &"A".repeat(65)] {
            assert!(!is_server_name(bad), "{bad}");
        }
    }

    #[test]
    fn a_created_skill_is_listed_enabled_in_its_project_and_its_text_comes_back_whole() {
        let base = temp_root("create");
        create_skill(&base, HERE, "revisar-prs", "  Revisa un PR.  ", "# Pasos\n\n1. Lee.\n").unwrap();

        let listed = all(&base, HERE).skills;
        let text = skill_text(&base, "revisar-prs").unwrap();

        assert_eq!(
            listed,
            vec![Skill { name: "revisar-prs".into(), description: "Revisa un PR.".into(), enabled: true }]
        );
        assert_eq!(text, "---\nname: revisar-prs\ndescription: Revisa un PR.\n---\n\n# Pasos\n\n1. Lee.\n");
    }

    #[test]
    fn a_description_with_awkward_characters_survives_the_round_trip() {
        let base = temp_root("round-trip");
        let awkward = [
            "Usa: \"comillas\" y 'simples' # sin comentario",
            "C:\\ruta\\con\\barras",
            "- empieza como lista",
            "[corchetes] y {llaves}",
            "\"entera entre comillas\"",
        ];
        for (at, description) in awkward.iter().enumerate() {
            let name = format!("s{at}");
            create_skill(&base, "", &name, description, "").unwrap();
            let read = header(&skill_text(&base, &name).unwrap()).unwrap();
            assert_eq!(read.description, *description);
        }
        assert_eq!(all(&base, "").skills.len(), awkward.len());
    }

    #[test]
    fn a_description_must_exist_fit_in_1024_characters_and_one_line() {
        let base = temp_root("description");
        assert!(create_skill(&base, "", "a", "   ", "").is_err());
        assert!(create_skill(&base, "", "b", "una\notra", "").unwrap_err().contains("una sola línea"));
        assert!(create_skill(&base, "", "c", "una\rotra", "").is_err());
        assert!(create_skill(&base, "", "d", &"é".repeat(1025), "").unwrap_err().contains("1024"));
        create_skill(&base, "", "e", &"é".repeat(1024), "").unwrap();
        assert_eq!(names(&base), vec!["e"]);
    }

    #[test]
    fn creating_with_an_invalid_name_is_refused() {
        let base = temp_root("bad-name");
        assert!(create_skill(&base, "", "../fuera", "x", "").is_err());
        assert!(create_skill(&base, "", "Mayus", "x", "").is_err());
        assert!(!base.join("fuera").exists());
    }

    #[test]
    fn a_repeated_skill_name_is_an_error_and_keeps_the_first() {
        let base = temp_root("repeated");
        create_skill(&base, "", "a", "Primera.", "uno").unwrap();

        let refused = create_skill(&base, "", "a", "Segunda.", "dos").unwrap_err();

        assert!(refused.contains("ya existe"));
        assert!(skill_text(&base, "a").unwrap().contains("Primera."));
    }

    #[test]
    fn a_folder_without_a_valid_skill_file_is_not_listed() {
        let base = temp_root("invalid-folders");
        std::fs::create_dir_all(shelf(&base).join("vacia")).unwrap();
        put(&shelf(&base).join("rota").join(SKILL_FILE), b"sin cabecera");
        put(&shelf(&base).join("otra").join(SKILL_FILE), skill_md("distinta", "x", "").as_bytes());
        put(&shelf(&base).join("suelto.md"), b"x");
        create_skill(&base, "", "buena", "x", "").unwrap();

        assert_eq!(names(&base), vec!["buena"]);
    }

    #[test]
    fn skills_come_back_sorted_by_name() {
        let base = temp_root("sorted");
        for name in ["zeta", "alfa", "media"] {
            create_skill(&base, "", name, "x", "").unwrap();
        }
        assert_eq!(names(&base), vec!["alfa", "media", "zeta"]);
    }

    #[test]
    fn importing_copies_the_whole_folder_under_the_name_in_its_header() {
        let root = temp_root("import");
        let base = root.join("datos");
        let source = source_skill(&root, "importada");
        put(&source.join("scripts").join("run.sh"), b"echo hola");
        put(&source.join("docs").join("hondo").join("guia.md"), b"# guia");

        let name = import_skill(&base, "", &source).unwrap();

        let target = shelf(&base).join("importada");
        assert_eq!(name, "importada");
        assert_eq!(std::fs::read(target.join("scripts").join("run.sh")).unwrap(), b"echo hola");
        assert_eq!(std::fs::read(target.join("docs").join("hondo").join("guia.md")).unwrap(), b"# guia");
        assert_eq!(names(&base), vec!["importada"]);
        assert_eq!(leftovers(&base), vec!["importada"]);
        assert!(source.join(SKILL_FILE).exists());
    }

    #[test]
    fn importing_a_folder_without_a_valid_skill_file_is_refused() {
        let root = temp_root("import-missing");
        let base = root.join("datos");
        let bare = root.join("sin");
        put(&bare.join("README.md"), b"x");
        let broken = root.join("rota");
        put(&broken.join(SKILL_FILE), b"---\nname: rota\n---\n");
        let misnamed = root.join("mal");
        put(&misnamed.join(SKILL_FILE), b"---\nname: Mal Nombre\ndescription: x\n---\n");

        assert!(import_skill(&base, "", &bare).unwrap_err().contains(SKILL_FILE));
        assert!(import_skill(&base, "", &broken).is_err());
        assert!(import_skill(&base, "", &misnamed).is_err());
        assert!(import_skill(&base, "", &root.join("nada")).is_err());
        assert!(import_skill(&base, "", &bare.join("README.md")).is_err());
        assert!(leftovers(&base).is_empty());
    }

    #[test]
    fn importing_a_name_that_already_exists_is_refused_and_keeps_the_original() {
        let root = temp_root("import-repeated");
        let base = root.join("datos");
        create_skill(&base, "", "importada", "Original.", "").unwrap();

        let refused = import_skill(&base, "", &source_skill(&root, "importada")).unwrap_err();

        assert!(refused.contains("ya existe"));
        assert!(skill_text(&base, "importada").unwrap().contains("Original."));
        assert_eq!(leftovers(&base), vec!["importada"]);
    }

    #[test]
    fn importing_more_than_200_files_is_refused_without_leftovers() {
        let root = temp_root("import-many");
        let base = root.join("datos");
        let source = source_skill(&root, "muchos");
        for at in 0..FILE_CAP {
            put(&source.join("extra").join(format!("{at}.txt")), b"x");
        }

        assert!(import_skill(&base, "", &source).unwrap_err().contains("200"));
        assert!(leftovers(&base).is_empty());
    }

    #[test]
    fn exactly_200_files_are_accepted() {
        let root = temp_root("import-edge");
        let base = root.join("datos");
        let source = source_skill(&root, "justos");
        for at in 1..FILE_CAP {
            put(&source.join(format!("{at}.txt")), b"x");
        }

        assert_eq!(import_skill(&base, "", &source).unwrap(), "justos");
    }

    #[test]
    fn importing_more_than_10_megabytes_is_refused_without_leftovers() {
        let root = temp_root("import-heavy");
        let base = root.join("datos");
        let source = source_skill(&root, "pesada");
        put(&source.join("grande.bin"), &vec![0; BYTE_CAP as usize]);

        assert!(import_skill(&base, "", &source).unwrap_err().contains("10 MB"));
        assert!(leftovers(&base).is_empty());
    }

    #[test]
    fn importing_does_not_follow_symbolic_links() {
        let root = temp_root("import-links");
        let base = root.join("datos");
        let outside = root.join("fuera");
        put(&outside.join("secreto.txt"), b"x");
        let source = source_skill(&root, "enlazada");
        if !linked(&outside, &source.join("atajo")) {
            return;
        }

        import_skill(&base, "", &source).unwrap();

        assert!(!shelf(&base).join("enlazada").join("atajo").exists());
        assert!(import_skill(&base, "", &source.join("atajo")).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn a_copy_that_fails_halfway_leaves_nothing_behind() {
        use std::os::windows::fs::OpenOptionsExt;

        let root = temp_root("import-halfway");
        let base = root.join("datos");
        let source = source_skill(&root, "a-medias");
        put(&source.join("a.txt"), b"x");
        put(&source.join("bloqueado.txt"), b"x");
        put(&source.join("z.txt"), b"x");
        let _lock = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(source.join("bloqueado.txt"))
            .unwrap();

        assert!(import_skill(&base, "", &source).is_err());
        assert!(leftovers(&base).is_empty());
    }

    #[test]
    fn removing_a_skill_deletes_its_folder() {
        let base = temp_root("remove");
        create_skill(&base, HERE, "a", "x", "").unwrap();
        put(&shelf(&base).join("a").join("extra").join("b.txt"), b"x");

        remove_skill(&base, "a").unwrap();

        assert!(!shelf(&base).join("a").exists());
        assert!(state(&base).projects.is_empty());
        assert!(remove_skill(&base, "a").unwrap_err().contains("no existe"));
    }

    #[test]
    fn removing_refuses_names_that_reach_outside_the_skills_folder() {
        let root = temp_root("remove-outside");
        let base = root.join("datos");
        put(&base.join("mcp.json"), b"{}");
        put(&root.join("vecino").join("x.txt"), b"x");

        for name in ["..", "../vecino", ".", "", "..\\vecino", "/"] {
            assert!(remove_skill(&base, name).is_err(), "{name}");
        }
        assert!(base.join("mcp.json").exists());
        assert!(root.join("vecino").join("x.txt").exists());
    }

    #[test]
    fn removing_a_skill_that_links_outside_leaves_the_target_alone() {
        let root = temp_root("remove-link");
        let base = root.join("datos");
        let outside = root.join("fuera");
        put(&outside.join(SKILL_FILE), skill_md("atajo", "x", "").as_bytes());
        std::fs::create_dir_all(shelf(&base)).unwrap();
        if !linked(&outside, &shelf(&base).join("atajo")) {
            return;
        }

        assert!(remove_skill(&base, "atajo").is_err());
        assert!(outside.join(SKILL_FILE).exists());
    }

    #[test]
    fn a_skill_can_be_turned_on_and_off_again_in_a_project() {
        let base = temp_root("toggle-skill");
        create_skill(&base, "", "a", "x", "").unwrap();
        create_skill(&base, "", "b", "x", "").unwrap();

        set_skill(&base, HERE, "a", true).unwrap();
        let on = skill_flags(&base, HERE);
        set_skill(&base, HERE, "a", false).unwrap();
        let off = skill_flags(&base, HERE);

        assert_eq!(on, vec![true, false]);
        assert_eq!(off, vec![false, false]);
        assert!(state(&base).projects.is_empty());
    }

    #[test]
    fn an_added_server_is_listed_enabled_in_its_project_with_only_its_env_keys() {
        let base = temp_root("server");
        add_server(&base, HERE, &server("github", &[("TOKEN", "ghp_secreto"), ("ALFA", "otro-secreto")])).unwrap();

        let found = all(&base, HERE);
        let sent = serde_json::to_string(&found).unwrap();

        assert_eq!(
            found.servers,
            vec![Server {
                name: "github".into(),
                command: "npx".into(),
                args: vec!["-y".into(), "@x/github".into()],
                env_keys: vec!["ALFA".into(), "TOKEN".into()],
                enabled: true,
            }]
        );
        assert!(sent.contains("\"envKeys\":[\"ALFA\",\"TOKEN\"]"));
        assert!(!sent.contains("secreto"));
        assert!(std::fs::read_to_string(base.join(SERVERS_FILE)).unwrap().contains("ghp_secreto"));
    }

    #[test]
    fn the_server_file_is_written_with_sorted_keys() {
        let base = temp_root("server-sorted");
        add_server(&base, "", &server("zeta", &[("Z", "1"), ("A", "2")])).unwrap();
        add_server(&base, "", &server("alfa", &[])).unwrap();

        let text = std::fs::read_to_string(base.join(SERVERS_FILE)).unwrap();
        let at = |needle: &str| text.find(needle).unwrap();

        assert!(at("\"alfa\"") < at("\"zeta\""));
        assert!(at("\"args\"") < at("\"command\""));
        assert!(at("\"command\"") < at("\"env\""));
        assert!(at("\"A\"") < at("\"Z\""));
        assert!(!text.contains("enabled"));
        let order: Vec<String> = all(&base, "").servers.into_iter().map(|found| found.name).collect();
        assert_eq!(order, vec!["alfa", "zeta"]);
    }

    #[test]
    fn a_server_needs_a_valid_name_a_command_and_named_variables() {
        let base = temp_root("server-rules");
        let blank = NewServer { command: "  ".into(), ..server("a", &[]) };

        assert!(add_server(&base, "", &server("con espacio", &[])).is_err());
        assert!(add_server(&base, "", &server("", &[])).is_err());
        assert!(add_server(&base, "", &blank).unwrap_err().contains("comando"));
        assert!(add_server(&base, "", &server("b", &[(" ", "x")])).is_err());
        assert!(all(&base, "").servers.is_empty());
    }

    #[test]
    fn a_repeated_server_name_is_an_error_and_keeps_the_first() {
        let base = temp_root("server-repeated");
        add_server(&base, "", &server("github", &[("TOKEN", "primero")])).unwrap();

        let refused = add_server(&base, "", &server("github", &[("TOKEN", "segundo")])).unwrap_err();

        assert!(refused.contains("ya existe"));
        assert!(std::fs::read_to_string(base.join(SERVERS_FILE)).unwrap().contains("primero"));
    }

    #[test]
    fn a_server_can_be_turned_off_on_and_removed() {
        let base = temp_root("server-toggle");
        add_server(&base, HERE, &server("a", &[])).unwrap();
        add_server(&base, HERE, &server("b", &[])).unwrap();

        set_server(&base, HERE, "a", false).unwrap();
        let off = server_flags(&base, HERE);
        set_server(&base, HERE, "a", true).unwrap();
        remove_server(&base, "b").unwrap();

        let left: Vec<(String, bool)> = all(&base, HERE).servers.into_iter().map(|found| (found.name, found.enabled)).collect();

        assert_eq!(off, vec![false, true]);
        assert_eq!(left, vec![("a".to_string(), true)]);
        assert!(set_server(&base, HERE, "b", true).unwrap_err().contains("no existe"));
        assert!(remove_server(&base, "b").unwrap_err().contains("no existe"));
    }

    #[test]
    fn activation_in_one_project_does_not_touch_another() {
        let base = temp_root("two-projects");
        create_skill(&base, "", "a", "x", "").unwrap();
        create_skill(&base, "", "b", "x", "").unwrap();
        add_server(&base, "", &server("github", &[])).unwrap();

        set_skill(&base, HERE, "a", true).unwrap();
        set_skill(&base, THERE, "b", true).unwrap();
        set_server(&base, THERE, "github", true).unwrap();

        assert_eq!(skill_flags(&base, HERE), vec![true, false]);
        assert_eq!(skill_flags(&base, THERE), vec![false, true]);
        assert_eq!(server_flags(&base, HERE), vec![false]);
        assert_eq!(server_flags(&base, THERE), vec![true]);

        set_skill(&base, THERE, "b", false).unwrap();

        assert_eq!(skill_flags(&base, HERE), vec![true, false]);
        assert_eq!(skill_flags(&base, THERE), vec![false, false]);
    }

    #[test]
    fn without_a_project_nothing_is_enabled_and_nothing_can_be_switched() {
        let base = temp_root("no-project");
        create_skill(&base, HERE, "a", "x", "").unwrap();
        add_server(&base, HERE, &server("github", &[])).unwrap();
        let before = state_text(&base);

        assert!(set_skill(&base, "", "a", true).unwrap_err().contains("proyecto"));
        assert!(set_server(&base, "", "github", false).unwrap_err().contains("proyecto"));
        assert_eq!(skill_flags(&base, ""), vec![false]);
        assert_eq!(server_flags(&base, ""), vec![false]);
        assert_eq!(state_text(&base), before);
    }

    #[test]
    fn switching_something_that_does_not_exist_is_an_error() {
        let base = temp_root("switch-missing");

        for enabled in [true, false] {
            assert!(set_skill(&base, HERE, "nadie", enabled).unwrap_err().contains("no existe la skill"));
            assert!(set_server(&base, HERE, "nadie", enabled).unwrap_err().contains("no existe el servidor"));
        }
        assert!(set_skill(&base, HERE, "../fuera", true).is_err());
        assert!(!base.join(STATE_FILE).exists());
    }

    #[test]
    fn creating_importing_and_adding_activate_only_in_the_given_project() {
        let root = temp_root("adopt");
        let base = root.join("datos");
        create_skill(&base, HERE, "creada", "x", "").unwrap();
        import_skill(&base, HERE, &source_skill(&root, "importada")).unwrap();
        add_server(&base, HERE, &server("github", &[])).unwrap();
        create_skill(&base, "", "suelta", "x", "").unwrap();
        add_server(&base, "", &server("otro", &[])).unwrap();

        assert_eq!(names(&base), vec!["creada", "importada", "suelta"]);
        assert_eq!(skill_flags(&base, HERE), vec![true, true, false]);
        assert_eq!(server_flags(&base, HERE), vec![true, false]);
        assert_eq!(skill_flags(&base, THERE), vec![false, false, false]);
        assert_eq!(server_flags(&base, THERE), vec![false, false]);
    }

    #[test]
    fn removing_clears_the_name_from_every_project() {
        let base = temp_root("remove-everywhere");
        create_skill(&base, HERE, "a", "x", "").unwrap();
        create_skill(&base, HERE, "b", "x", "").unwrap();
        add_server(&base, HERE, &server("github", &[])).unwrap();
        set_skill(&base, THERE, "a", true).unwrap();
        set_server(&base, THERE, "github", true).unwrap();

        remove_skill(&base, "a").unwrap();
        remove_server(&base, "github").unwrap();

        let text = state_text(&base);
        assert!(!text.contains("\"a\""));
        assert!(!text.contains("github"));
        assert!(!text.contains("Otro"));
        assert_eq!(skill_flags(&base, HERE), vec![true]);
    }

    #[test]
    fn an_old_state_file_with_disabled_reads_as_empty() {
        let base = temp_root("old-state");
        put(&base.join(STATE_FILE), b"{ \"disabled\": [\"a\"] }");
        create_skill(&base, "", "a", "x", "").unwrap();

        assert_eq!(skill_flags(&base, HERE), vec![false]);

        set_skill(&base, HERE, "a", true).unwrap();

        assert_eq!(skill_flags(&base, HERE), vec![true]);
        assert!(!state_text(&base).contains("disabled"));
    }

    #[test]
    fn an_old_server_file_with_enabled_reads_fine() {
        let base = temp_root("old-servers");
        let old = b"{ \"servers\": { \"github\": { \"command\": \"npx\", \"args\": [\"-y\"], \"enabled\": false, \"env\": { \"TOKEN\": \"x\" } } } }";
        put(&base.join(SERVERS_FILE), old);

        let found = all(&base, HERE).servers;
        add_server(&base, "", &server("otro", &[])).unwrap();

        assert_eq!(
            found,
            vec![Server {
                name: "github".into(),
                command: "npx".into(),
                args: vec!["-y".into()],
                env_keys: vec!["TOKEN".into()],
                enabled: false,
            }]
        );
        assert!(!std::fs::read_to_string(base.join(SERVERS_FILE)).unwrap().contains("enabled"));
    }

    #[test]
    fn a_damaged_state_file_blocks_saving_and_is_left_alone() {
        let root = temp_root("damaged-state");
        let base = root.join("datos");
        create_skill(&base, "", "a", "x", "").unwrap();
        add_server(&base, "", &server("github", &[])).unwrap();
        put(&base.join(STATE_FILE), b"{ roto");

        assert!(set_skill(&base, HERE, "a", true).unwrap_err().contains("dañado"));
        assert!(set_server(&base, HERE, "github", true).unwrap_err().contains("dañado"));
        assert!(create_skill(&base, HERE, "b", "x", "").unwrap_err().contains("dañado"));
        assert!(import_skill(&base, HERE, &source_skill(&root, "c")).unwrap_err().contains("dañado"));
        assert!(add_server(&base, HERE, &server("otro", &[])).unwrap_err().contains("dañado"));
        assert!(remove_skill(&base, "a").unwrap_err().contains("dañado"));
        assert!(remove_server(&base, "github").unwrap_err().contains("dañado"));

        assert_eq!(state_text(&base), "{ roto");
        assert_eq!(names(&base), vec!["a"]);
        assert_eq!(skill_flags(&base, HERE), vec![false]);
        assert_eq!(server_flags(&base, HERE), vec![false]);
    }

    #[test]
    fn a_damaged_server_file_is_left_alone_instead_of_overwritten() {
        let base = temp_root("damaged-servers");
        std::fs::write(base.join(SERVERS_FILE), "{ roto").unwrap();

        assert!(add_server(&base, "", &server("github", &[])).unwrap_err().contains("dañado"));
        assert_eq!(std::fs::read_to_string(base.join(SERVERS_FILE)).unwrap(), "{ roto");
    }

    #[test]
    fn nothing_stored_yet_gives_empty_lists() {
        let found = all(&temp_root("empty"), "");
        assert!(found.skills.is_empty());
        assert!(found.servers.is_empty());
    }
}
