use std::sync::OnceLock;
use std::time::Duration;

use serde_json::Value;
use ureq::Agent;
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};

pub const MEGABYTE: u64 = 1024 * 1024;
pub const PAGE_CAP: u64 = 16 * MEGABYTE;
const SHA_LENGTH: usize = 40;

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

pub fn bytes(url: &str, query: &[(&str, &str)], cap: u64) -> Result<Vec<u8>, String> {
    let site = host(url);
    let mut asked = agent().get(url);
    for (key, value) in query {
        asked = asked.query(*key, *value);
    }
    let mut answer = asked.call().map_err(|error| match error {
        ureq::Error::Timeout(_) => format!("{site} tardó demasiado en responder"),
        _ => format!("sin conexión con {site}: {error}"),
    })?;
    match answer.status().as_u16() {
        200..=299 => {}
        404 => return Err(format!("{site} no tiene {url}")),
        429 => return Err(throttled(site)),
        403 if answer.headers().get("x-ratelimit-remaining").is_some_and(|left| left == "0") => return Err(throttled(site)),
        403 => return Err(format!("{site} no da acceso a {url}")),
        code => return Err(format!("{site} respondió {code}")),
    }
    answer.body_mut().with_config().limit(cap).read_to_vec().map_err(|error| match error {
        ureq::Error::BodyExceedsLimit(_) => format!("la descarga de {site} pasa de {} MB", cap / MEGABYTE),
        _ => format!("no pude leer la respuesta de {site}: {error}"),
    })
}

fn throttled(site: &str) -> String {
    format!("{site} no responde ahora (demasiadas peticiones); prueba en un rato")
}

pub fn text(url: &str, cap: u64) -> Result<String, String> {
    String::from_utf8(bytes(url, &[], cap)?).map_err(|_| format!("{} no devolvió texto", host(url)))
}

pub fn json(url: &str, query: &[(&str, &str)]) -> Result<Value, String> {
    serde_json::from_slice(&bytes(url, query, PAGE_CAP)?)
        .map_err(|error| format!("{} devolvió JSON ilegible: {error}", host(url)))
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
        "" => format!("{repo} no dice cuál es su última versión"),
        _ => format!("{repo} no tiene la versión {wanted}"),
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
