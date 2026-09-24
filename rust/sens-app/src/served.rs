use std::path::PathBuf;
use std::time::Duration;

use sens_agent::process;
use serde_json::Value;

use crate::providers::KEY_VARIABLE;
use crate::web;

const MODELS_URL: &str = "https://api.anthropic.com/v1/models";
const PAGE_SIZE: &str = "1000";
const API_VERSION: &str = "2023-06-01";
const OAUTH_BETA: &str = "oauth-2025-04-20";
const CONFIG_VARIABLE: &str = "CLAUDE_CONFIG_DIR";
const CONFIG_FOLDER: &str = ".claude";
const GLOBAL_CONFIG: &str = ".claude.json";
const CREDENTIALS: &str = ".credentials.json";
const WAIT: Duration = Duration::from_secs(10);

enum Credential {
    Key(String),
    Subscription(String),
}

pub fn models() -> Value {
    let Some(credential) = credential() else { return Value::Null };
    let bearer;
    let headers = match &credential {
        Credential::Key(key) => vec![("x-api-key", key.as_str()), ("anthropic-version", API_VERSION)],
        Credential::Subscription(token) => {
            bearer = format!("Bearer {token}");
            vec![("authorization", bearer.as_str()), ("anthropic-version", API_VERSION), ("anthropic-beta", OAUTH_BETA)]
        }
    };
    web::json_with(MODELS_URL, &[("limit", PAGE_SIZE)], &headers, Some(WAIT)).map_or(Value::Null, |page| page["data"].clone())
}

fn credential() -> Option<Credential> {
    let key = process::environment().remove(KEY_VARIABLE).or_else(|| std::env::var(KEY_VARIABLE).ok());
    if let Some(key) = key.filter(|key| !key.is_empty()) {
        return Some(Credential::Key(key));
    }
    let saved: Value = serde_json::from_slice(&std::fs::read(config_folder()?.join(CREDENTIALS)).ok()?).ok()?;
    let token = saved["claudeAiOauth"]["accessToken"].as_str().filter(|token| !token.is_empty())?;
    Some(Credential::Subscription(token.to_string()))
}

pub fn config_folder() -> Option<PathBuf> {
    configured().or_else(|| std::env::home_dir().map(|home| home.join(CONFIG_FOLDER)))
}

pub fn global_config() -> Option<PathBuf> {
    configured().or_else(std::env::home_dir).map(|folder| folder.join(GLOBAL_CONFIG))
}

fn configured() -> Option<PathBuf> {
    std::env::var_os(CONFIG_VARIABLE)
        .filter(|folder| !folder.is_empty())
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore]
    fn the_real_account_serves_its_models() {
        let served = models();
        let ids: Vec<&str> = served.as_array().unwrap().iter().filter_map(|model| model["id"].as_str()).collect();
        println!("{ids:?}");
        assert!(ids.iter().all(|id| id.starts_with("claude-")));
        assert!(ids.len() > 4);
    }
}
