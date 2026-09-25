use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;

use sens_agent::said;
use serde_json::Value;
use ureq::http::Response;
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
use ureq::typestate::WithoutBody;
use ureq::{Agent, Body, RequestBuilder};

pub const MEGABYTE: u64 = 1024 * 1024;
pub const PAGE_CAP: u64 = 16 * MEGABYTE;
const SHA_LENGTH: usize = 40;
const SAVING_TIME: Duration = Duration::from_secs(30 * 60);
const SAVING_CHUNK: usize = 256 * 1024;

fn agent() -> &'static Agent {
    static AGENT: OnceLock<Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        let tls = TlsConfig::builder()
            .provider(TlsProvider::NativeTls)
            .root_certs(RootCerts::PlatformVerifier)
            .build();
        Agent::config_builder()
            .tls_config(tls)
            .http_status_as_error(false)
            .timeout_connect(Some(Duration::from_secs(10)))
            .timeout_global(Some(Duration::from_secs(120)))
            .user_agent(concat!("Sens/", env!("CARGO_PKG_VERSION")))
            .build()
            .into()
    })
}

pub fn host(url: &str) -> &str {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    rest.split(['/', '?', '#']).next().unwrap_or(rest)
}

fn answered(asked: RequestBuilder<WithoutBody>, url: &str) -> Result<Response<Body>, String> {
    let site = host(url);
    let answer = asked.call().map_err(|error| match error {
        ureq::Error::Timeout(_) => said!(
            en: "{site} took too long to respond",
            es: "{site} tardó demasiado en responder",
            fr: "{site} a mis trop de temps à répondre",
            de: "{site} hat zu lange nicht geantwortet",
            ja: "{site} の応答に時間がかかりすぎました",
            zh: "{site} 响应超时",
        ),
        _ => said!(
            en: "no connection to {site}: {error}",
            es: "sin conexión con {site}: {error}",
            fr: "pas de connexion avec {site} : {error}",
            de: "keine Verbindung zu {site}: {error}",
            ja: "{site} に接続できません: {error}",
            zh: "无法连接到 {site}：{error}",
        ),
    })?;
    match answer.status().as_u16() {
        200..=299 => Ok(answer),
        404 => Err(said!(
            en: "{site} doesn’t have {url}",
            es: "{site} no tiene {url}",
            fr: "{site} n’a pas {url}",
            de: "{site} hat {url} nicht",
            ja: "{site} に {url} はありません",
            zh: "{site} 上没有 {url}",
        )),
        429 => Err(throttled(site)),
        403 if answer.headers().get("x-ratelimit-remaining").is_some_and(|left| left == "0") => Err(throttled(site)),
        403 => Err(said!(
            en: "{site} doesn’t allow access to {url}",
            es: "{site} no da acceso a {url}",
            fr: "{site} refuse l’accès à {url}",
            de: "{site} verweigert den Zugriff auf {url}",
            ja: "{site} は {url} へのアクセスを許可していません",
            zh: "{site} 不允许访问 {url}",
        )),
        code => Err(said!(
            en: "{site} answered {code}",
            es: "{site} respondió {code}",
            fr: "{site} a répondu {code}",
            de: "{site} hat mit {code} geantwortet",
            ja: "{site} が {code} を返しました",
            zh: "{site} 返回了 {code}",
        )),
    }
}

fn unread(site: &str, cap: u64, error: ureq::Error) -> String {
    match error {
        ureq::Error::BodyExceedsLimit(_) => said!(
            en: "the download from {site} is over {size} MB",
            es: "la descarga de {site} pasa de {size} MB",
            fr: "le téléchargement depuis {site} dépasse {size} Mo",
            de: "der Download von {site} ist größer als {size} MB",
            ja: "{site} からのダウンロードが {size} MB を超えています",
            zh: "来自 {site} 的下载超过 {size} MB",
            size = cap / MEGABYTE,
        ),
        _ => said!(
            en: "couldn’t read the response from {site}: {error}",
            es: "no pude leer la respuesta de {site}: {error}",
            fr: "impossible de lire la réponse de {site} : {error}",
            de: "die Antwort von {site} konnte nicht gelesen werden: {error}",
            ja: "{site} からの応答を読み取れませんでした: {error}",
            zh: "无法读取 {site} 的响应：{error}",
        ),
    }
}

pub fn bytes(url: &str, query: &[(&str, &str)], cap: u64) -> Result<Vec<u8>, String> {
    bytes_with(url, query, &[], cap, None)
}

fn bytes_with(url: &str, query: &[(&str, &str)], headers: &[(&str, &str)], cap: u64, wait: Option<Duration>) -> Result<Vec<u8>, String> {
    let mut asked = agent().get(url);
    if let Some(wait) = wait {
        asked = asked.config().timeout_global(Some(wait)).build();
    }
    for (key, value) in query {
        asked = asked.query(*key, *value);
    }
    for (name, value) in headers {
        asked = asked.header(*name, *value);
    }
    let mut answer = answered(asked, url)?;
    answer.body_mut().with_config().limit(cap).read_to_vec().map_err(|error| unread(host(url), cap, error))
}

pub fn save(url: &str, path: &Path, cap: u64, progress: impl Fn(u64)) -> Result<u64, String> {
    let site = host(url);
    let asked = agent().get(url).config().timeout_global(Some(SAVING_TIME)).build();
    let mut answer = answered(asked, url)?;
    let mut reader = answer.body_mut().with_config().limit(cap).reader();
    let mut file = File::create(path).map_err(|error| crate::files::uncreated(path, error))?;
    let unsaved = |error: std::io::Error| {
        said!(
            en: "couldn’t save the download from {site}: {error}",
            es: "no pude guardar la descarga de {site}: {error}",
            fr: "impossible d’enregistrer le téléchargement depuis {site} : {error}",
            de: "der Download von {site} konnte nicht gespeichert werden: {error}",
            ja: "{site} からのダウンロードを保存できませんでした: {error}",
            zh: "无法保存来自 {site} 的下载：{error}",
        )
    };
    let mut chunk = vec![0u8; SAVING_CHUNK];
    let mut done = 0u64;
    loop {
        let read = reader.read(&mut chunk).map_err(|error| {
            said!(
                en: "the download from {site} was cut off: {error}",
                es: "la descarga de {site} se cortó: {error}",
                fr: "le téléchargement depuis {site} a été interrompu : {error}",
                de: "der Download von {site} wurde abgebrochen: {error}",
                ja: "{site} からのダウンロードが途中で切れました: {error}",
                zh: "来自 {site} 的下载中断了：{error}",
            )
        })?;
        if read == 0 {
            break;
        }
        file.write_all(&chunk[..read]).map_err(unsaved)?;
        done += read as u64;
        progress(done);
    }
    file.sync_all().map_err(unsaved)?;
    Ok(done)
}

fn throttled(site: &str) -> String {
    said!(
        en: "{site} isn’t responding right now (too many requests); try again in a while",
        es: "{site} no responde ahora (demasiadas peticiones); prueba en un rato",
        fr: "{site} ne répond pas pour le moment (trop de requêtes) ; réessayez dans un moment",
        de: "{site} antwortet gerade nicht (zu viele Anfragen); versuch es später noch einmal",
        ja: "{site} は現在応答していません（リクエストが多すぎます）。しばらくしてからもう一度お試しください",
        zh: "{site} 暂时没有响应（请求过多）；请稍后再试",
    )
}

pub fn text(url: &str, cap: u64) -> Result<String, String> {
    String::from_utf8(bytes(url, &[], cap)?).map_err(|_| {
        said!(
            en: "{site} didn’t return text",
            es: "{site} no devolvió texto",
            fr: "{site} n’a pas renvoyé de texte",
            de: "{site} hat keinen Text geliefert",
            ja: "{site} がテキストを返しませんでした",
            zh: "{site} 没有返回文本",
            site = host(url),
        )
    })
}

pub fn json(url: &str, query: &[(&str, &str)]) -> Result<Value, String> {
    json_with(url, query, &[], None)
}

pub fn json_with(url: &str, query: &[(&str, &str)], headers: &[(&str, &str)], wait: Option<Duration>) -> Result<Value, String> {
    serde_json::from_slice(&bytes_with(url, query, headers, PAGE_CAP, wait)?).map_err(|error| {
        said!(
            en: "{site} returned unreadable JSON: {error}",
            es: "{site} devolvió JSON ilegible: {error}",
            fr: "{site} a renvoyé du JSON illisible : {error}",
            de: "{site} hat unlesbares JSON geliefert: {error}",
            ja: "{site} が読み取れない JSON を返しました: {error}",
            zh: "{site} 返回了无法解析的 JSON：{error}",
            site = host(url),
        )
    })
}

pub fn is_sha(text: &str) -> bool {
    text.len() == SHA_LENGTH && text.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub fn revision(repo: &str, wanted: &str) -> Result<String, String> {
    if is_sha(wanted) {
        return Ok(wanted.to_ascii_lowercase());
    }
    let url = format!("https://github.com/{repo}.git/info/refs?service=git-upload-pack");
    let listing = text(&url, 4 * MEGABYTE)?;
    pick_ref(&advertised(&listing), wanted).ok_or_else(|| match wanted {
        "" => said!(
            en: "{repo} doesn’t say which version is its latest",
            es: "{repo} no dice cuál es su última versión",
            fr: "{repo} n’indique pas sa dernière version",
            de: "{repo} nennt seine neueste Version nicht",
            ja: "{repo} の最新バージョンがわかりません",
            zh: "{repo} 未说明其最新版本",
        ),
        _ => said!(
            en: "{repo} doesn’t have version {wanted}",
            es: "{repo} no tiene la versión {wanted}",
            fr: "{repo} n’a pas de version {wanted}",
            de: "{repo} hat keine Version {wanted}",
            ja: "{repo} にバージョン {wanted} はありません",
            zh: "{repo} 没有版本 {wanted}",
        ),
    })
}

fn advertised(listing: &str) -> Vec<(String, String)> {
    listing
        .split('\n')
        .filter_map(|line| {
            let mut line = line;
            while let Some(rest) = line.strip_prefix("0000") {
                line = rest;
            }
            let line = line.get(4..).unwrap_or_default();
            let line = line.split('\0').next().unwrap_or_default();
            let (sha, name) = line.split_once(' ')?;
            is_sha(sha).then(|| (sha.to_ascii_lowercase(), name.trim().to_string()))
        })
        .collect()
}

fn pick_ref(refs: &[(String, String)], wanted: &str) -> Option<String> {
    let find = |name: &str| refs.iter().find(|(_, listed)| listed == name).map(|(sha, _)| sha.clone());
    if wanted.is_empty() || wanted == "HEAD" {
        return find("HEAD");
    }
    let bare = wanted.trim_start_matches("refs/").trim_start_matches("heads/").trim_start_matches("tags/");
    find(&format!("refs/tags/{bare}^{{}}"))
        .or_else(|| find(&format!("refs/tags/{bare}")))
        .or_else(|| find(&format!("refs/heads/{bare}")))
        .or_else(|| find(wanted))
}

#[cfg(test)]
mod tests {
    use super::*;

    const LISTING: &str = "001e# service=git-upload-pack\n0000015a6bfd4e0c6d3da6050984fa5ed8281d915fa7ed69 HEAD\0multi_ack symref=HEAD:refs/heads/main\n003f6bfd4e0c6d3da6050984fa5ed8281d915fa7ed69 refs/heads/main\n003f1111111111111111111111111111111111111111 refs/heads/dev\n003f2222222222222222222222222222222222222222 refs/tags/v1.5.5\n00423333333333333333333333333333333333333333 refs/tags/v1.5.5^{}\n0000";

    #[test]
    fn the_head_and_any_branch_or_tag_are_read_from_the_git_advertisement() {
        let refs = advertised(LISTING);
        assert_eq!(pick_ref(&refs, "").as_deref(), Some("6bfd4e0c6d3da6050984fa5ed8281d915fa7ed69"));
        assert_eq!(pick_ref(&refs, "dev").as_deref(), Some("1111111111111111111111111111111111111111"));
        assert_eq!(pick_ref(&refs, "refs/heads/dev").as_deref(), Some("1111111111111111111111111111111111111111"));
        assert_eq!(pick_ref(&refs, "v1.5.5").as_deref(), Some("3333333333333333333333333333333333333333"));
        assert_eq!(pick_ref(&refs, "nada"), None);
    }

    #[test]
    fn a_full_sha_is_taken_as_it_is() {
        let sha = "ABCDEF0123456789abcdef0123456789abcdef01";
        assert!(is_sha(sha));
        assert_eq!(revision("x/y", sha).unwrap(), sha.to_ascii_lowercase());
        assert!(!is_sha("abc"));
    }

    #[test]
    fn the_host_is_what_the_user_recognises() {
        assert_eq!(host("https://skills.sh/api/search?q=pdf"), "skills.sh");
        assert_eq!(host("https://codeload.github.com/a/b/tar.gz/x"), "codeload.github.com");
    }
}
