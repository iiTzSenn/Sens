use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use sens_agent::said;
use sens_agent::session;
use sens_agent::transcript;
use serde::Serialize;
use serde_json::Value;

use crate::capabilities::{self, NewServer, Remote};
use crate::projects;
use crate::served;

const RECENT: Duration = Duration::from_secs(60 * 24 * 60 * 60);
const PROJECTS: &str = "projects";
const SKILLS: &str = "skills";
const SKILL_FILE: &str = "SKILL.md";
const SETTINGS: &str = "settings.json";
const TRANSCRIPT: &str = "jsonl";
const TOML: &str = "toml";
const MARKERS: [&str; 2] = [".git", ".sens"];
const TRANSPORTS: [&str; 3] = ["stdio", "http", "sse"];
const STDIO: &str = "stdio";
const HTTP: &str = "http";
const VSCODE_INPUT: &str = "${input:";
const SECURE: &str = "https://";
const LOCAL: &str = "http://localhost";

fn gone() -> String {
    said!(
        en: "the folder no longer exists",
        es: "la carpeta ya no existe",
        fr: "le dossier n’existe plus",
        de: "der Ordner existiert nicht mehr",
        ja: "フォルダーはもう存在しません",
        zh: "该文件夹已不存在",
    )
}

fn vanished() -> String {
    said!(
        en: "it’s no longer in its configuration",
        es: "ya no está en su configuración",
        fr: "il ne figure plus dans sa configuration",
        de: "er steht nicht mehr in seiner Konfiguration",
        ja: "設定から削除されています",
        zh: "它已从配置中移除",
    )
}

#[derive(Clone, Copy)]
enum Under {
    Home,
    AppData,
    LocalAppData,
}

struct Source {
    id: &'static str,
    app: &'static str,
    key: &'static str,
    files: &'static [(Under, &'static str)],
}

const SOURCES: [Source; 5] = [
    Source {
        id: "claude-desktop",
        app: "Claude Desktop",
        key: "mcpServers",
        files: &[
            (Under::AppData, "Claude/claude_desktop_config.json"),
            (Under::LocalAppData, "Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/claude_desktop_config.json"),
        ],
    },
    Source { id: "cursor", app: "Cursor", key: "mcpServers", files: &[(Under::Home, ".cursor/mcp.json")] },
    Source { id: "windsurf", app: "Windsurf", key: "mcpServers", files: &[(Under::Home, ".codeium/windsurf/mcp_config.json")] },
    Source { id: "vscode", app: "VS Code", key: "servers", files: &[(Under::AppData, "Code/User/mcp.json")] },
    Source { id: "codex", app: "Codex", key: "mcp_servers", files: &[(Under::Home, ".codex/config.toml")] },
];

pub struct Places {
    pub claude: PathBuf,
    pub claude_json: PathBuf,
    pub home: PathBuf,
    pub appdata: PathBuf,
    pub localappdata: PathBuf,
    pub app_folder: PathBuf,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub claude: String,
    pub projects: Vec<FoundProject>,
    pub skills: Vec<String>,
    pub servers: Vec<String>,
    pub plugins: Vec<String>,
    pub foreign: Vec<ForeignServer>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FoundProject {
    pub root: String,
    pub name: String,
    pub exists: bool,
    pub sessions: usize,
    pub already: usize,
    pub last: u64,
    pub suggested: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ForeignServer {
    pub id: String,
    pub source: &'static str,
    pub app: &'static str,
    pub name: String,
    pub kind: &'static str,
    pub command: String,
    pub args: Vec<String>,
    pub url: String,
    pub env_keys: Vec<String>,
    pub blocked: String,
    #[serde(skip)]
    env: BTreeMap<String, String>,
    #[serde(skip)]
    headers: BTreeMap<String, String>,
}

#[derive(Serialize, Debug, Default)]
pub struct Adopted {
    pub sessions: usize,
    pub projects: usize,
    pub skipped: Vec<Unadopted>,
}

#[derive(Serialize, Debug)]
pub struct Unadopted {
    pub root: String,
    pub reason: String,
}

#[derive(Serialize, Debug, Default)]
pub struct Imported {
    pub added: Vec<String>,
    pub skipped: Vec<Unimported>,
}

#[derive(Serialize, Debug)]
pub struct Unimported {
    pub name: String,
    pub reason: String,
}

struct Held {
    root: String,
    cwd: String,
    id: String,
    path: PathBuf,
}

struct Taken {
    sens: BTreeSet<String>,
    claude_code: BTreeSet<String>,
}

impl Places {
    pub fn current() -> Result<Self, String> {
        let home = std::env::home_dir().ok_or_else(|| {
            said!(
                en: "can’t find your user folder",
                es: "no encuentro tu carpeta de usuario",
                fr: "dossier utilisateur introuvable",
                de: "Benutzerordner nicht gefunden",
                ja: "ユーザーフォルダーが見つかりません",
                zh: "找不到你的用户文件夹",
            )
        })?;
        let known = |variable: &str, parts: [&str; 2]| {
            std::env::var_os(variable)
                .filter(|folder| !folder.is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(parts[0]).join(parts[1]))
        };
        Ok(Self {
            claude: served::config_folder().ok_or_else(|| {
                said!(
                    en: "can’t find the Claude Code folder",
                    es: "no encuentro la carpeta de Claude Code",
                    fr: "dossier de Claude Code introuvable",
                    de: "Ordner von Claude Code nicht gefunden",
                    ja: "Claude Code のフォルダーが見つかりません",
                    zh: "找不到 Claude Code 文件夹",
                )
            })?,
            claude_json: served::global_config().ok_or_else(|| {
                said!(
                    en: "can’t find the Claude Code configuration",
                    es: "no encuentro la configuración de Claude Code",
                    fr: "configuration de Claude Code introuvable",
                    de: "Konfiguration von Claude Code nicht gefunden",
                    ja: "Claude Code の設定が見つかりません",
                    zh: "找不到 Claude Code 配置",
                )
            })?,
            appdata: known("APPDATA", ["AppData", "Roaming"]),
            localappdata: known("LOCALAPPDATA", ["AppData", "Local"]),
            app_folder: std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(Path::to_path_buf))
                .unwrap_or_default(),
            home,
        })
    }

    fn folder(&self, under: Under) -> &Path {
        match under {
            Under::Home => &self.home,
            Under::AppData => &self.appdata,
            Under::LocalAppData => &self.localappdata,
        }
    }
}

pub fn scan(base: &Path, places: &Places) -> Found {
    let claude_code = claude_servers(places);
    Found {
        claude: places.claude.to_string_lossy().into_owned(),
        projects: found_projects(base, places),
        skills: skills(&places.claude),
        servers: claude_code.iter().cloned().collect(),
        plugins: plugins(&places.claude),
        foreign: foreign(base, places, claude_code),
    }
}

pub fn adopt(base: &Path, places: &Places, roots: &[String], mut report: impl FnMut(usize, usize)) -> Adopted {
    let chosen: Vec<Held> = held(base, places).into_iter().filter(|held| roots.contains(&held.root)).collect();
    let total = chosen.len();
    let mut adopted = Adopted::default();
    let mut refused: BTreeMap<String, String> = BTreeMap::new();
    report(0, total);
    for (done, held) in chosen.iter().enumerate() {
        if !refused.contains_key(&held.root) {
            match transcript::adopt(&held.path) {
                Ok(transcript::Adopted::Written) => adopted.sessions += 1,
                Ok(_) => {}
                Err(reason) => {
                    refused.insert(held.root.clone(), reason);
                }
            }
        }
        report(done + 1, total);
    }
    for root in unique(roots) {
        let registered = match refused.remove(root) {
            Some(reason) => Err(reason),
            None if !Path::new(root).is_dir() => Err(gone()),
            None => projects::register(base, root),
        };
        match registered {
            Ok(()) => adopted.projects += 1,
            Err(reason) => adopted.skipped.push(Unadopted { root: root.to_string(), reason }),
        }
    }
    adopted
}

pub fn import_servers(base: &Path, places: &Places, ids: &[String], roots: &[String]) -> Imported {
    let offered = foreign(base, places, claude_servers(places));
    let mut imported = Imported::default();
    for id in unique(ids) {
        let Some(server) = offered.iter().find(|server| server.id == id) else {
            let name = id.split_once(':').map_or(id, |(_, name)| name);
            imported.skipped.push(Unimported { name: name.to_string(), reason: vanished() });
            continue;
        };
        match bring(base, server, roots) {
            Ok(()) => imported.added.push(server.name.clone()),
            Err(reason) => imported.skipped.push(Unimported { name: server.name.clone(), reason }),
        }
    }
    imported
}

fn bring(base: &Path, server: &ForeignServer, roots: &[String]) -> Result<(), String> {
    if !server.blocked.is_empty() {
        return Err(server.blocked.clone());
    }
    if server.kind == STDIO {
        let local = NewServer {
            name: server.name.clone(),
            command: server.command.clone(),
            args: server.args.clone(),
            env: server.env.clone(),
        };
        capabilities::add_server(base, "", &local)?;
    } else {
        let remote = Remote { kind: server.kind.to_string(), url: server.url.clone(), headers: server.headers.clone() };
        capabilities::add_remote(base, "", &server.name, remote)?;
    }
    unique(roots)
        .into_iter()
        .filter(|root| !root.is_empty())
        .try_for_each(|root| capabilities::set_server(base, root, &server.name, true))
}

fn unique(items: &[String]) -> Vec<&str> {
    let mut seen = BTreeSet::new();
    items.iter().map(String::as_str).filter(|item| seen.insert(*item)).collect()
}

fn held(base: &Path, places: &Places) -> Vec<Held> {
    let own = [base, places.app_folder.as_path()];
    transcripts(&places.claude.join(PROJECTS))
        .into_iter()
        .filter_map(|path| {
            let id = transcript::id_of(&path)?;
            let cwd = transcript::root_of(&path)?;
            let root = folder_key(&cwd);
            let mine = own.iter().any(|folder| same_folder(&root, folder));
            (!mine).then_some(Held { root, cwd, id, path })
        })
        .collect()
}

fn transcripts(folder: &Path) -> Vec<PathBuf> {
    children(folder)
        .into_iter()
        .filter(|path| path.is_dir())
        .flat_map(|project| children(&project))
        .filter(|path| path.is_file() && path.extension().is_some_and(|extension| extension == TRANSCRIPT))
        .collect()
}

fn children(folder: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect()
}

fn folder_key(cwd: &str) -> String {
    let mut letters = cwd.chars();
    match (letters.next(), letters.next()) {
        (Some(drive), Some(':')) if drive.is_ascii_lowercase() => format!("{}{}", drive.to_ascii_uppercase(), &cwd[1..]),
        _ => cwd.to_string(),
    }
}

fn same_folder(root: &str, folder: &Path) -> bool {
    let plain = |text: &str| text.replace('/', "\\").trim_end_matches('\\').to_lowercase();
    !folder.as_os_str().is_empty() && plain(root) == plain(&folder.to_string_lossy())
}

fn found_projects(base: &Path, places: &Places) -> Vec<FoundProject> {
    let mut grouped: BTreeMap<String, FoundProject> = BTreeMap::new();
    for held in held(base, places) {
        let project = grouped.entry(held.root.clone()).or_insert_with(|| blank(&held.root));
        project.sessions += 1;
        project.already += usize::from(session::exists(Path::new(&held.cwd), &held.id));
        project.last = project.last.max(modified(&held.path));
    }
    let now = session::now();
    let mut found: Vec<FoundProject> = grouped
        .into_values()
        .map(|project| FoundProject { suggested: suggested(&project, now), ..project })
        .collect();
    found.sort_by_key(|project| std::cmp::Reverse(project.last));
    found
}

fn blank(root: &str) -> FoundProject {
    let folder = Path::new(root);
    FoundProject {
        root: root.to_string(),
        name: projects::name_of(folder),
        exists: folder.is_dir(),
        sessions: 0,
        already: 0,
        last: 0,
        suggested: false,
    }
}

fn suggested(project: &FoundProject, now: u64) -> bool {
    let folder = Path::new(&project.root);
    project.exists
        && MARKERS.iter().any(|marker| folder.join(marker).exists())
        && now.saturating_sub(project.last) <= RECENT.as_millis() as u64
}

fn modified(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|at| at.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_millis() as u64)
}

fn skills(claude: &Path) -> Vec<String> {
    let mut names: Vec<String> = children(&claude.join(SKILLS))
        .into_iter()
        .filter(|folder| folder.join(SKILL_FILE).is_file())
        .filter_map(|folder| Some(folder.file_name()?.to_string_lossy().into_owned()))
        .collect();
    names.sort();
    names
}

fn claude_servers(places: &Places) -> BTreeSet<String> {
    config(&places.claude_json)
        .and_then(|found| found.get("mcpServers")?.as_object().map(|servers| servers.keys().cloned().collect()))
        .unwrap_or_default()
}

fn plugins(claude: &Path) -> Vec<String> {
    let settings = config(&claude.join(SETTINGS)).unwrap_or_default();
    let enabled: BTreeSet<String> = settings["enabledPlugins"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(_, on)| **on == true)
        .map(|(key, _)| key.split('@').next().unwrap_or(key).to_string())
        .collect();
    enabled.into_iter().collect()
}

fn config(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    let text = text.trim_start_matches('\u{feff}');
    if path.extension().is_some_and(|extension| extension == TOML) {
        return serde_json::to_value(toml::from_str::<toml::Table>(text).ok()?).ok();
    }
    serde_json::from_str(&lenient(text)).ok()
}

fn lenient(text: &str) -> String {
    let mut kept = String::with_capacity(text.len());
    let mut letters = text.chars().peekable();
    let mut quoted = false;
    while let Some(letter) = letters.next() {
        if quoted {
            kept.push(letter);
            match letter {
                '\\' => kept.extend(letters.next()),
                '"' => quoted = false,
                _ => {}
            }
            continue;
        }
        match (letter, letters.peek()) {
            ('/', Some('/')) => while letters.next_if(|next| *next != '\n').is_some() {},
            ('/', Some('*')) => {
                letters.next();
                let mut last = ' ';
                for next in letters.by_ref() {
                    if last == '*' && next == '/' {
                        break;
                    }
                    last = next;
                }
            }
            (']' | '}', _) => {
                let end = kept.trim_end().len();
                if kept[..end].ends_with(',') {
                    kept.truncate(end - 1);
                }
                kept.push(letter);
            }
            _ => {
                quoted = letter == '"';
                kept.push(letter);
            }
        }
    }
    kept
}

fn foreign(base: &Path, places: &Places, claude_code: BTreeSet<String>) -> Vec<ForeignServer> {
    let sens = capabilities::all(base, "").servers.into_iter().map(|server| server.name).collect();
    let taken = Taken { sens, claude_code };
    SOURCES.iter().flat_map(|source| offered(source, places, &taken)).collect()
}

fn offered(source: &Source, places: &Places, taken: &Taken) -> Vec<ForeignServer> {
    let mut seen = BTreeSet::new();
    let mut found: Vec<ForeignServer> = source
        .files
        .iter()
        .filter_map(|(under, file)| config(&places.folder(*under).join(file)))
        .filter_map(|found| found.get(source.key)?.as_object().cloned())
        .flatten()
        .filter(|(name, _)| seen.insert(name.clone()))
        .map(|(name, entry)| described(source, name, &entry, taken))
        .collect();
    found.sort_by(|a, b| a.name.cmp(&b.name));
    found
}

fn described(source: &Source, name: String, entry: &Value, taken: &Taken) -> ForeignServer {
    let url = ["url", "serverUrl"]
        .iter()
        .find_map(|key| entry[key].as_str().filter(|url| !url.is_empty()))
        .unwrap_or_default()
        .to_string();
    let declared = entry["type"].as_str().unwrap_or(if url.is_empty() { STDIO } else { HTTP });
    let kind = TRANSPORTS
        .into_iter()
        .find(|known| *known == declared)
        .unwrap_or(if url.is_empty() { STDIO } else { HTTP });
    let env = texts(&entry["env"]);
    let headers: BTreeMap<String, String> = texts(&entry["headers"]).into_iter().chain(texts(&entry["http_headers"])).collect();
    let command = entry["command"].as_str().unwrap_or_default().to_string();
    let checks = [
        (!capabilities::is_server_name(&name), said!(
            en: "the name won’t work in Sens: use letters, numbers, hyphens or underscores",
            es: "el nombre no vale en Sens: usa letras, números, guiones o guiones bajos",
            fr: "ce nom n’est pas valide dans Sens : utilisez des lettres, des chiffres, des traits d’union ou des tirets bas",
            de: "der Name ist in Sens nicht gültig: nutze Buchstaben, Ziffern, Bindestriche oder Unterstriche",
            ja: "この名前は Sens では使えません。英数字、ハイフン、アンダースコアを使ってください",
            zh: "该名称在 Sens 中无效：请使用字母、数字、连字符或下划线",
        )),
        (taken.sens.contains(&name), said!(
            en: "there’s already a server with that name in Sens",
            es: "ya hay un servidor con ese nombre en Sens",
            fr: "un serveur porte déjà ce nom dans Sens",
            de: "in Sens gibt es schon einen Server mit diesem Namen",
            ja: "Sens にはすでに同じ名前のサーバーがあります",
            zh: "Sens 中已有同名服务器",
        )),
        (taken.claude_code.contains(&name), said!(
            en: "Claude Code already has a server with that name",
            es: "Claude Code ya tiene un servidor con ese nombre",
            fr: "Claude Code a déjà un serveur portant ce nom",
            de: "Claude Code hat schon einen Server mit diesem Namen",
            ja: "Claude Code にはすでに同じ名前のサーバーがあります",
            zh: "Claude Code 中已有同名服务器",
        )),
        (entry.to_string().contains(VSCODE_INPUT), said!(
            en: "it uses VS Code ${{input:…}} variables, which Sens can’t fill in",
            es: "usa variables ${{input:…}} de VS Code, que Sens no puede rellenar",
            fr: "il utilise des variables ${{input:…}} de VS Code, que Sens ne peut pas renseigner",
            de: "er nutzt ${{input:…}}-Variablen von VS Code, die Sens nicht ausfüllen kann",
            ja: "VS Code の ${{input:…}} 変数を使っていますが、Sens では値を入れられません",
            zh: "它使用了 VS Code 的 ${{input:…}} 变量，Sens 无法填写",
        )),
        (!TRANSPORTS.contains(&declared), said!(
            en: "it uses the {declared} transport, which Sens doesn’t support",
            es: "usa el transporte {declared}, que Sens no admite",
            fr: "il utilise le transport {declared}, que Sens ne prend pas en charge",
            de: "er nutzt den Transport {declared}, den Sens nicht unterstützt",
            ja: "Sens が対応していない {declared} トランスポートを使っています",
            zh: "它使用了 Sens 不支持的 {declared} 传输方式",
        )),
        (kind == STDIO && command.trim().is_empty(), said!(
            en: "it doesn’t say which command to run",
            es: "no dice qué comando lanzar",
            fr: "il n’indique pas quelle commande exécuter",
            de: "er gibt nicht an, welcher Befehl ausgeführt werden soll",
            ja: "実行するコマンドが指定されていません",
            zh: "未指定要运行的命令",
        )),
        (kind != STDIO && !url.starts_with(SECURE) && !url.starts_with(LOCAL), said!(
            en: "its address doesn’t start with https://",
            es: "su dirección no empieza por https://",
            fr: "son adresse ne commence pas par https://",
            de: "seine Adresse beginnt nicht mit https://",
            ja: "アドレスが https:// で始まっていません",
            zh: "其地址不以 https:// 开头",
        )),
    ];
    ForeignServer {
        id: format!("{}:{name}", source.id),
        source: source.id,
        app: source.app,
        kind,
        args: entry["args"].as_array().into_iter().flatten().map(text).collect(),
        env_keys: env.keys().chain(headers.keys()).cloned().collect(),
        blocked: checks.into_iter().find_map(|(fails, reason)| fails.then_some(reason)).unwrap_or_default(),
        name,
        command,
        url,
        env,
        headers,
    }
}

fn texts(value: &Value) -> BTreeMap<String, String> {
    value
        .as_object()
        .into_iter()
        .flatten()
        .map(|(key, inner)| (key.clone(), text(inner)))
        .collect()
}

fn text(value: &Value) -> String {
    value.as_str().map_or_else(|| value.to_string(), str::to_string)
}

#[cfg(test)]
mod tests {
    use std::time::SystemTime;

    use sens_agent::language::{Language, speaking};
    use sens_agent::session::Entry;
    use serde_json::json;

    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("sens-welcome-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn places(root: &Path) -> Places {
        let home = root.join("home");
        Places {
            claude: home.join(".claude"),
            claude_json: home.join(".claude.json"),
            appdata: root.join("appdata"),
            localappdata: root.join("localappdata"),
            app_folder: root.join("app"),
            home,
        }
    }

    fn put(path: &Path, body: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    fn folder(root: &Path, name: &str, markers: &[&str]) -> PathBuf {
        let path = root.join("work").join(name);
        std::fs::create_dir_all(&path).unwrap();
        for marker in markers {
            std::fs::create_dir_all(path.join(marker)).unwrap();
        }
        path
    }

    fn text_of(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    fn talk(cwd: &str) -> String {
        [
            json!({ "type": "queue-operation", "operation": "enqueue", "timestamp": "2026-09-20T10:00:00.000Z" }),
            json!({ "type": "user", "message": { "role": "user", "content": "Hola" }, "timestamp": "2026-09-20T10:00:00.100Z", "cwd": cwd }),
            json!({ "type": "assistant", "message": { "id": "m1", "model": "claude-opus-5-5", "role": "assistant", "content": [{ "type": "text", "text": "Hola." }] }, "timestamp": "2026-09-20T10:00:01.000Z", "cwd": cwd }),
        ]
        .iter()
        .map(|line| format!("{line}\n"))
        .collect()
    }

    fn transcript_in(places: &Places, cwd: &str) -> (String, PathBuf) {
        let id = session::fresh_id();
        let encoded: String = cwd.chars().map(|letter| if letter.is_ascii_alphanumeric() { letter } else { '-' }).collect();
        let path = places.claude.join(PROJECTS).join(encoded).join(format!("{id}.jsonl"));
        put(&path, &talk(cwd));
        (id, path)
    }

    fn lower_drive(path: &Path) -> String {
        let text = text_of(path);
        match cfg!(windows) {
            true => format!("{}{}", text[..1].to_ascii_lowercase(), &text[1..]),
            false => text,
        }
    }

    fn project<'a>(found: &'a Found, root: &Path) -> &'a FoundProject {
        found.projects.iter().find(|project| project.root == text_of(root)).unwrap()
    }

    fn age(path: &Path, days: u64) {
        let file = std::fs::File::options().write(true).open(path).unwrap();
        file.set_modified(SystemTime::now() - Duration::from_secs(days * 24 * 60 * 60)).unwrap();
    }

    #[test]
    fn sessions_are_grouped_by_the_folder_they_ran_in() {
        let root = temp_root("grouped");
        let places = places(&root);
        let alpha = folder(&root, "alpha", &[".git"]);
        let beta = folder(&root, "beta", &[]);
        transcript_in(&places, &text_of(&alpha));
        let (_, second) = transcript_in(&places, &lower_drive(&alpha));
        let (id, _) = transcript_in(&places, &text_of(&beta));
        put(&second.with_extension("").join("subagents").join("agent-a1.jsonl"), &talk(&text_of(&beta)));
        put(&second.parent().unwrap().join("notas.txt"), &talk(&text_of(&beta)));
        put(&places.claude.join(PROJECTS).join(format!("{id}.jsonl")), &talk(&text_of(&beta)));

        let found = scan(&root.join("base"), &places);

        assert_eq!(found.projects.len(), 2);
        assert_eq!(project(&found, &alpha).sessions, 2);
        assert_eq!(project(&found, &alpha).name, "alpha");
        assert_eq!(project(&found, &beta).sessions, 1);
        assert!(project(&found, &beta).exists);
        assert_eq!(found.claude, text_of(&places.claude));
    }

    #[test]
    fn sessions_already_in_sens_are_counted_apart() {
        let root = temp_root("already");
        let places = places(&root);
        let alpha = folder(&root, "alpha", &[".git"]);
        let (id, _) = transcript_in(&places, &text_of(&alpha));
        transcript_in(&places, &text_of(&alpha));
        session::open_as(&alpha, &id).unwrap();

        let found = scan(&root.join("base"), &places);

        assert_eq!(project(&found, &alpha).sessions, 2);
        assert_eq!(project(&found, &alpha).already, 1);
    }

    #[test]
    fn only_live_recent_projects_with_a_repository_or_sens_are_suggested() {
        let root = temp_root("suggested");
        let places = places(&root);
        let git = folder(&root, "git", &[".git"]);
        let sens = folder(&root, "sens", &[".sens"]);
        let plain = folder(&root, "plain", &[]);
        let old = folder(&root, "old", &[".git"]);
        let gone = folder(&root, "gone", &[".git"]);
        for place in [&git, &sens, &plain, &gone] {
            transcript_in(&places, &text_of(place));
        }
        let (_, stale) = transcript_in(&places, &text_of(&old));
        age(&stale, 90);
        std::fs::remove_dir_all(&gone).unwrap();

        let found = scan(&root.join("base"), &places);

        assert!(project(&found, &git).suggested);
        assert!(project(&found, &sens).suggested);
        assert!(!project(&found, &plain).suggested);
        assert!(!project(&found, &old).suggested);
        assert!(!project(&found, &gone).suggested);
        assert!(!project(&found, &gone).exists);
        assert_eq!(found.projects.last().unwrap().root, text_of(&old));
    }

    #[test]
    fn the_app_folder_and_the_sens_data_folder_are_left_out() {
        let root = temp_root("own");
        let places = places(&root);
        let base = root.join("base");
        std::fs::create_dir_all(&places.app_folder).unwrap();
        std::fs::create_dir_all(&base).unwrap();
        transcript_in(&places, &text_of(&places.app_folder));
        transcript_in(&places, &format!("{}\\", text_of(&base)));
        transcript_in(&places, &text_of(&folder(&root, "alpha", &[])));

        let found = scan(&base, &places);

        assert_eq!(found.projects.len(), 1);
        assert_eq!(found.projects[0].name, "alpha");
    }

    #[test]
    fn what_claude_code_already_loads_is_listed_by_name() {
        let root = temp_root("loaded");
        let places = places(&root);
        put(&places.claude.join(SKILLS).join("pdf").join(SKILL_FILE), "---\nname: pdf\ndescription: x\n---\n");
        put(&places.claude.join(SKILLS).join("docx").join(SKILL_FILE), "---\nname: docx\ndescription: x\n---\n");
        std::fs::create_dir_all(places.claude.join(SKILLS).join("synced")).unwrap();
        put(&places.claude_json, r#"{ "mcpServers": { "linear": { "command": "npx" }, "github": { "type": "http", "url": "https://api.github.com/mcp" } }, "projects": {} }"#);
        put(&places.claude.join(SETTINGS), r#"{ "enabledPlugins": { "superpowers@official": true, "viejo@otro": false, "frontend-design@claude-plugins-official": true } }"#);

        let found = scan(&root.join("base"), &places);

        assert_eq!(found.skills, vec!["docx", "pdf"]);
        assert_eq!(found.servers, vec!["github", "linear"]);
        assert_eq!(found.plugins, vec!["frontend-design", "superpowers"]);
        assert!(found.projects.is_empty());
        assert!(found.foreign.is_empty());
    }

    fn foreign_configs(places: &Places) {
        let filesystem = r#""filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\docs"], "env": { "DEBUG": "1" } }"#;
        put(&places.appdata.join("Claude").join("claude_desktop_config.json"), &format!(r#"{{ "mcpServers": {{ {filesystem} }}, "preferences": {{}} }}"#));
        put(
            &places.localappdata.join("Packages").join("Claude_pzs8sxrjxfjjc").join("LocalCache").join("Roaming").join("Claude").join("claude_desktop_config.json"),
            &format!(r#"{{ "mcpServers": {{ {filesystem}, "memory": {{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] }} }} }}"#),
        );
        put(&places.home.join(".cursor").join("mcp.json"), r#"{ "mcpServers": { "context7": { "url": "https://mcp.context7.com/mcp", "headers": { "CONTEXT7_API_KEY": "clave-secreta" } } } }"#);
        put(&places.home.join(".codeium").join("windsurf").join("mcp_config.json"), r#"{ "mcpServers": { "figma": { "serverUrl": "https://mcp.figma.com/mcp" } } }"#);
        put(
            &places.appdata.join("Code").join("User").join("mcp.json"),
            "{\n  // servidores de VS Code\n  \"servers\": {\n    \"playwright\": { \"type\": \"stdio\", \"command\": \"npx\", \"args\": [\"@playwright/mcp@latest\"] },\n    /* eventos */\n    \"events\": { \"type\": \"sse\", \"url\": \"https://events.example.com/sse\" },\n  },\n  \"inputs\": [],\n}\n",
        );
        put(
            &places.home.join(".codex").join("config.toml"),
            "model = \"gpt-5\"\n\n[mcp_servers.docs]\ncommand = 'C:\\tools\\docs-mcp.exe'\nargs = [\"--port\", \"0\"]\nstartup_timeout_sec = 120\n\n[mcp_servers.docs.env]\nDOCS_TOKEN = \"t-123\"\n\n[mcp_servers.remote_docs]\nurl = \"https://docs.example.com/mcp\"\n\n[mcp_servers.remote_docs.http_headers]\nX-Key = \"k\"\n\n[projects.'c:\\work']\ntrust_level = \"trusted\"\n",
        );
    }

    #[test]
    fn servers_from_every_other_app_are_found_once_each() {
        let root = temp_root("foreign");
        let places = places(&root);
        foreign_configs(&places);

        let found = scan(&root.join("base"), &places);
        let listed: Vec<(&str, &str, &str, &str)> = found
            .foreign
            .iter()
            .map(|server| (server.id.as_str(), server.app, server.kind, if server.kind == STDIO { server.command.as_str() } else { server.url.as_str() }))
            .collect();

        assert_eq!(
            listed,
            vec![
                ("claude-desktop:filesystem", "Claude Desktop", "stdio", "npx"),
                ("claude-desktop:memory", "Claude Desktop", "stdio", "npx"),
                ("cursor:context7", "Cursor", "http", "https://mcp.context7.com/mcp"),
                ("windsurf:figma", "Windsurf", "http", "https://mcp.figma.com/mcp"),
                ("vscode:events", "VS Code", "sse", "https://events.example.com/sse"),
                ("vscode:playwright", "VS Code", "stdio", "npx"),
                ("codex:docs", "Codex", "stdio", "C:\\tools\\docs-mcp.exe"),
                ("codex:remote_docs", "Codex", "http", "https://docs.example.com/mcp"),
            ]
        );
        assert!(found.foreign.iter().all(|server| server.blocked.is_empty()));
        let docs = found.foreign.iter().find(|server| server.id == "codex:docs").unwrap();
        assert_eq!(docs.args, vec!["--port", "0"]);
        assert_eq!(docs.env_keys, vec!["DOCS_TOKEN"]);
        assert_eq!(found.foreign[0].args[2], "C:\\docs");
        assert_eq!(found.foreign[2].env_keys, vec!["CONTEXT7_API_KEY"]);
        assert_eq!(found.foreign[7].env_keys, vec!["X-Key"]);
    }

    #[test]
    fn servers_that_cannot_come_say_why() {
        let root = temp_root("blocked");
        let places = places(&root);
        let base = root.join("base");
        let taken = NewServer { name: "ya-en-sens".into(), command: "npx".into(), args: Vec::new(), env: BTreeMap::new() };
        capabilities::add_server(&base, "", &taken).unwrap();
        put(&places.claude_json, r#"{ "mcpServers": { "github": { "command": "npx" } } }"#);
        put(
            &places.home.join(".cursor").join("mcp.json"),
            r#"{ "mcpServers": {
                "Brave Search": { "command": "npx" },
                "ya-en-sens": { "command": "npx" },
                "github": { "command": "npx" },
                "socket": { "type": "ws", "url": "wss://example.com" },
                "plano": { "url": "http://example.com/mcp" },
                "local": { "url": "http://localhost:3000/mcp" },
                "vacio": { "args": ["x"] }
            } }"#,
        );
        put(&places.appdata.join("Code").join("User").join("mcp.json"), r#"{ "servers": { "tokens": { "command": "npx", "env": { "TOKEN": "${input:token}" } } }, "inputs": [{ "id": "token", "type": "promptString" }] }"#);

        let found = scan(&base, &places);
        let reason = |id: &str| found.foreign.iter().find(|server| server.id == id).unwrap().blocked.clone();

        assert!(reason("cursor:Brave Search").contains("the name won’t work"));
        assert!(reason("cursor:ya-en-sens").contains("in Sens"));
        assert!(reason("cursor:github").contains("Claude Code already has"));
        assert!(reason("cursor:socket").contains("the ws transport"));
        assert_eq!(found.foreign.iter().find(|server| server.id == "cursor:socket").unwrap().kind, HTTP);
        assert!(reason("cursor:plano").contains("https://"));
        assert_eq!(reason("cursor:local"), "");
        assert!(reason("cursor:vacio").contains("command"));
        assert!(reason("vscode:tokens").contains("${input:"));

        let spoken = speaking(Language::Es, || scan(&base, &places));
        let reason = |id: &str| spoken.foreign.iter().find(|server| server.id == id).unwrap().blocked.clone();
        assert_eq!(reason("cursor:socket"), "usa el transporte ws, que Sens no admite");
        assert_eq!(reason("vscode:tokens"), "usa variables ${input:…} de VS Code, que Sens no puede rellenar");
        assert_eq!(reason("cursor:local"), "");
    }

    #[test]
    fn importing_adds_each_server_and_turns_it_on_in_the_projects_brought() {
        let root = temp_root("import");
        let places = places(&root);
        let base = root.join("base");
        foreign_configs(&places);
        put(&places.home.join(".codeium").join("windsurf").join("mcp_config.json"), r#"{ "mcpServers": { "Mal Nombre": { "command": "x" } } }"#);
        let here = text_of(&folder(&root, "alpha", &[]));
        let there = text_of(&folder(&root, "beta", &[]));
        let ids: Vec<String> = ["claude-desktop:filesystem", "cursor:context7", "vscode:events", "windsurf:Mal Nombre", "cursor:borrado", "cursor:context7"]
            .iter()
            .map(|id| id.to_string())
            .collect();

        let imported = import_servers(&base, &places, &ids, &[here.clone(), there.clone(), String::new()]);

        assert_eq!(imported.added, vec!["filesystem", "context7", "events"]);
        let skipped: Vec<(&str, &str)> = imported.skipped.iter().map(|skip| (skip.name.as_str(), skip.reason.as_str())).collect();
        assert_eq!(skipped.len(), 2);
        assert_eq!(skipped[0].0, "Mal Nombre");
        assert!(skipped[0].1.contains("the name won’t work"));
        assert_eq!(skipped[1], ("borrado", vanished().as_str()));

        for root in [&here, &there] {
            let servers = capabilities::all(&base, root).servers;
            assert_eq!(servers.len(), 3);
            assert!(servers.iter().all(|server| server.enabled));
        }
        assert!(capabilities::all(&base, "P:\\otro").servers.iter().all(|server| !server.enabled));
        let kept: Value = serde_json::from_str(&std::fs::read_to_string(base.join("mcp.json")).unwrap()).unwrap();
        assert_eq!(kept["servers"]["filesystem"]["env"]["DEBUG"], "1");
        assert_eq!(kept["servers"]["filesystem"]["args"][2], "C:\\docs");
        assert_eq!(kept["servers"]["context7"]["headers"]["CONTEXT7_API_KEY"], "clave-secreta");
        assert_eq!(kept["servers"]["events"]["kind"], "sse");

        let again = import_servers(&base, &places, &ids[..1], &[here]);
        assert!(again.added.is_empty());
        assert!(again.skipped[0].reason.contains("in Sens"));
    }

    #[test]
    fn adopting_writes_the_sessions_registers_the_projects_and_reports_progress() {
        let root = temp_root("adopt");
        let places = places(&root);
        let base = root.join("base");
        let alpha = folder(&root, "alpha", &[".git"]);
        let beta = folder(&root, "beta", &[]);
        let (first, _) = transcript_in(&places, &text_of(&alpha));
        let (second, _) = transcript_in(&places, &lower_drive(&alpha));
        transcript_in(&places, &text_of(&beta));
        let mut heard = Vec::new();

        let adopted = adopt(&base, &places, &[text_of(&alpha)], |done, total| heard.push((done, total)));

        assert_eq!(heard, vec![(0, 2), (1, 2), (2, 2)]);
        assert_eq!((adopted.sessions, adopted.projects), (2, 1));
        assert!(adopted.skipped.is_empty());
        assert!(session::has_begun(&alpha, &first));
        assert!(session::has_begun(&alpha, &second));
        assert!(session::list(&beta).is_empty());
        let registry = projects::load(&base);
        assert_eq!(registry.projects.len(), 1);
        assert_eq!(registry.projects[0].root, text_of(&alpha));
        assert_eq!(registry.projects[0].opened, 0);
        assert!(registry.last.is_none());
        assert_eq!(projects::workspaces(&registry)[0].sessions.len(), 2);

        let again = adopt(&base, &places, &[text_of(&alpha)], |_, _| {});
        assert_eq!((again.sessions, again.projects), (0, 1));
        assert_eq!(project(&scan(&base, &places), &alpha).already, 2);
    }

    #[test]
    fn a_project_that_cannot_take_sessions_is_skipped_and_the_rest_go_on() {
        let root = temp_root("refused");
        let places = places(&root);
        let base = root.join("base");
        let locked = folder(&root, "locked", &[]);
        put(&locked.join(".sens"), "no soy una carpeta");
        let gone = folder(&root, "gone", &[]);
        let fine = folder(&root, "fine", &[]);
        for place in [&locked, &locked, &gone, &fine] {
            transcript_in(&places, &text_of(place));
        }
        std::fs::remove_dir_all(&gone).unwrap();

        let roots = [text_of(&locked), text_of(&gone), text_of(&fine)];
        let adopted = speaking(Language::Es, || adopt(&base, &places, &roots, |_, _| {}));

        assert_eq!((adopted.sessions, adopted.projects), (1, 1));
        let skipped: Vec<&str> = adopted.skipped.iter().map(|skip| skip.root.as_str()).collect();
        assert_eq!(skipped, vec![roots[0].as_str(), roots[1].as_str()]);
        assert!(adopted.skipped[0].reason.contains("no pude crear"));
        assert!(adopted.skipped[1].reason.contains("ya no existe"));
        assert!(!gone.exists());
        assert_eq!(projects::load(&base).projects.len(), 1);
    }

    #[test]
    fn the_shapes_travel_in_camel_case_without_secrets() {
        let root = temp_root("shapes");
        let places = places(&root);
        let base = root.join("base");
        let alpha = folder(&root, "alpha", &[".git"]);
        transcript_in(&places, &text_of(&alpha));
        put(&places.home.join(".cursor").join("mcp.json"), r#"{ "mcpServers": { "context7": { "url": "https://mcp.context7.com/mcp", "headers": { "CONTEXT7_API_KEY": "clave-secreta" } } } }"#);

        let found = serde_json::to_value(scan(&base, &places)).unwrap();
        let adopted = serde_json::to_value(adopt(&base, &places, &[text_of(&alpha), text_of(&root.join("nada"))], |_, _| {})).unwrap();
        let imported = serde_json::to_value(import_servers(&base, &places, &["cursor:context7".into(), "cursor:otro".into()], &[text_of(&alpha)])).unwrap();
        println!("{}\n{}\n{}", serde_json::to_string_pretty(&found).unwrap(), adopted, imported);

        let keys = |value: &Value| {
            let mut named: Vec<String> = value.as_object().unwrap().keys().cloned().collect();
            named.sort();
            named
        };
        assert_eq!(keys(&found), vec!["claude", "foreign", "plugins", "projects", "servers", "skills"]);
        assert_eq!(keys(&found["projects"][0]), vec!["already", "exists", "last", "name", "root", "sessions", "suggested"]);
        assert_eq!(keys(&found["foreign"][0]), vec!["app", "args", "blocked", "command", "envKeys", "id", "kind", "name", "source", "url"]);
        assert_eq!(found["foreign"][0]["envKeys"], json!(["CONTEXT7_API_KEY"]));
        assert!(!found.to_string().contains("clave-secreta"));
        assert_eq!(keys(&adopted), vec!["projects", "sessions", "skipped"]);
        assert_eq!(keys(&adopted["skipped"][0]), vec!["reason", "root"]);
        assert_eq!(keys(&imported), vec!["added", "skipped"]);
        assert_eq!(keys(&imported["skipped"][0]), vec!["name", "reason"]);
    }

    #[test]
    fn comments_and_trailing_commas_do_not_hide_a_config() {
        let cleaned = lenient("{ \"a\": \"// no\", // sí\n \"b\": [1, 2,], /* fin */ }");
        assert_eq!(cleaned, "{ \"a\": \"// no\", \n \"b\": [1, 2]}");
        assert_eq!(serde_json::from_str::<Value>(&cleaned).unwrap()["b"][1], 2);
        assert_eq!(lenient(r#"{ "c": "comilla \" y , }" }"#), r#"{ "c": "comilla \" y , }" }"#);
    }

    #[test]
    fn a_lowercase_drive_letter_names_the_same_folder() {
        assert_eq!(folder_key("c:\\Users\\sofia\\app"), "C:\\Users\\sofia\\app");
        assert_eq!(folder_key("C:\\x"), "C:\\x");
        assert_eq!(folder_key("/home/sofia"), "/home/sofia");
        assert!(same_folder("C:\\Users\\Sofia\\AppData\\Local\\Sens\\", Path::new("c:/users/sofia/appdata/local/sens")));
        assert!(!same_folder("C:\\x", Path::new("")));
    }

    #[test]
    fn a_session_adopted_here_reads_back_whole() {
        let root = temp_root("whole");
        let places = places(&root);
        let alpha = folder(&root, "alpha", &[]);
        let (id, _) = transcript_in(&places, &text_of(&alpha));

        adopt(&root.join("base"), &places, &[text_of(&alpha)], |_, _| {});

        let entries = session::read(&alpha, &id);
        assert!(matches!(&entries[0], Entry::Opened { root, .. } if *root == text_of(&alpha)));
        assert!(matches!(&entries[1], Entry::Task { text, .. } if text == "Hola"));
        assert_eq!(entries.len(), 5);
    }

    #[test]
    #[ignore]
    fn the_real_folders_are_scanned_without_writing_anything() {
        let places = Places::current().unwrap();
        let base = places.appdata.join("dev.sens.desktop");
        let started = std::time::Instant::now();
        let found = scan(&base, &places);
        let took = started.elapsed();

        let sessions: usize = found.projects.iter().map(|project| project.sessions).sum();
        let already: usize = found.projects.iter().map(|project| project.already).sum();
        println!("scan: {took:?}");
        println!("{} sesiones en {} proyectos, {already} ya en Sens", sessions, found.projects.len());
        for project in &found.projects {
            println!(
                "  {:<40} sesiones {:>3} ya {:>3} existe {:<5} sugerido {}",
                project.name, project.sessions, project.already, project.exists, project.suggested
            );
        }
        println!("skills {} · servidores {} · plugins {}", found.skills.len(), found.servers.len(), found.plugins.len());
        for server in &found.foreign {
            println!("  ajeno {} [{}] {}", server.id, server.kind, if server.blocked.is_empty() { "se puede traer" } else { server.blocked.as_str() });
        }

        let started = std::time::Instant::now();
        let (mut read, mut adoptable, mut turns, mut entries, mut begun) = (0, 0, 0, 0, 0);
        for held in held(&base, &places) {
            let Some(found) = transcript::read(&held.path) else { continue };
            let asked = found.entries.iter().filter(|entry| matches!(entry, Entry::Task { .. })).count();
            read += 1;
            adoptable += usize::from(asked > 0);
            turns += asked;
            entries += found.entries.len();
            begun += usize::from(found.entries.iter().any(|entry| matches!(entry, Entry::Agent { event: sens_agent::chat::Event::Started { .. }, .. })));
        }
        println!("lectura: {read} transcripts, {adoptable} con turnos, {begun} con Started, {turns} turnos, {entries} entradas en {:?}", started.elapsed());
    }
}
