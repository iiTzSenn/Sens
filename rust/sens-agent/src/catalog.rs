use std::io::{BufRead, BufReader, Write};
use std::process::Stdio;
use std::sync::mpsc;
use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};

use crate::process::{claude, unlaunched};

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: &'static str,
    pub vendor: &'static str,
    pub label: &'static str,
}

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Thinking {
    Always,
    Toggle,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Traits {
    pub efforts: &'static [&'static str],
    pub effort: &'static str,
    pub thinking: Thinking,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: String,
    pub label: String,
    pub description: String,
    pub latest: bool,
    pub efforts: Vec<&'static str>,
    pub effort: &'static str,
    pub thinking: Thinking,
}

pub const EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];
const WITHOUT_XHIGH: &[&str] = &["low", "medium", "high", "max"];
const NO_EFFORT: &[&str] = &[];

const FAMILY_TRAITS: &[(&str, Traits)] = &[
    ("fable", Traits { efforts: EFFORTS, effort: "high", thinking: Thinking::Always }),
    ("mythos", Traits { efforts: EFFORTS, effort: "high", thinking: Thinking::Always }),
    ("opus-5-5", Traits { efforts: EFFORTS, effort: "medium", thinking: Thinking::Always }),
    ("opus-4-7", Traits { efforts: EFFORTS, effort: "xhigh", thinking: Thinking::Toggle }),
    ("opus-4-6", Traits { efforts: WITHOUT_XHIGH, effort: "high", thinking: Thinking::Toggle }),
    ("sonnet-4-6", Traits { efforts: WITHOUT_XHIGH, effort: "high", thinking: Thinking::Toggle }),
    ("haiku", Traits { efforts: NO_EFFORT, effort: "", thinking: Thinking::Toggle }),
];

const NEWEST_TRAITS: Traits = Traits { efforts: EFFORTS, effort: "high", thinking: Thinking::Toggle };

pub const PROVIDERS: &[Provider] = &[Provider {
    id: "claude",
    vendor: "Anthropic",
    label: "Claude Code",
}];

const LISTING: &[&str] = &[
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--strict-mcp-config",
    "--settings",
    "{\"disableAllHooks\":true}",
];

const LISTING_REQUEST: &str = "sens-models";
const LISTING_WAIT: Duration = Duration::from_secs(60);
const DEFAULT_ENTRY: &str = "default";

pub fn provider(id: &str) -> Option<&'static Provider> {
    PROVIDERS.iter().find(|entry| entry.id == id)
}

pub fn traits(model: &str) -> Traits {
    FAMILY_TRAITS
        .iter()
        .find(|(family, _)| model.contains(family))
        .map_or(NEWEST_TRAITS, |(_, traits)| *traits)
}

pub fn discover(id: &str) -> Result<Vec<Card>, String> {
    provider(id).ok_or_else(|| format!("no conozco el proveedor {id}"))?;
    let offered = offered()?;
    let found = cards(&offered);
    match found.is_empty() {
        true => Err("Claude Code no ofreció ningún modelo".into()),
        false => Ok(found),
    }
}

fn offered() -> Result<Value, String> {
    let mut child = claude()
        .args(LISTING)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(unlaunched)?;

    let mut input = child.stdin.take().ok_or("Claude Code no acepta entrada")?;
    let output = child.stdout.take().ok_or("Claude Code no da salida")?;
    let asked = json!({
        "type": "control_request",
        "request_id": LISTING_REQUEST,
        "request": { "subtype": "initialize" }
    });

    let (tell, heard) = mpsc::channel();
    std::thread::spawn(move || {
        let answer = BufReader::new(output)
            .lines()
            .map_while(Result::ok)
            .filter_map(|line| serde_json::from_str::<Value>(&line).ok())
            .find(|message| message["response"]["request_id"] == LISTING_REQUEST);
        let _ = tell.send(answer);
    });

    let sent = writeln!(input, "{asked}").map_err(|error| format!("no pude hablar con Claude Code: {error}"));
    let answer = sent.and_then(|()| match heard.recv_timeout(LISTING_WAIT) {
        Ok(Some(answer)) => Ok(answer),
        Ok(None) => Err("Claude Code se cerró sin decir sus modelos".to_string()),
        Err(_) => Err("Claude Code tardó demasiado en decir sus modelos".to_string()),
    });
    let _ = child.kill();
    let _ = child.wait();

    let answer = answer?;
    match answer["response"]["subtype"].as_str() {
        Some("success") => Ok(answer["response"]["response"]["models"].clone()),
        _ => Err(format!(
            "Claude Code no dio sus modelos: {}",
            answer["response"]["error"].as_str().unwrap_or("sin motivo")
        )),
    }
}

fn cards(offered: &Value) -> Vec<Card> {
    let entries: Vec<&Value> = offered.as_array().into_iter().flatten().collect();
    let aliased: Vec<&str> = entries
        .iter()
        .filter(|entry| entry["value"] != DEFAULT_ENTRY)
        .map(|entry| id_of(entry))
        .collect();
    let mut found: Vec<Card> = Vec::new();
    let mut families: Vec<String> = Vec::new();
    for entry in entries {
        let Some(card) = card(entry) else { continue };
        let spare = entry["value"] == DEFAULT_ENTRY && aliased.contains(&card.id.as_str());
        if spare || found.iter().any(|kept| kept.id == card.id) {
            continue;
        }
        let family = family_of(&card.id);
        let latest = !families.contains(&family);
        if latest {
            families.push(family);
        }
        found.push(Card { latest, ..card });
    }
    found
}

fn id_of(entry: &Value) -> &str {
    let value = entry["value"].as_str().unwrap_or_default();
    entry["resolvedModel"].as_str().filter(|id| !id.is_empty()).unwrap_or(value)
}

fn card(entry: &Value) -> Option<Card> {
    let id = id_of(entry);
    if id.is_empty() || !plausible(id) {
        return None;
    }
    let Traits { effort, thinking, .. } = traits(id);
    let efforts = efforts_of(entry);
    Some(Card {
        label: entry["displayName"].as_str().map_or_else(|| named(id), str::to_string),
        description: entry["description"].as_str().unwrap_or_default().to_string(),
        latest: false,
        effort: starting_effort(effort, &efforts),
        id: id.to_string(),
        efforts,
        thinking,
    })
}

fn efforts_of(entry: &Value) -> Vec<&'static str> {
    if entry["supportsEffort"] != true {
        return Vec::new();
    }
    let listed: Vec<&str> = entry["supportedEffortLevels"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    EFFORTS.iter().copied().filter(|level| listed.contains(level)).collect()
}

fn starting_effort(usual: &'static str, efforts: &[&'static str]) -> &'static str {
    [usual, "high"]
        .into_iter()
        .find(|level| efforts.contains(level))
        .or_else(|| efforts.first().copied())
        .unwrap_or_default()
}

fn family_of(id: &str) -> String {
    id.trim_start_matches("claude-").split('-').next().unwrap_or(id).to_string()
}

fn named(id: &str) -> String {
    let bare = id.split('[').next().unwrap_or(id);
    let mut parts = bare.trim_start_matches("claude-").split('-');
    let family = parts.next().unwrap_or(bare);
    let version: Vec<&str> = parts
        .take_while(|part| part.len() < 8 && part.chars().all(|c| c.is_ascii_digit()))
        .collect();

    let mut letters = family.chars();
    let family = letters
        .next()
        .map(|first| first.to_uppercase().chain(letters).collect())
        .unwrap_or_default();

    match version.is_empty() {
        true => family,
        false => format!("{family} {}", version.join(".")),
    }
}

pub fn plausible(model: &str) -> bool {
    !model.starts_with('-')
        && model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-.[]_".contains(c))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn claude_code_is_the_only_provider() {
        assert_eq!(PROVIDERS.len(), 1);
        assert!(provider("claude").is_some());
        assert!(provider("api").is_none());
    }

    #[test]
    fn a_model_cannot_smuggle_in_a_flag() {
        assert!(plausible("claude-opus-5-5"));
        assert!(plausible("claude-fable-5-1[1m]"));
        assert!(!plausible("--dangerously-skip-permissions"));
        assert!(!plausible("opus; rm -rf"));
    }

    #[test]
    fn a_model_id_reads_as_family_and_version() {
        assert_eq!(named("claude-sonnet-5"), "Sonnet 5");
        assert_eq!(named("claude-opus-5-5"), "Opus 5.5");
        assert_eq!(named("claude-haiku-4-5-20251001"), "Haiku 4.5");
        assert_eq!(named("claude-fable-5-1[1m]"), "Fable 5.1");
    }

    fn offered_by_claude_code() -> Value {
        let every = ["low", "medium", "high", "xhigh", "max"];
        let older = ["low", "medium", "high", "max"];
        let entry = |value: &str, resolved: &str, name: &str, levels: &[&str]| {
            json!({
                "value": value,
                "resolvedModel": resolved,
                "displayName": name,
                "description": format!("{name} para probar"),
                "supportsEffort": !levels.is_empty(),
                "supportedEffortLevels": levels,
            })
        };
        json!([
            entry("default", "claude-opus-5-5", "Default (recommended)", &every),
            entry("opus", "claude-opus-5-5", "Opus 5.5", &every),
            entry("claude-fable-5-1", "claude-fable-5-1", "Fable 5.1", &every),
            entry("sonnet", "claude-sonnet-5", "Sonnet 5", &every),
            { "value": "haiku", "resolvedModel": "claude-haiku-4-5-20251001", "displayName": "Haiku 4.5", "description": "Rápido" },
            entry("claude-opus-5", "claude-opus-5", "Opus 5", &every),
            entry("claude-fable-5", "claude-fable-5", "Fable 5", &every),
            entry("claude-opus-4-8", "claude-opus-4-8", "Opus 4.8", &every),
            entry("claude-opus-4-7", "claude-opus-4-7", "Opus 4.7", &every),
            entry("claude-opus-4-6", "claude-opus-4-6", "Opus 4.6", &older),
            entry("claude-sonnet-4-6", "claude-sonnet-4-6", "Sonnet 4.6", &older),
        ])
    }

    #[test]
    fn every_model_claude_code_offers_becomes_one_card_without_the_default_alias() {
        let found = cards(&offered_by_claude_code());
        let ids: Vec<&str> = found.iter().map(|card| card.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                "claude-opus-5-5",
                "claude-fable-5-1",
                "claude-sonnet-5",
                "claude-haiku-4-5-20251001",
                "claude-opus-5",
                "claude-fable-5",
                "claude-opus-4-8",
                "claude-opus-4-7",
                "claude-opus-4-6",
                "claude-sonnet-4-6",
            ]
        );
        assert_eq!(found[0].label, "Opus 5.5");
        assert_eq!(found[0].description, "Opus 5.5 para probar");
    }

    #[test]
    fn the_first_model_of_each_family_is_the_latest_one() {
        let latest: Vec<String> = cards(&offered_by_claude_code())
            .into_iter()
            .filter(|card| card.latest)
            .map(|card| card.label)
            .collect();
        assert_eq!(latest, vec!["Opus 5.5", "Fable 5.1", "Sonnet 5", "Haiku 4.5"]);
    }

    #[test]
    fn a_card_keeps_only_the_effort_levels_claude_code_declares() {
        let found = cards(&offered_by_claude_code());
        let of = |id: &str| found.iter().find(|card| card.id == id).unwrap().clone();

        assert_eq!(of("claude-opus-4-6").efforts, WITHOUT_XHIGH);
        assert_eq!(of("claude-opus-4-8").efforts, EFFORTS);
        assert!(of("claude-haiku-4-5-20251001").efforts.is_empty());
        assert_eq!(of("claude-haiku-4-5-20251001").effort, "");
        assert_eq!(of("claude-opus-5-5").effort, "medium");
        assert_eq!(of("claude-opus-4-7").effort, "xhigh");
        assert_eq!(of("claude-fable-5").thinking, Thinking::Always);
    }

    #[test]
    fn an_older_claude_code_keeps_its_default_model_since_nothing_else_offers_it() {
        let older = json!([
            { "value": "default", "displayName": "Default (recommended)", "description": "Opus 4.8 with 1M context · Most capable for complex work", "supportsEffort": true, "supportedEffortLevels": ["low", "medium", "high", "xhigh", "max"] },
            { "value": "sonnet", "displayName": "Sonnet", "description": "Sonnet 4.6 · Best for everyday tasks", "supportsEffort": true, "supportedEffortLevels": ["low", "medium", "high", "max"] },
            { "value": "haiku", "displayName": "Haiku", "description": "Haiku 4.5 · Fastest for quick answers" },
        ]);
        let found = cards(&older);
        let ids: Vec<&str> = found.iter().map(|card| card.id.as_str()).collect();
        assert_eq!(ids, vec!["default", "sonnet", "haiku"]);
        assert_eq!(found[0].label, "Default (recommended)");
        assert_eq!(found[0].efforts, EFFORTS);
        assert!(found.iter().all(|card| card.latest));
    }

    #[test]
    fn an_entry_without_a_usable_id_is_skipped() {
        let odd = json!([
            { "value": "", "displayName": "Nada" },
            { "value": "--dangerously-skip-permissions" },
            { "value": "claude-sonnet-7" },
            "suelto",
        ]);
        let found = cards(&odd);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].label, "Sonnet 7");
        assert!(found[0].efforts.is_empty());
        assert!(cards(&json!(null)).is_empty());
    }

    #[test]
    fn a_default_effort_the_model_lacks_falls_back_to_high() {
        assert_eq!(starting_effort("xhigh", WITHOUT_XHIGH), "high");
        assert_eq!(starting_effort("medium", EFFORTS), "medium");
        assert_eq!(starting_effort("xhigh", &["low"]), "low");
        assert_eq!(starting_effort("high", &[]), "");
    }

    #[test]
    fn opus_5_5_and_fable_always_think_and_start_where_claude_code_starts() {
        let opus = traits("claude-opus-5-5");
        assert_eq!(opus.thinking, Thinking::Always);
        assert_eq!(opus.effort, "medium");
        assert_eq!(opus.efforts, EFFORTS);

        let fable = traits("claude-fable-5-1[1m]");
        assert_eq!(fable.thinking, Thinking::Always);
        assert_eq!(fable.effort, "high");
    }

    #[test]
    fn opus_5_is_not_mistaken_for_opus_5_5() {
        let opus = traits("claude-opus-5");
        assert_eq!(opus.thinking, Thinking::Toggle);
        assert_eq!(opus.effort, "high");
    }

    #[test]
    fn older_models_lose_the_levels_they_never_had() {
        assert_eq!(traits("claude-sonnet-4-6").efforts, WITHOUT_XHIGH);
        assert_eq!(traits("claude-opus-4-7").effort, "xhigh");
        assert!(traits("claude-haiku-4-5-20251001").efforts.is_empty());
    }

    #[test]
    fn a_model_nobody_has_seen_yet_gets_every_level() {
        let unknown = traits("claude-sonnet-6");
        assert_eq!(unknown.efforts, EFFORTS);
        assert_eq!(unknown.thinking, Thinking::Toggle);
    }
}
