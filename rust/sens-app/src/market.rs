use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use sens_agent::{said, session};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::capabilities::{self, COMPONENT_KEYS, Provenance, Remote};
use crate::snapshot::{self, FileRow, Origin};
use crate::store;
use crate::web;

const CATALOGS: [&str; 2] = ["market", "catalogs"];
const FRESH_MILLIS: u64 = 24 * 60 * 60 * 1000;
const MARKETPLACE: &str = ".claude-plugin/marketplace.json";
const SKILL_FILE: &str = "SKILL.md";
const SKILLS_REPO: &str = "anthropics/skills";
const LOCKED_SKILLS: [&str; 4] = ["docx", "pdf", "pptx", "xlsx"];
const LOCKED_PLUGINS: [&str; 1] = ["document-skills"];
const CONNECTORS_URL: &str = "https://api.anthropic.com/mcp-registry/v0/servers";
const CONNECTOR_META: &str = "com.anthropic.api/mcp-registry";
const REGISTRY_META: &str = "io.modelcontextprotocol.registry/official";
const CONNECTOR_PAGES: usize = 20;
const SEARCH_URL: &str = "https://skills.sh/api/search";
const DOWNLOAD_URL: &str = "https://skills.sh/api/download";
const SEARCH_LIMIT: &str = "50";
const SKILLS_SH: &str = "skills.sh";
const SEEN_FILE: &str = "skills-sh.json";
const HOST_VARIABLES: [&str; 3] = ["CLAUDE_PLUGIN_ROOT", "CLAUDE_PLUGIN_DATA", "CLAUDE_PROJECT_DIR"];
const METADATA_KEYS: [&str; 7] = ["description", "version", "author", "homepage", "repository", "license", "keywords"];
const LICENSE_CAP: usize = 80;

fn login_needed() -> String {
    said!(
        en: "this connector asks you to sign in, and Sens can’t do that for you yet",
        es: "este conector pide iniciar sesión y Sens aún no puede hacerlo por ti",
        fr: "ce connecteur demande de se connecter, et Sens ne peut pas encore le faire pour vous",
        de: "dieser Connector verlangt eine Anmeldung, und das kann Sens noch nicht für dich erledigen",
        ja: "このコネクタはサインインが必要ですが、Sens はまだ代わりにサインインできません",
        zh: "此连接器需要登录，而 Sens 目前还无法替你登录",
    )
}

fn fallen() -> String {
    said!(
        en: "the request failed",
        es: "la consulta se cayó",
        fr: "la requête a échoué",
        de: "die Abfrage ist fehlgeschlagen",
        ja: "リクエストが異常終了しました",
        zh: "请求意外中断",
    )
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum Badge {
    Anthropic,
    Partner,
    Community,
    SkillsSh,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Plugin,
    Skill,
    Connector,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub id: String,
    pub kind: Kind,
    pub name: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub badge: Badge,
    pub source: String,
    pub category: String,
    pub version: String,
    pub homepage: String,
    pub installs: Option<u64>,
    pub login: bool,
    pub tools: Vec<String>,
    pub installable: bool,
    pub revision: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Item {
    listing: Listing,
    entry: Value,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Cached {
    fetched_at: u64,
    repo: String,
    sha: String,
    items: Vec<Item>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceState {
    pub id: &'static str,
    pub fetched_at: u64,
    pub error: String,
}

#[derive(Serialize)]
pub struct Market {
    pub listings: Vec<Listing>,
    pub sources: Vec<SourceState>,
}

#[derive(Serialize, Default, Debug, PartialEq)]
pub struct Part {
    pub name: String,
    pub path: String,
    pub description: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Hook {
    pub event: String,
    pub command: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Launcher {
    pub name: String,
    pub launch: String,
}

#[derive(Serialize, Default, Debug, PartialEq)]
pub struct Parts {
    pub skills: Vec<Part>,
    pub commands: Vec<Part>,
    pub agents: Vec<Part>,
    pub hooks: Vec<Hook>,
    pub servers: Vec<Launcher>,
    pub lsp: Vec<String>,
    pub bin: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Need {
    pub name: String,
    pub description: String,
    pub secret: bool,
    pub required: bool,
    pub default: String,
}

#[derive(Serialize)]
pub struct Detail {
    pub listing: Listing,
    pub readme: String,
    pub license: String,
    pub files: Vec<FileRow>,
    pub parts: Parts,
    pub needs: Vec<Need>,
}

#[derive(Clone, Copy)]
enum Feed {
    Plugins { repo: &'static str, badge: Badge, official: bool },
    Skills,
    Connectors,
}

struct Source {
    id: &'static str,
    feed: Feed,
}

const SOURCES: [Source; 7] = [
    Source {
        id: "official",
        feed: Feed::Plugins { repo: "anthropics/claude-plugins-official", badge: Badge::Partner, official: true },
    },
    Source {
        id: "knowledge-work",
        feed: Feed::Plugins { repo: "anthropics/knowledge-work-plugins", badge: Badge::Anthropic, official: false },
    },
    Source {
        id: "financial-services",
        feed: Feed::Plugins { repo: "anthropics/financial-services-plugins", badge: Badge::Anthropic, official: false },
    },
    Source {
        id: "life-sciences",
        feed: Feed::Plugins { repo: "anthropics/life-sciences", badge: Badge::Anthropic, official: false },
    },
    Source {
        id: "community",
        feed: Feed::Plugins { repo: "anthropics/claude-plugins-community", badge: Badge::Community, official: false },
    },
    Source { id: "skills", feed: Feed::Skills },
    Source { id: "connectors", feed: Feed::Connectors },
];

fn catalogs(base: &Path) -> PathBuf {
    CATALOGS.iter().fold(base.to_path_buf(), |path, part| path.join(part))
}

fn cached(base: &Path, source: &str) -> Cached {
    store::stored(&catalogs(base).join(format!("{source}.json")))
}

fn text_of<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().map(str::trim).unwrap_or_default()
}

fn author_of(entry: &Value) -> String {
    match &entry["author"] {
        Value::String(name) => name.trim().to_string(),
        author => text_of(author, "name").to_string(),
    }
}

fn raw(repo: &str, sha: &str, path: &str) -> String {
    format!("https://raw.githubusercontent.com/{repo}/{sha}/{path}")
}

pub fn market(base: &Path, refresh: bool) -> Market {
    let now = session::now();
    let gathered: Vec<(Cached, String)> = std::thread::scope(|scope| {
        let asked: Vec<_> = SOURCES
            .iter()
            .map(|source| scope.spawn(move || gather(base, source, refresh, now)))
            .collect();
        asked
            .into_iter()
            .map(|answer| answer.join().unwrap_or_else(|_| (Cached::default(), fallen())))
            .collect()
    });

    let mut listings: Vec<Listing> = gathered.iter().flat_map(|(kept, _)| kept.items.iter().map(|item| item.listing.clone())).collect();
    listings.sort_by_key(|a| (a.badge, a.title.to_lowercase()));
    let sources = SOURCES
        .iter()
        .zip(gathered)
        .map(|(source, (kept, error))| SourceState { id: source.id, fetched_at: kept.fetched_at, error })
        .collect();
    Market { listings, sources }
}

fn gather(base: &Path, source: &Source, refresh: bool, now: u64) -> (Cached, String) {
    let kept = cached(base, source.id);
    let fresh = kept.fetched_at > 0 && now.saturating_sub(kept.fetched_at) < FRESH_MILLIS;
    if fresh && !refresh {
        return (kept, String::new());
    }
    let fetched = match source.feed {
        Feed::Plugins { repo, badge, official } => fetch_plugins(source.id, repo, badge, official),
        Feed::Skills => fetch_skills(),
        Feed::Connectors => fetch_connectors(),
    };
    match fetched.and_then(|mut found| {
        found.fetched_at = now;
        store::store(&catalogs(base), &format!("{}.json", source.id), &found)?;
        Ok(found)
    }) {
        Ok(found) => (found, String::new()),
        Err(reason) => (kept, reason),
    }
}

fn fetch_plugins(source: &str, repo: &str, badge: Badge, official: bool) -> Result<Cached, String> {
    let sha = web::revision(repo, "")?;
    let marketplace = web::json(&raw(repo, &sha, MARKETPLACE), &[])?;
    let catalog = Origin { repo: repo.to_string(), sha: sha.clone(), path: String::new() };
    let items = marketplace["plugins"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| plugin_item(source, entry, &catalog, badge, official))
        .collect();
    Ok(Cached { fetched_at: 0, repo: repo.to_string(), sha, items })
}

fn plugin_item(source: &str, entry: &Value, catalog: &Origin, badge: Badge, official: bool) -> Option<Item> {
    let name = text_of(entry, "name");
    if name.is_empty() || LOCKED_PLUGINS.contains(&name) {
        return None;
    }
    let author = author_of(entry);
    let reachable = snapshot::wanted(&entry["source"], catalog).is_ok();
    let own = entry["source"].as_str().is_some_and(|path| path.trim_start_matches("./").starts_with("plugins/"));
    let badge = match official {
        true if own && author == "Anthropic" => Badge::Anthropic,
        true => Badge::Partner,
        false => badge,
    };
    let version = text_of(entry, "version").to_string();
    let pinned = text_of(&entry["source"], "sha");
    let revision = [pinned, version.as_str(), catalog.sha.as_str()].into_iter().find(|value| !value.is_empty()).unwrap_or_default().to_string();
    let homepage = [text_of(entry, "homepage"), text_of(entry, "repository")].into_iter().find(|value| !value.is_empty()).unwrap_or_default();
    let title = [text_of(entry, "displayName"), name].into_iter().find(|value| !value.is_empty()).unwrap_or(name);
    Some(Item {
        listing: Listing {
            id: format!("{source}:{name}"),
            kind: Kind::Plugin,
            name: name.to_string(),
            title: title.to_string(),
            description: text_of(entry, "description").to_string(),
            author,
            badge,
            source: source.to_string(),
            category: text_of(entry, "category").to_string(),
            version,
            homepage: homepage.to_string(),
            installs: None,
            login: false,
            tools: Vec::new(),
            installable: reachable && capabilities::is_plugin_name(name),
            revision,
        },
        entry: entry.clone(),
    })
}

fn skill_paths(marketplace: &Value) -> BTreeSet<String> {
    marketplace["plugins"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|plugin| !LOCKED_PLUGINS.contains(&text_of(plugin, "name")))
        .flat_map(|plugin| plugin["skills"].as_array().cloned().unwrap_or_default())
        .filter_map(|path| snapshot::inner_path(path.as_str()?).ok())
        .filter(|path| !path.is_empty() && !is_locked_skill(path.rsplit('/').next().unwrap_or(path)))
        .collect()
}

fn is_locked_skill(name: &str) -> bool {
    LOCKED_SKILLS.contains(&name)
}

fn fetch_skills() -> Result<Cached, String> {
    let sha = web::revision(SKILLS_REPO, "")?;
    let marketplace = web::json(&raw(SKILLS_REPO, &sha, MARKETPLACE), &[])?;
    let paths = skill_paths(&marketplace);
    let read: Vec<Result<Item, String>> = std::thread::scope(|scope| {
        let asked: Vec<_> = paths
            .iter()
            .map(|path| {
                let sha = sha.as_str();
                scope.spawn(move || {
                    let text = web::text(&raw(SKILLS_REPO, sha, &format!("{path}/{SKILL_FILE}")), web::MEGABYTE)?;
                    skill_item(path, &text, sha).ok_or_else(|| {
                        said!(
                            en: "{path} has no valid header",
                            es: "{path} no tiene cabecera válida",
                            fr: "{path} n’a pas d’en-tête valide",
                            de: "{path} hat keinen gültigen Kopf",
                            ja: "{path} に有効なヘッダーがありません",
                            zh: "{path} 没有有效的头部",
                        )
                    })
                })
            })
            .collect();
        asked.into_iter().map(|answer| answer.join().unwrap_or_else(|_| Err(fallen()))).collect()
    });
    let items: Vec<Item> = read.iter().filter_map(|found| found.as_ref().ok().cloned()).collect();
    if items.is_empty() {
        let reason = read.into_iter().find_map(Result::err).unwrap_or_else(|| {
            said!(
                en: "no skills found",
                es: "no encontré skills",
                fr: "aucune skill trouvée",
                de: "keine Skills gefunden",
                ja: "スキルが見つかりませんでした",
                zh: "没有找到技能",
            )
        });
        return Err(reason);
    }
    Ok(Cached { fetched_at: 0, repo: SKILLS_REPO.into(), sha, items })
}

fn skill_item(path: &str, text: &str, sha: &str) -> Option<Item> {
    let header = capabilities::header(text)?;
    if is_locked_skill(&header.name) {
        return None;
    }
    Some(Item {
        listing: Listing {
            id: format!("skills:{}", header.name),
            kind: Kind::Skill,
            title: header.name.clone(),
            installable: capabilities::is_skill_name(&header.name),
            name: header.name,
            description: header.description,
            author: "Anthropic".into(),
            badge: Badge::Anthropic,
            source: "skills".into(),
            category: String::new(),
            version: String::new(),
            homepage: format!("https://github.com/{SKILLS_REPO}/tree/main/{path}"),
            installs: None,
            login: false,
            tools: Vec::new(),
            revision: sha.to_string(),
        },
        entry: json!({ "path": path }),
    })
}

fn fetch_connectors() -> Result<Cached, String> {
    let mut items: Vec<Item> = Vec::new();
    let mut cursor = String::new();
    for _ in 0..CONNECTOR_PAGES {
        let mut query = vec![("visibility", "commercial"), ("limit", "100")];
        if !cursor.is_empty() {
            query.push(("cursor", cursor.as_str()));
        }
        let page = web::json(CONNECTORS_URL, &query)?;
        for item in page["servers"].as_array().into_iter().flatten().filter_map(connector_item) {
            if !items.iter().any(|kept| kept.listing.id == item.listing.id) {
                items.push(item);
            }
        }
        cursor = text_of(&page["metadata"], "nextCursor").to_string();
        if cursor.is_empty() {
            break;
        }
    }
    if items.is_empty() {
        return Err(said!(
            en: "Anthropic returned no connectors",
            es: "Anthropic no devolvió conectores",
            fr: "Anthropic n’a renvoyé aucun connecteur",
            de: "Anthropic hat keine Connectors geliefert",
            ja: "Anthropic からコネクタが返されませんでした",
            zh: "Anthropic 没有返回任何连接器",
        ));
    }
    Ok(Cached { fetched_at: 0, repo: String::new(), sha: String::new(), items })
}

pub fn slug(title: &str) -> String {
    let mut out = String::new();
    for letter in title.to_lowercase().chars() {
        let plain = match letter {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            other => other,
        };
        if plain.is_ascii_alphanumeric() {
            out.push(plain);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_end_matches('-').chars().take(64).collect()
}

fn remote_of(server: &Value) -> Option<&Value> {
    server["remotes"]
        .as_array()?
        .iter()
        .find(|remote| ["streamable-http", "http", "sse"].contains(&text_of(remote, "type")) && !text_of(remote, "url").is_empty())
}

fn connector_item(item: &Value) -> Option<Item> {
    let server = &item["server"];
    let registry = &item["_meta"][REGISTRY_META];
    if registry["isLatest"] == false || registry["status"].as_str().is_some_and(|status| status != "active") {
        return None;
    }
    let meta = &item["_meta"][CONNECTOR_META];
    let id = text_of(server, "name");
    let title = [text_of(server, "title"), id].into_iter().find(|value| !value.is_empty())?;
    let name = slug(title);
    let remote = remote_of(server);
    let login = meta["isAuthless"] != true;
    let description = [text_of(meta, "oneLiner"), text_of(server, "description")].into_iter().find(|value| !value.is_empty()).unwrap_or_default();
    let homepage = [text_of(meta, "documentation"), text_of(meta, "directoryUrl"), text_of(server, "websiteUrl")]
        .into_iter()
        .find(|value| !value.is_empty())
        .unwrap_or_default();
    Some(Item {
        listing: Listing {
            id: format!("connectors:{id}"),
            kind: Kind::Connector,
            installable: remote.is_some() && capabilities::is_server_name(&name) && !login,
            name,
            title: title.to_string(),
            description: description.to_string(),
            author: remote.map(|remote| web::host(text_of(remote, "url")).to_string()).unwrap_or_default(),
            badge: Badge::Partner,
            source: "connectors".into(),
            category: String::new(),
            version: text_of(server, "version").to_string(),
            homepage: homepage.to_string(),
            installs: None,
            login,
            tools: meta["toolNames"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect(),
            revision: text_of(server, "version").to_string(),
        },
        entry: item.clone(),
    })
}

fn seen_lock() -> &'static Mutex<()> {
    static SEEN: OnceLock<Mutex<()>> = OnceLock::new();
    SEEN.get_or_init(Mutex::default)
}

fn seen(base: &Path) -> BTreeMap<String, Listing> {
    store::stored(&catalogs(base).join(SEEN_FILE))
}

pub fn search(base: &Path, query: &str) -> Result<Vec<Listing>, String> {
    let query = query.trim();
    if query.chars().count() < 2 {
        return Ok(Vec::new());
    }
    let page = web::json(SEARCH_URL, &[("q", query), ("limit", SEARCH_LIMIT)])?;
    let found = searched(&page);
    let _held = seen_lock().lock();
    let mut kept = seen(base);
    for listing in &found {
        kept.insert(listing.id.clone(), listing.clone());
    }
    store::store(&catalogs(base), SEEN_FILE, &kept)?;
    Ok(found)
}

fn searched(page: &Value) -> Vec<Listing> {
    page["skills"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let id = text_of(entry, "id");
            let repo = text_of(entry, "source");
            let slug = text_of(entry, "skillId");
            let name = [text_of(entry, "name"), slug].into_iter().find(|value| !value.is_empty())?;
            if id.split('/').count() != 3 || repo == SKILLS_REPO || repo.is_empty() {
                return None;
            }
            Some(Listing {
                id: format!("{SKILLS_SH}:{id}"),
                kind: Kind::Skill,
                name: name.to_string(),
                title: name.to_string(),
                description: String::new(),
                author: repo.split('/').next().unwrap_or(repo).to_string(),
                badge: Badge::SkillsSh,
                source: SKILLS_SH.into(),
                category: repo.to_string(),
                version: String::new(),
                homepage: format!("https://skills.sh/{id}"),
                installs: entry["installs"].as_u64(),
                login: false,
                tools: Vec::new(),
                installable: true,
                revision: String::new(),
            })
        })
        .collect()
}

struct Found {
    item: Item,
    repo: String,
    sha: String,
}

fn find(base: &Path, id: &str) -> Result<Found, String> {
    let missing = || {
        said!(
            en: "can’t find {id} in the catalog; refresh it",
            es: "no encuentro {id} en el catálogo; actualízalo",
            fr: "{id} est introuvable dans le catalogue ; actualisez-le",
            de: "{id} ist nicht im Katalog; aktualisiere ihn",
            ja: "カタログに {id} が見つかりません。カタログを更新してください",
            zh: "目录中找不到 {id}；请刷新目录",
        )
    };
    if id.starts_with(&format!("{SKILLS_SH}:")) {
        let listing = seen(base).remove(id).ok_or_else(missing)?;
        return Ok(Found { item: Item { listing, entry: Value::Null }, repo: String::new(), sha: String::new() });
    }
    let (source, _) = id.split_once(':').ok_or_else(missing)?;
    let kept = cached(base, source);
    let item = kept.items.into_iter().find(|item| item.listing.id == id).ok_or_else(missing)?;
    Ok(Found { item, repo: kept.repo, sha: kept.sha })
}

struct Located {
    root: PathBuf,
    definition: Option<Value>,
    revision: String,
}

fn locate(base: &Path, found: &Found) -> Result<Located, String> {
    let listing = &found.item.listing;
    match listing.kind {
        Kind::Plugin => {
            let catalog = Origin { repo: found.repo.clone(), sha: found.sha.clone(), path: String::new() };
            let wanted = snapshot::wanted(&found.item.entry["source"], &catalog)?;
            let (root, revision) = match wanted.repo == found.repo && wanted.reference == found.sha {
                true => (inside(snapshot::ensure(base, &catalog)?, &wanted.path)?, found.sha.clone()),
                false => {
                    let origin = snapshot::pin(&wanted)?;
                    (snapshot::ensure(base, &origin)?, origin.sha)
                }
            };
            let definition = needs_definition(&found.item.entry, &root).then(|| definition_of(&found.item.entry));
            Ok(Located { root, definition, revision })
        }
        Kind::Skill if listing.source == SKILLS_SH => {
            let (owner_repo, slug) = listing.id.trim_start_matches(&format!("{SKILLS_SH}:")).rsplit_once('/').ok_or_else(|| {
                said!(
                    en: "unexpected skills.sh ID",
                    es: "id de skills.sh raro",
                    fr: "identifiant skills.sh inattendu",
                    de: "unerwartete skills.sh-ID",
                    ja: "skills.sh の ID が不正です",
                    zh: "skills.sh 的 ID 异常",
                )
            })?;
            let page = web::json(&format!("{DOWNLOAD_URL}/{owner_repo}/{slug}"), &[])?;
            let files: Vec<(String, String)> = page["files"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|file| Some((file["path"].as_str()?.to_string(), file["contents"].as_str()?.to_string())))
                .collect();
            if !files.iter().any(|(path, _)| path == SKILL_FILE) {
                return Err(said!(
                    en: "skills.sh didn’t return the {SKILL_FILE} of {name}",
                    es: "skills.sh no devolvió el {SKILL_FILE} de {name}",
                    fr: "skills.sh n’a pas renvoyé le {SKILL_FILE} de {name}",
                    de: "skills.sh hat die {SKILL_FILE} von {name} nicht geliefert",
                    ja: "skills.sh から {name} の {SKILL_FILE} が返されませんでした",
                    zh: "skills.sh 没有返回 {name} 的 {SKILL_FILE}",
                    name = listing.name,
                ));
            }
            let root = snapshot::ensure_files(base, &listing.id, &files)?;
            let revision = root.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
            Ok(Located { root, definition: None, revision })
        }
        Kind::Skill => {
            let catalog = Origin { repo: found.repo.clone(), sha: found.sha.clone(), path: String::new() };
            let root = inside(snapshot::ensure(base, &catalog)?, text_of(&found.item.entry, "path"))?;
            Ok(Located { root, definition: None, revision: found.sha.clone() })
        }
        Kind::Connector => Err(said!(
            en: "a connector has no files",
            es: "un conector no tiene ficheros",
            fr: "un connecteur n’a pas de fichiers",
            de: "ein Connector hat keine Dateien",
            ja: "コネクタにはファイルがありません",
            zh: "连接器没有文件",
        )),
    }
}

fn inside(folder: PathBuf, path: &str) -> Result<PathBuf, String> {
    let root = folder.join(snapshot::inner_path(path)?);
    match root.is_dir() {
        true => Ok(root),
        false => Err(snapshot::not_in_repository(path)),
    }
}

fn needs_definition(entry: &Value, root: &Path) -> bool {
    entry["strict"] == false || capabilities::manifest(root).is_none()
}

fn definition_of(entry: &Value) -> Value {
    let mut made = serde_json::Map::new();
    made.insert("name".into(), entry["name"].clone());
    for key in METADATA_KEYS.iter().chain(COMPONENT_KEYS.iter()) {
        if let Some(value) = entry.get(*key).filter(|value| !value.is_null()) {
            made.insert(key.to_string(), value.clone());
        }
    }
    Value::Object(made)
}

pub fn detail(base: &Path, id: &str) -> Result<Detail, String> {
    let found = find(base, id)?;
    let listing = found.item.listing.clone();
    if listing.kind == Kind::Connector {
        return Ok(connector_detail(&found.item));
    }
    let located = locate(base, &found)?;
    let manifest = located.definition.clone().or_else(|| capabilities::manifest(&located.root)).unwrap_or(Value::Null);
    let parts = match listing.kind {
        Kind::Skill => Parts { skills: skill_part(&located.root, "").into_iter().collect(), ..Parts::default() },
        _ => parts_of(&located.root, &manifest),
    };
    let needs = match listing.kind {
        Kind::Plugin => server_needs(&servers_of(&located.root, &manifest)),
        _ => Vec::new(),
    };
    Ok(Detail {
        readme: readme_of(&located.root, &listing),
        license: license_of(&located.root, &manifest),
        files: snapshot::files(&located.root),
        parts,
        needs,
        listing,
    })
}

pub fn file(base: &Path, id: &str, path: &str) -> Result<String, String> {
    let found = find(base, id)?;
    snapshot::read(&locate(base, &found)?.root, path)
}

fn connector_detail(item: &Item) -> Detail {
    let remote = remote_of(&item.entry["server"]);
    let url = remote.map(|remote| text_of(remote, "url").to_string()).unwrap_or_default();
    let listing = item.listing.clone();
    let mut readme = listing.description.clone();
    let long = text_of(&item.entry["server"], "description");
    if !long.is_empty() && long != readme {
        readme = format!("{readme}\n\n{long}");
    }
    Detail {
        readme,
        license: String::new(),
        files: Vec::new(),
        parts: Parts { servers: vec![Launcher { name: listing.name.clone(), launch: url }], ..Parts::default() },
        needs: remote.map(remote_needs).unwrap_or_default(),
        listing,
    }
}

fn skill_part(root: &Path, relative: &str) -> Option<Part> {
    let path = [relative, SKILL_FILE].into_iter().filter(|part| !part.is_empty()).collect::<Vec<_>>().join("/");
    let text = std::fs::read_to_string(root.join(&path)).ok()?;
    let header = capabilities::front_matter(&text).unwrap_or_default();
    let folder = Path::new(relative).file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    Some(Part {
        name: header.get("name").cloned().filter(|name| !name.is_empty()).unwrap_or(folder),
        description: header.get("description").cloned().unwrap_or_default(),
        path,
    })
}

fn listed_paths(value: &Value) -> Vec<String> {
    match value {
        Value::String(path) => vec![path.clone()],
        Value::Array(paths) => paths.iter().filter_map(Value::as_str).map(str::to_string).collect(),
        _ => Vec::new(),
    }
    .into_iter()
    .filter_map(|path| snapshot::inner_path(&path).ok())
    .collect()
}

fn child_dirs(root: &Path, relative: &str) -> Vec<String> {
    let mut found: Vec<String> = std::fs::read_dir(root.join(relative))
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| join(relative, &entry.file_name().to_string_lossy()))
        .collect();
    found.sort();
    found
}

fn child_files(root: &Path, relative: &str, extension: &str) -> Vec<String> {
    let mut found: Vec<String> = std::fs::read_dir(root.join(relative))
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| extension.is_empty() || name.ends_with(extension))
        .map(|name| join(relative, &name))
        .collect();
    found.sort();
    found
}

fn join(folder: &str, name: &str) -> String {
    match folder.is_empty() {
        true => name.to_string(),
        false => format!("{folder}/{name}"),
    }
}

fn parts_of(root: &Path, manifest: &Value) -> Parts {
    let mut skill_roots = vec!["skills".to_string()];
    skill_roots.extend(listed_paths(&manifest["skills"]));
    let mut skills: Vec<Part> = Vec::new();
    for folder in skill_roots {
        let candidates = match root.join(&folder).join(SKILL_FILE).is_file() {
            true => vec![folder],
            false => child_dirs(root, &folder),
        };
        for candidate in candidates {
            if let Some(part) = skill_part(root, &candidate).filter(|part| !skills.iter().any(|kept| kept.path == part.path)) {
                skills.push(part);
            }
        }
    }
    Parts {
        skills,
        commands: markdown_parts(root, &manifest["commands"], "commands"),
        agents: markdown_parts(root, &manifest["agents"], "agents"),
        hooks: hooks_of(root, manifest),
        servers: servers_of(root, manifest)
            .into_iter()
            .map(|(name, config)| Launcher { launch: launch_line(&config), name })
            .collect(),
        lsp: config_of(root, &manifest["lspServers"], ".lsp.json", "lspServers").keys().cloned().collect(),
        bin: child_files(root, "bin", ""),
    }
}

fn markdown_parts(root: &Path, declared: &Value, default: &str) -> Vec<Part> {
    let places = match declared.is_null() {
        true => vec![default.to_string()],
        false => listed_paths(declared),
    };
    places
        .iter()
        .flat_map(|place| match place.ends_with(".md") {
            true => vec![place.clone()],
            false => child_files(root, place, ".md"),
        })
        .filter_map(|path| {
            let text = std::fs::read_to_string(root.join(&path)).ok()?;
            let header = capabilities::front_matter(&text).unwrap_or_default();
            let stem = Path::new(&path).file_stem()?.to_string_lossy().into_owned();
            Some(Part {
                name: header.get("name").cloned().filter(|name| !name.is_empty()).unwrap_or(stem),
                description: header.get("description").cloned().unwrap_or_default(),
                path,
            })
        })
        .collect()
}

fn json_file(root: &Path, relative: &str) -> Value {
    std::fs::read_to_string(root.join(relative))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(Value::Null)
}

fn config_of(root: &Path, declared: &Value, default: &str, wrapper: &str) -> BTreeMap<String, Value> {
    let found = match declared {
        Value::Object(_) => declared.clone(),
        Value::String(path) => snapshot::inner_path(path).map(|path| json_file(root, &path)).unwrap_or(Value::Null),
        _ => json_file(root, default),
    };
    let inner = match found.get(wrapper) {
        Some(Value::Object(_)) => found[wrapper].clone(),
        _ => found,
    };
    inner.as_object().map(|map| map.iter().map(|(key, value)| (key.clone(), value.clone())).collect()).unwrap_or_default()
}

fn servers_of(root: &Path, manifest: &Value) -> BTreeMap<String, Value> {
    config_of(root, &manifest["mcpServers"], ".mcp.json", "mcpServers")
}

fn launch_line(config: &Value) -> String {
    let url = text_of(config, "url");
    if !url.is_empty() {
        return url.to_string();
    }
    let args = config["args"].as_array().into_iter().flatten().filter_map(Value::as_str);
    std::iter::once(text_of(config, "command")).chain(args).filter(|part| !part.is_empty()).collect::<Vec<_>>().join(" ")
}

fn hooks_of(root: &Path, manifest: &Value) -> Vec<Hook> {
    let declared = config_of(root, &manifest["hooks"], "hooks/hooks.json", "hooks");
    let mut found = Vec::new();
    for (event, groups) in declared {
        for group in groups.as_array().into_iter().flatten() {
            for hook in group["hooks"].as_array().into_iter().flatten() {
                let command = match text_of(hook, "type") {
                    "command" => text_of(hook, "command").to_string(),
                    other => format!("({other})"),
                };
                found.push(Hook { event: event.clone(), command });
            }
        }
    }
    found
}

fn placeholders(text: &str) -> Vec<(String, Option<String>)> {
    let mut found = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("${") {
        let after = &rest[start + 2..];
        let Some(end) = after.find('}') else { break };
        let inner = &after[..end];
        let (name, default) = match inner.split_once(":-") {
            Some((name, default)) => (name, Some(default.to_string())),
            None => (inner, None),
        };
        let valid = name.chars().next().is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
            && name.chars().all(|letter| letter.is_ascii_alphanumeric() || letter == '_');
        if valid && !HOST_VARIABLES.contains(&name) {
            found.push((name.to_string(), default));
        }
        rest = &after[end + 1..];
    }
    found
}

fn strings_in(value: &Value, into: &mut Vec<String>) {
    match value {
        Value::String(text) => into.push(text.clone()),
        Value::Array(items) => items.iter().for_each(|item| strings_in(item, into)),
        Value::Object(map) => map.values().for_each(|item| strings_in(item, into)),
        _ => {}
    }
}

fn server_needs(servers: &BTreeMap<String, Value>) -> Vec<Need> {
    let mut needs: Vec<Need> = Vec::new();
    for (server, config) in servers {
        let mut texts = Vec::new();
        strings_in(config, &mut texts);
        for (name, default) in texts.iter().flat_map(|text| placeholders(text)) {
            if needs.iter().any(|need| need.name == name) {
                continue;
            }
            let secret = ["TOKEN", "KEY", "SECRET", "PASSWORD"].iter().any(|word| name.to_uppercase().contains(word));
            needs.push(Need {
                description: said!(
                    en: "Used by the server {server}",
                    es: "La usa el servidor {server}",
                    fr: "Utilisée par le serveur {server}",
                    de: "Wird vom Server {server} verwendet",
                    ja: "サーバー {server} が使用します",
                    zh: "由服务器 {server} 使用",
                ),
                required: default.is_none(),
                default: default.unwrap_or_default(),
                secret,
                name,
            });
        }
    }
    needs.sort_by_key(|need| !need.required);
    needs
}

fn braced(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find('{') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('}') else { break };
        let name = &after[..end];
        if !name.is_empty() && name.chars().all(|letter| letter.is_ascii_alphanumeric() || letter == '_') {
            found.push(name.to_string());
        }
        rest = &after[end + 1..];
    }
    found
}

fn remote_needs(remote: &Value) -> Vec<Need> {
    let mut needs: Vec<Need> = Vec::new();
    let mut add = |need: Need| {
        if !needs.iter().any(|kept| kept.name == need.name) {
            needs.push(need);
        }
    };
    if let Some(variables) = remote["variables"].as_object() {
        for (name, spec) in variables {
            add(Need {
                name: name.clone(),
                description: text_of(spec, "description").to_string(),
                secret: spec["isSecret"] == true,
                required: spec["isRequired"] == true,
                default: text_of(spec, "default").to_string(),
            });
        }
    }
    for header in remote["headers"].as_array().into_iter().flatten() {
        let template = text_of(header, "value");
        let inside = braced(template);
        let names = match inside.is_empty() {
            true => vec![text_of(header, "name").to_string()],
            false => inside,
        };
        for name in names.into_iter().filter(|name| !name.is_empty()) {
            add(Need {
                name,
                description: text_of(header, "description").to_string(),
                secret: header["isSecret"] == true,
                required: header["isRequired"] == true,
                default: String::new(),
            });
        }
    }
    needs
}

fn fill(template: &str, values: &BTreeMap<String, String>) -> String {
    values.iter().fold(template.to_string(), |text, (name, value)| text.replace(&format!("{{{name}}}"), value))
}

fn remote_config(remote: &Value, values: &BTreeMap<String, String>) -> Remote {
    let kind = match text_of(remote, "type") {
        "sse" => "sse",
        _ => "http",
    };
    let headers = remote["headers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|header| {
            let name = text_of(header, "name");
            let template = text_of(header, "value");
            let value = match template.is_empty() {
                true => values.get(name).cloned().unwrap_or_default(),
                false => fill(template, values),
            };
            (!name.is_empty() && !value.trim().is_empty() && braced(&value).is_empty()).then(|| (name.to_string(), value))
        })
        .collect();
    Remote { kind: kind.into(), url: fill(text_of(remote, "url"), values), headers }
}

fn vetted(needs: &[Need], values: &BTreeMap<String, String>) -> Result<BTreeMap<String, String>, String> {
    let mut kept = BTreeMap::new();
    for need in needs {
        let value = values.get(&need.name).map(|value| value.trim()).filter(|value| !value.is_empty());
        match (value, need.required) {
            (Some(value), _) => {
                kept.insert(need.name.clone(), value.to_string());
            }
            (None, true) => {
                return Err(said!(
                    en: "{name} is missing",
                    es: "falta {name}",
                    fr: "il manque {name}",
                    de: "{name} fehlt",
                    ja: "{name} が入力されていません",
                    zh: "缺少 {name}",
                    name = need.name,
                ));
            }
            (None, false) => {}
        }
    }
    Ok(kept)
}

fn readme_of(root: &Path, listing: &Listing) -> String {
    let named = |wanted: &[&str]| {
        child_files(root, "", "")
            .into_iter()
            .find(|name| wanted.iter().any(|candidate| name.eq_ignore_ascii_case(candidate)))
            .and_then(|name| std::fs::read_to_string(root.join(name)).ok())
    };
    named(&["README.md", "README.markdown", "README"])
        .or_else(|| named(&[SKILL_FILE]))
        .or_else(|| {
            child_dirs(root, "skills")
                .first()
                .and_then(|folder| std::fs::read_to_string(root.join(folder).join(SKILL_FILE)).ok())
        })
        .unwrap_or_else(|| listing.description.clone())
}

fn license_of(root: &Path, manifest: &Value) -> String {
    let declared = text_of(manifest, "license");
    if !declared.is_empty() {
        return declared.to_string();
    }
    child_files(root, "", "")
        .into_iter()
        .find(|name| {
            let upper = name.to_uppercase();
            upper.starts_with("LICENSE") || upper.starts_with("LICENCE") || upper.starts_with("COPYING")
        })
        .and_then(|name| std::fs::read_to_string(root.join(name)).ok())
        .and_then(|text| text.lines().map(str::trim).find(|line| !line.is_empty()).map(|line| line.chars().take(LICENSE_CAP).collect()))
        .unwrap_or_default()
}

fn provenance(listing: &Listing, revision: String) -> Provenance {
    Provenance { listing: listing.id.clone(), revision, version: listing.version.clone(), installed_at: session::now() }
}

pub fn install(base: &Path, root: &str, id: &str, values: &BTreeMap<String, String>) -> Result<String, String> {
    let found = find(base, id)?;
    let listing = found.item.listing.clone();
    if !listing.installable {
        return Err(match listing.login {
            true => login_needed(),
            false => snapshot::unsupported(),
        });
    }
    match listing.kind {
        Kind::Connector => {
            let remote = remote_of(&found.item.entry["server"]).ok_or_else(|| {
                said!(
                    en: "the connector doesn’t give its address",
                    es: "el conector no dice su dirección",
                    fr: "le connecteur n’indique pas son adresse",
                    de: "der Connector nennt seine Adresse nicht",
                    ja: "コネクタのアドレスが指定されていません",
                    zh: "该连接器没有提供其地址",
                )
            })?;
            let chosen = vetted(&remote_needs(remote), values)?;
            capabilities::add_remote(base, root, &listing.name, remote_config(remote, &chosen))?;
            capabilities::record_server(base, &listing.name, provenance(&listing, listing.revision.clone()))?;
            Ok(listing.name)
        }
        Kind::Skill => {
            let located = locate(base, &found)?;
            let name = capabilities::import_skill(base, root, &located.root)?;
            capabilities::record_skill(base, &name, provenance(&listing, located.revision))?;
            Ok(name)
        }
        Kind::Plugin => {
            let located = locate(base, &found)?;
            let manifest = located.definition.clone().or_else(|| capabilities::manifest(&located.root)).unwrap_or(Value::Null);
            let name = text_of(&manifest, "name").to_string();
            let chosen = vetted(&server_needs(&servers_of(&located.root, &manifest)), values)?;
            capabilities::install_plugin(base, root, &name, &located.root, located.definition.as_ref(), chosen)?;
            capabilities::record_plugin(base, &name, provenance(&listing, located.revision))?;
            Ok(name)
        }
    }
}

pub fn update(base: &Path, id: &str, name: &str) -> Result<(), String> {
    let found = find(base, id)?;
    let listing = found.item.listing.clone();
    match listing.kind {
        Kind::Connector => capabilities::record_server(base, name, provenance(&listing, listing.revision.clone())),
        Kind::Skill => {
            let located = locate(base, &found)?;
            capabilities::replace_skill(base, name, &located.root)?;
            capabilities::record_skill(base, name, provenance(&listing, located.revision))
        }
        Kind::Plugin => {
            let located = locate(base, &found)?;
            capabilities::replace_plugin(base, name, &located.root, located.definition.as_ref())?;
            capabilities::record_plugin(base, name, provenance(&listing, located.revision))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sens_agent::language::{Language, speaking};

    fn temp_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("sens-market-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn put(path: &Path, body: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    fn catalog() -> Origin {
        Origin { repo: "anthropics/claude-plugins-official".into(), sha: "c".repeat(40), path: String::new() }
    }

    fn official(entry: Value) -> Listing {
        plugin_item("official", &entry, &catalog(), Badge::Partner, true).unwrap().listing
    }

    #[test]
    fn only_anthropic_plugins_in_its_own_folder_get_the_anthropic_badge() {
        let own = official(json!({ "name": "code-review", "source": "./plugins/code-review", "author": { "name": "Anthropic" }, "description": "Revisa", "category": "development" }));
        let partner = official(json!({ "name": "linear", "source": { "source": "url", "url": "https://github.com/linear/p.git", "sha": "d".repeat(40) }, "author": { "name": "Linear" } }));
        let vendored = official(json!({ "name": "x", "source": "./external_plugins/x", "author": { "name": "Anthropic" } }));

        assert_eq!((own.badge, own.id.as_str(), own.revision.as_str()), (Badge::Anthropic, "official:code-review", "c".repeat(40).as_str()));
        assert_eq!(own.category, "development");
        assert_eq!((partner.badge, partner.revision.as_str()), (Badge::Partner, "d".repeat(40).as_str()));
        assert_eq!(vendored.badge, Badge::Partner);
        assert!(own.installable && partner.installable);
    }

    #[test]
    fn a_plugin_from_a_source_sens_cannot_fetch_is_listed_but_not_installable() {
        let npm = official(json!({ "name": "npm-only", "source": { "source": "npm", "package": "x" } }));
        assert!(!npm.installable);
        assert!(plugin_item("official", &json!({ "name": "document-skills", "source": "./" }), &catalog(), Badge::Partner, true).is_none());
        assert!(plugin_item("official", &json!({ "source": "./x" }), &catalog(), Badge::Partner, true).is_none());
    }

    #[test]
    fn the_community_catalog_keeps_its_badge_and_pinned_revision() {
        let entry = json!({ "name": "0x", "source": { "source": "url", "url": "https://github.com/0xProject/0x-ai.git", "sha": "e".repeat(40) }, "version": "1.0.0" });
        let listed = plugin_item("community", &entry, &catalog(), Badge::Community, false).unwrap().listing;
        assert_eq!((listed.badge, listed.revision.as_str(), listed.version.as_str()), (Badge::Community, "e".repeat(40).as_str(), "1.0.0"));
    }

    #[test]
    fn the_document_skills_never_show_up() {
        let marketplace = json!({ "plugins": [
            { "name": "document-skills", "skills": ["./skills/xlsx", "./skills/docx", "./skills/pptx", "./skills/pdf"] },
            { "name": "example-skills", "skills": ["./skills/mcp-builder", "./skills/pdf", "./skills/frontend-design"] }
        ]});
        let paths: Vec<String> = skill_paths(&marketplace).into_iter().collect();
        assert_eq!(paths, vec!["skills/frontend-design", "skills/mcp-builder"]);
        assert!(skill_item("skills/x", "---\nname: pdf\ndescription: x\n---\n", "s").is_none());

        let page = json!({ "skills": [
            { "id": "anthropics/skills/pdf", "skillId": "pdf", "name": "pdf", "installs": 200183, "source": "anthropics/skills" },
            { "id": "vercel-labs/json-render/react-pdf", "skillId": "react-pdf", "name": "react-pdf", "installs": 2141, "source": "vercel-labs/json-render" }
        ]});
        let found = searched(&page);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "skills.sh:vercel-labs/json-render/react-pdf");
        assert_eq!((found[0].installs, found[0].author.as_str(), found[0].badge), (Some(2141), "vercel-labs", Badge::SkillsSh));
    }

    #[test]
    fn a_skill_from_anthropic_is_read_from_its_header() {
        let item = skill_item("skills/mcp-builder", "---\nname: mcp-builder\ndescription: Guía para crear servidores MCP\n---\n# x", "s1").unwrap();
        assert_eq!(item.listing.id, "skills:mcp-builder");
        assert_eq!(item.listing.description, "Guía para crear servidores MCP");
        assert_eq!(item.entry["path"], "skills/mcp-builder");
        assert!(item.listing.installable);
    }

    fn connector(authless: bool, remotes: Value) -> Value {
        json!({
            "server": { "name": "ai.tickettailor/mcp", "title": "Ticket Tailor", "description": "Largo", "version": "1.0.0", "remotes": remotes },
            "_meta": {
                "io.modelcontextprotocol.registry/official": { "status": "active", "isLatest": true },
                "com.anthropic.api/mcp-registry": { "isAuthless": authless, "toolNames": ["event_create", "orders_get"], "oneLiner": "Entradas para eventos", "documentation": "https://docs.x" }
            }
        })
    }

    #[test]
    fn a_connector_carries_its_tools_and_says_when_it_needs_a_login() {
        let open = connector_item(&connector(true, json!([{ "type": "streamable-http", "url": "https://mcp.tickettailor.ai/mcp" }]))).unwrap().listing;
        let locked = connector_item(&connector(false, json!([{ "type": "streamable-http", "url": "https://mcp.tickettailor.ai/mcp" }]))).unwrap().listing;
        let nowhere = connector_item(&connector(true, json!([]))).unwrap().listing;

        assert_eq!((open.name.as_str(), open.title.as_str(), open.id.as_str()), ("ticket-tailor", "Ticket Tailor", "connectors:ai.tickettailor/mcp"));
        assert_eq!(open.tools, vec!["event_create", "orders_get"]);
        assert_eq!((open.description.as_str(), open.author.as_str(), open.homepage.as_str()), ("Entradas para eventos", "mcp.tickettailor.ai", "https://docs.x"));
        assert!(open.installable && !open.login);
        assert!(locked.login && !locked.installable);
        assert!(!nowhere.installable);
    }

    #[test]
    fn retired_connector_versions_are_skipped() {
        let mut old = connector(true, json!([{ "type": "sse", "url": "https://x/sse" }]));
        old["_meta"]["io.modelcontextprotocol.registry/official"]["isLatest"] = json!(false);
        assert!(connector_item(&old).is_none());
    }

    #[test]
    fn a_name_for_a_connector_is_a_plain_slug() {
        assert_eq!(slug("Ticket Tailor"), "ticket-tailor");
        assert_eq!(slug("  Atlassian Rovo (beta)!"), "atlassian-rovo-beta");
        assert_eq!(slug("Cañón"), "canon");
    }

    #[test]
    fn remote_values_fill_the_url_and_the_header_templates() {
        let remote = json!({
            "type": "streamable-http",
            "url": "https://{api_host}/mcp",
            "variables": { "api_host": { "isRequired": true, "description": "Tu host" } },
            "headers": [{ "name": "Authorization", "value": "Bearer {api_key}", "isRequired": true, "isSecret": true }]
        });
        let needs = remote_needs(&remote);
        assert_eq!(needs.iter().map(|need| need.name.as_str()).collect::<Vec<_>>(), vec!["api_host", "api_key"]);
        assert!(needs[1].secret);

        let values: BTreeMap<String, String> = [("api_host".to_string(), "eu.x.com".to_string()), ("api_key".to_string(), "k".to_string())].into();
        let made = remote_config(&remote, &vetted(&needs, &values).unwrap());
        assert_eq!((made.kind.as_str(), made.url.as_str()), ("http", "https://eu.x.com/mcp"));
        assert_eq!(made.headers.get("Authorization").map(String::as_str), Some("Bearer k"));
        assert_eq!(vetted(&needs, &BTreeMap::new()).unwrap_err(), "api_host is missing");
        assert_eq!(speaking(Language::Es, || vetted(&needs, &BTreeMap::new())).unwrap_err(), "falta api_host");
        assert_eq!(speaking(Language::Fr, || vetted(&needs, &BTreeMap::new())).unwrap_err(), "il manque api_host");
    }

    #[test]
    fn variables_the_plugin_servers_expect_become_needs() {
        let servers: BTreeMap<String, Value> = [
            ("github".to_string(), json!({ "command": "npx", "args": ["-y", "x", "--root=${CLAUDE_PLUGIN_ROOT}"], "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" } })),
            ("remoto".to_string(), json!({ "type": "http", "url": "https://x/${REGION:-eu}/mcp", "headers": { "X-Key": "${API_KEY}" } })),
        ]
        .into();
        let needs = server_needs(&servers);
        let names: Vec<(&str, bool, &str, bool)> = needs.iter().map(|need| (need.name.as_str(), need.required, need.default.as_str(), need.secret)).collect();
        assert_eq!(names, vec![("GITHUB_TOKEN", true, "", true), ("API_KEY", true, "", true), ("REGION", false, "eu", false)]);
        assert_eq!(needs[0].description, "Used by the server github");
        assert_eq!(speaking(Language::Es, || server_needs(&servers))[0].description, "La usa el servidor github");
    }

    #[test]
    fn a_plugin_folder_is_read_into_its_parts() {
        let root = temp_root("parts");
        put(&root.join("skills/revisar/SKILL.md"), "---\nname: revisar\ndescription: Revisa PRs\n---\n");
        put(&root.join("extra/traducir/SKILL.md"), "---\nname: traducir\ndescription: Traduce\n---\n");
        put(&root.join("commands/review.md"), "---\ndescription: Lanza una revisión\n---\nHaz");
        put(&root.join("agents/critic.md"), "---\nname: crítico\ndescription: Busca fallos\n---\n");
        put(&root.join("hooks/hooks.json"), r#"{"hooks":{"PostToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"${CLAUDE_PLUGIN_ROOT}/bin/fmt.sh"}]}]}}"#);
        put(&root.join(".mcp.json"), r#"{"mcpServers":{"gh":{"command":"npx","args":["-y","@x/gh"]},"web":{"type":"http","url":"https://x/mcp"}}}"#);
        put(&root.join(".lsp.json"), r#"{"clangd":{"command":"clangd"}}"#);
        put(&root.join("bin/fmt.sh"), "echo");
        let manifest = json!({ "name": "x", "skills": ["./extra"] });

        let parts = parts_of(&root, &manifest);

        assert_eq!(parts.skills.iter().map(|part| part.name.as_str()).collect::<Vec<_>>(), vec!["revisar", "traducir"]);
        assert_eq!(parts.skills[1].path, "extra/traducir/SKILL.md");
        assert_eq!(parts.commands, vec![Part { name: "review".into(), path: "commands/review.md".into(), description: "Lanza una revisión".into() }]);
        assert_eq!(parts.agents[0].name, "crítico");
        assert_eq!(parts.hooks, vec![Hook { event: "PostToolUse".into(), command: "${CLAUDE_PLUGIN_ROOT}/bin/fmt.sh".into() }]);
        assert_eq!(parts.servers, vec![Launcher { name: "gh".into(), launch: "npx -y @x/gh".into() }, Launcher { name: "web".into(), launch: "https://x/mcp".into() }]);
        assert_eq!(parts.lsp, vec!["clangd"]);
        assert_eq!(parts.bin, vec!["bin/fmt.sh"]);
    }

    #[test]
    fn inline_components_in_the_manifest_win_over_the_default_files() {
        let root = temp_root("parts-inline");
        put(&root.join(".mcp.json"), r#"{"mcpServers":{"del-fichero":{"command":"a"}}}"#);
        put(&root.join("cmds/uno.md"), "uno");
        let manifest = json!({
            "name": "x",
            "mcpServers": { "en-linea": { "type": "http", "url": "https://y/mcp" } },
            "commands": ["./cmds"],
            "hooks": { "Stop": [{ "hooks": [{ "type": "prompt", "prompt": "resume" }] }] }
        });
        let parts = parts_of(&root, &manifest);
        assert_eq!(parts.servers.iter().map(|server| server.name.as_str()).collect::<Vec<_>>(), vec!["en-linea"]);
        assert_eq!(parts.commands[0].path, "cmds/uno.md");
        assert_eq!(parts.hooks, vec![Hook { event: "Stop".into(), command: "(prompt)".into() }]);
    }

    #[test]
    fn a_listing_that_defines_the_plugin_becomes_its_manifest() {
        let entry = json!({ "name": "clangd-lsp", "description": "C", "version": "1.0.0", "strict": false, "source": "./plugins/clangd-lsp",
            "lspServers": { "clangd": { "command": "clangd" } }, "category": "development" });
        let made = definition_of(&entry);
        assert_eq!(made, json!({ "name": "clangd-lsp", "description": "C", "version": "1.0.0", "lspServers": { "clangd": { "command": "clangd" } } }));

        let root = temp_root("definition");
        assert!(needs_definition(&json!({}), &root));
        put(&root.join(".claude-plugin/plugin.json"), r#"{"name":"x"}"#);
        assert!(!needs_definition(&json!({}), &root));
        assert!(needs_definition(&entry, &root));
    }

    #[test]
    fn the_readme_and_license_come_from_the_usual_files() {
        let root = temp_root("readme");
        let listing = official(json!({ "name": "x", "source": "./plugins/x", "description": "Corta" }));
        assert_eq!(readme_of(&root, &listing), "Corta");
        put(&root.join("skills/a/SKILL.md"), "del skill");
        assert_eq!(readme_of(&root, &listing), "del skill");
        put(&root.join("readme.md"), "# Léeme");
        assert_eq!(readme_of(&root, &listing), "# Léeme");

        put(&root.join("LICENSE"), "\n  MIT License\n\nCopyright");
        assert_eq!(license_of(&root, &Value::Null), "MIT License");
        assert_eq!(license_of(&root, &json!({ "license": "Apache-2.0" })), "Apache-2.0");
    }

    #[test]
    fn a_catalog_is_served_from_its_cache_while_it_is_fresh() {
        let base = temp_root("cache");
        let item = plugin_item("official", &json!({ "name": "a", "source": "./plugins/a" }), &catalog(), Badge::Partner, true).unwrap();
        let kept = Cached { fetched_at: session::now(), repo: catalog().repo, sha: catalog().sha, items: vec![item] };
        store::store(&catalogs(&base), "official.json", &kept).unwrap();

        let (served, error) = gather(&base, &SOURCES[0], false, session::now());
        assert!(error.is_empty());
        assert_eq!(served.items.len(), 1);

        let found = find(&base, "official:a").unwrap();
        assert_eq!((found.repo.as_str(), found.item.listing.name.as_str()), ("anthropics/claude-plugins-official", "a"));
        assert!(find(&base, "official:nadie").err().unwrap().contains("refresh it"));
        assert!(find(&base, "skills.sh:o/r/s").is_err());
        let hit = searched(&json!({ "skills": [{ "id": "o/r/s", "skillId": "s", "name": "s", "source": "o/r" }] })).remove(0);
        store::store(&catalogs(&base), SEEN_FILE, &BTreeMap::from([(hit.id.clone(), hit)])).unwrap();
        assert_eq!(find(&base, "skills.sh:o/r/s").unwrap().item.listing.name, "s");
    }

    #[test]
    fn installing_what_cannot_be_installed_says_why() {
        let base = temp_root("refuse");
        let locked = connector_item(&connector(false, json!([{ "type": "streamable-http", "url": "https://x/mcp" }]))).unwrap();
        let kept = Cached { fetched_at: session::now(), items: vec![locked], ..Cached::default() };
        store::store(&catalogs(&base), "connectors.json", &kept).unwrap();

        assert_eq!(install(&base, "", "connectors:ai.tickettailor/mcp", &BTreeMap::new()).unwrap_err(), login_needed());
        let spoken = speaking(Language::Es, || install(&base, "", "connectors:ai.tickettailor/mcp", &BTreeMap::new()));
        assert_eq!(spoken.unwrap_err(), "este conector pide iniciar sesión y Sens aún no puede hacerlo por ti");
    }

    #[test]
    #[ignore]
    fn the_real_catalogs_come_down_and_an_official_plugin_installs() {
        let base = temp_root("live");
        let started = std::time::Instant::now();
        let found = market(&base, true);
        println!("catálogos en {:?}", started.elapsed());
        for source in &found.sources {
            let count = found.listings.iter().filter(|listing| listing.source == source.id).count();
            println!("{:<20} {:>5} {}", source.id, count, source.error);
        }
        let installable = found.listings.iter().filter(|listing| listing.installable).count();
        println!("instalables {installable} de {}", found.listings.len());
        assert!(found.sources.iter().all(|source| source.error.is_empty()));
        assert!(!found.listings.iter().any(|listing| ["pdf", "docx", "pptx", "xlsx"].contains(&listing.name.as_str()) && listing.source == "skills"));

        let started = std::time::Instant::now();
        let shown = detail(&base, "official:code-review").unwrap();
        println!("detalle en {:?}: {} ficheros, {} comandos, {} agentes, licencia {:?}", started.elapsed(), shown.files.len(), shown.parts.commands.len(), shown.parts.agents.len(), shown.license);
        assert!(!shown.readme.is_empty());

        let name = install(&base, "P:\\vivo", "official:code-review", &BTreeMap::new()).unwrap();
        let launch = capabilities::launch(&base, "P:\\vivo").unwrap();
        println!("instalado {name}: {:?}", launch.args);
        assert!(launch.args.iter().any(|arg| arg.ends_with(&name)));

        let skill = install(&base, "P:\\vivo", "skills:mcp-builder", &BTreeMap::new()).unwrap();
        assert_eq!(skill, "mcp-builder");

        let external = found.listings.iter().find(|listing| listing.source == "community" && listing.installable).unwrap();
        let started = std::time::Instant::now();
        let shown = detail(&base, &external.id).unwrap();
        println!("comunidad {} en {:?}: {} ficheros", external.id, started.elapsed(), shown.files.len());

        let searched = search(&base, "react").unwrap();
        println!("skills.sh react: {} resultados, primero {:?}", searched.len(), searched.first().map(|listing| &listing.id));
        let first = searched.first().unwrap();
        let shown = detail(&base, &first.id).unwrap();
        println!("skills.sh detalle: {} ficheros, {} skills", shown.files.len(), shown.parts.skills.len());
    }

    #[test]
    fn an_open_connector_installs_as_a_remote_server_with_its_origin() {
        let base = temp_root("connector-install");
        let open = connector_item(&connector(true, json!([{ "type": "streamable-http", "url": "https://mcp.tickettailor.ai/mcp" }]))).unwrap();
        let kept = Cached { fetched_at: session::now(), items: vec![open], ..Cached::default() };
        store::store(&catalogs(&base), "connectors.json", &kept).unwrap();

        let name = install(&base, "P:\\proyecto", "connectors:ai.tickettailor/mcp", &BTreeMap::new()).unwrap();

        let found = capabilities::all(&base, "P:\\proyecto");
        assert_eq!(name, "ticket-tailor");
        assert_eq!((found.servers[0].url.as_str(), found.servers[0].enabled), ("https://mcp.tickettailor.ai/mcp", true));
        assert_eq!(found.origins["server:ticket-tailor"].listing, "connectors:ai.tickettailor/mcp");
    }
}
