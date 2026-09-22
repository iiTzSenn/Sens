use serde::{Deserialize, Serialize};

use crate::model::{Anthropic, CLAUDE_CODE, Cli, Model};

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct Level {
    pub id: &'static str,
    pub label: &'static str,
    pub budget: u32,
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: &'static str,
    pub label: &'static str,
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: &'static str,
    pub label: &'static str,
    pub hint: &'static str,
    pub needs_key: bool,
    pub needs_command: bool,
    pub models: &'static [Card],
    pub dieter: &'static str,
    pub levels: &'static [Level],
}

const NO_THINKING: &[Level] = &[Level {
    id: "off",
    label: "directo",
    budget: 0,
}];

const THINKING: &[Level] = &[
    Level {
        id: "off",
        label: "directo",
        budget: 0,
    },
    Level {
        id: "low",
        label: "bajo",
        budget: 4_000,
    },
    Level {
        id: "medium",
        label: "medio",
        budget: 10_000,
    },
    Level {
        id: "high",
        label: "alto",
        budget: 24_000,
    },
];

const ANTHROPIC_MODELS: &[Card] = &[
    Card {
        id: "claude-sonnet-5",
        label: "Sonnet 5",
    },
    Card {
        id: "claude-opus-5",
        label: "Opus 5",
    },
    Card {
        id: "claude-haiku-4-5-20251001",
        label: "Haiku 4.5",
    },
];

const CLAUDE_CODE_MODELS: &[Card] = &[Card {
    id: "claude",
    label: "Claude Code",
}];

const CUSTOM_MODELS: &[Card] = &[];

pub const PROVIDERS: &[Provider] = &[
    Provider {
        id: "api",
        label: "API de Anthropic",
        hint: "por tokens",
        needs_key: true,
        needs_command: false,
        models: ANTHROPIC_MODELS,
        dieter: "claude-haiku-4-5-20251001",
        levels: THINKING,
    },
    Provider {
        id: "claude",
        label: "Claude Code",
        hint: "tu suscripción",
        needs_key: false,
        needs_command: false,
        models: CLAUDE_CODE_MODELS,
        dieter: "claude",
        levels: NO_THINKING,
    },
    Provider {
        id: "otro",
        label: "Otro comando",
        hint: "un CLI tuyo",
        needs_key: false,
        needs_command: true,
        models: CUSTOM_MODELS,
        dieter: "",
        levels: NO_THINKING,
    },
];

pub fn provider(id: &str) -> Option<&'static Provider> {
    PROVIDERS.iter().find(|entry| entry.id == id)
}

impl Provider {
    pub fn budget(&self, level: &str) -> u32 {
        self.levels
            .iter()
            .find(|entry| entry.id == level)
            .map(|entry| entry.budget)
            .unwrap_or_default()
    }

    pub fn first_model(&self) -> &'static str {
        self.models.first().map(|card| card.id).unwrap_or_default()
    }

    pub fn knows(&self, model: &str) -> bool {
        self.models.iter().any(|card| card.id == model)
    }
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub provider: String,
    pub model: String,
    pub level: String,
    pub key: String,
    pub command: String,
}

pub struct Pair {
    pub writer: Box<dyn Model>,
    pub dieter: Box<dyn Model>,
}

pub fn vet(choice: &Choice) -> Result<&'static Provider, String> {
    let provider = provider(choice.provider.trim())
        .ok_or_else(|| format!("no conozco el proveedor {}", choice.provider))?;

    if provider.needs_key {
        anthropic_key(&choice.key)?;
    }
    if provider.needs_command && choice.command.trim().is_empty() {
        return Err("dime qué comando lanzar".into());
    }
    Ok(provider)
}

pub fn hire(choice: &Choice) -> Result<Pair, String> {
    let provider = vet(choice)?;

    match provider.id {
        "api" => {
            let key = anthropic_key(&choice.key)?;
            let model = if provider.knows(choice.model.trim()) {
                choice.model.trim()
            } else {
                provider.first_model()
            };
            Ok(Pair {
                writer: Box::new(Anthropic::new(
                    key.clone(),
                    model,
                    provider.budget(choice.level.trim()),
                )),
                dieter: Box::new(Anthropic::new(key, provider.dieter, 0)),
            })
        }
        "claude" => launch(CLAUDE_CODE),
        _ => launch(choice.command.trim()),
    }
}

fn launch(command: &str) -> Result<Pair, String> {
    Ok(Pair {
        writer: Box::new(Cli::parse(command)?),
        dieter: Box::new(Cli::parse(command)?),
    })
}

fn anthropic_key(given: &str) -> Result<String, String> {
    match given.trim() {
        "" => std::env::var("ANTHROPIC_API_KEY")
            .map_err(|_| "Sin clave: pégala arriba o define ANTHROPIC_API_KEY.".to_string()),
        key => Ok(key.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asking(provider: &str) -> Choice {
        Choice {
            provider: provider.into(),
            ..Choice::default()
        }
    }

    #[test]
    fn every_provider_offers_at_least_one_level() {
        for entry in PROVIDERS {
            assert!(!entry.levels.is_empty(), "{} sin niveles", entry.id);
            assert_eq!(entry.levels[0].budget, 0, "{} no arranca directo", entry.id);
        }
    }

    #[test]
    fn a_level_maps_to_a_thinking_budget() {
        let anthropic = provider("api").expect("anthropic");
        assert_eq!(anthropic.budget("off"), 0);
        assert!(anthropic.budget("high") > anthropic.budget("low"));
        assert_eq!(anthropic.budget("inventado"), 0);
    }

    #[test]
    fn the_dieter_is_a_model_the_provider_actually_lists() {
        for entry in PROVIDERS {
            if entry.models.is_empty() {
                continue;
            }
            assert!(entry.knows(entry.dieter), "{} no lista su dieter", entry.id);
        }
    }

    #[test]
    fn an_unknown_provider_is_refused_before_any_work_starts() {
        assert!(vet(&asking("gemini")).is_err());
    }

    #[test]
    fn a_custom_command_provider_needs_a_command() {
        assert!(vet(&asking("otro")).is_err());
        let given = Choice {
            provider: "otro".into(),
            command: "mi-cli --flag".into(),
            ..Choice::default()
        };
        assert!(vet(&given).is_ok());
    }
}
