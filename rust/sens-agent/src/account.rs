use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::process::{CLAUDE, hidden};

const FIRST_PARTY: &str = "firstParty";
const BEARER: &str = "ANTHROPIC_AUTH_TOKEN";
const LONG_LIVED: &str = "CLAUDE_CODE_OAUTH_TOKEN";

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Billing {
    Subscription,
    NoPlan,
    Elsewhere,
    SignedOut,
}

#[derive(Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub billing: Billing,
    pub plan: String,
    pub source: String,
    pub email: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Reported {
    logged_in: bool,
    auth_method: String,
    api_provider: String,
    api_key_source: Option<String>,
    email: Option<String>,
    subscription_type: Option<String>,
}

pub fn read() -> Result<Account, String> {
    let program = CLAUDE.to_string();
    let answer = hidden(&mut Command::new(&program))
        .args(["auth", "status", "--json"])
        .output()
        .map_err(|error| format!("no pude lanzar {program}: {error}"))?;

    let reported: Reported = serde_json::from_slice(&answer.stdout).map_err(|_| {
        let complaint = String::from_utf8_lossy(&answer.stderr);
        format!("{program} no dijo con qué cuenta entra: {}", complaint.trim())
    })?;

    let bearer = std::env::var_os(BEARER).is_some_and(|value| !value.is_empty());
    Ok(judge(reported, bearer))
}

fn judge(reported: Reported, bearer: bool) -> Account {
    let Reported {
        logged_in,
        auth_method,
        api_provider,
        api_key_source,
        email,
        subscription_type,
    } = reported;

    let (billing, plan, source) = if !api_provider.is_empty() && api_provider != FIRST_PARTY {
        (Billing::Elsewhere, None, Some(api_provider))
    } else if bearer {
        (Billing::Elsewhere, None, Some(BEARER.to_string()))
    } else if let Some(key) = api_key_source {
        (Billing::Elsewhere, None, Some(key))
    } else if !logged_in {
        (Billing::SignedOut, None, None)
    } else if auth_method == "oauth_token" {
        (Billing::Subscription, None, Some(LONG_LIVED.to_string()))
    } else if let Some(plan) = subscription_type.filter(|plan| !plan.is_empty()) {
        (Billing::Subscription, Some(plan), None)
    } else {
        (Billing::NoPlan, None, None)
    };

    Account {
        billing,
        plan: plan.unwrap_or_default(),
        source: source.unwrap_or_default(),
        email: email.unwrap_or_default(),
    }
}

pub fn sign_in() -> Result<(), String> {
    let program = CLAUDE.to_string();
    login_window(&program)?
        .spawn()
        .map(drop)
        .map_err(|error| format!("no pude abrir el inicio de sesión de {program}: {error}"))
}

#[cfg(windows)]
fn login_window(program: &str) -> Result<Command, String> {
    use std::os::windows::process::CommandExt;

    let mut command = Command::new("cmd");
    hidden(&mut command).raw_arg(format!("/c start \"Claude Code\" {program} auth login --claudeai"));
    Ok(command)
}

#[cfg(not(windows))]
fn login_window(program: &str) -> Result<Command, String> {
    Err(format!(
        "abre una terminal y ejecuta {program} auth login --claudeai"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seen(raw: &str) -> Reported {
        serde_json::from_str(raw).unwrap()
    }

    #[test]
    fn a_max_login_is_the_subscription() {
        let account = judge(
            seen(r#"{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":"a@b.c","subscriptionType":"max"}"#),
            false,
        );
        assert_eq!(account.billing, Billing::Subscription);
        assert_eq!(account.plan, "max");
        assert_eq!(account.email, "a@b.c");
    }

    #[test]
    fn a_login_without_a_plan_is_not_the_subscription() {
        let account = judge(
            seen(r#"{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":"a@b.c","subscriptionType":null}"#),
            false,
        );
        assert_eq!(account.billing, Billing::NoPlan);
    }

    #[test]
    fn no_login_is_signed_out() {
        let account = judge(
            seen(r#"{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}"#),
            false,
        );
        assert_eq!(account.billing, Billing::SignedOut);
    }

    #[test]
    fn an_api_key_in_the_environment_wins_over_the_login() {
        let account = judge(
            seen(r#"{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","apiKeySource":"ANTHROPIC_API_KEY","email":"a@b.c","subscriptionType":"max"}"#),
            false,
        );
        assert_eq!(account.billing, Billing::Elsewhere);
        assert_eq!(account.source, "ANTHROPIC_API_KEY");
    }

    #[test]
    fn a_bearer_token_wins_even_though_status_never_mentions_it() {
        let account = judge(
            seen(r#"{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"pro"}"#),
            true,
        );
        assert_eq!(account.billing, Billing::Elsewhere);
        assert_eq!(account.source, BEARER);
    }

    #[test]
    fn a_cloud_provider_is_billed_elsewhere() {
        let account = judge(
            seen(r#"{"loggedIn":true,"authMethod":"none","apiProvider":"bedrock"}"#),
            false,
        );
        assert_eq!(account.billing, Billing::Elsewhere);
        assert_eq!(account.source, "bedrock");
    }

    #[test]
    fn a_setup_token_is_the_subscription() {
        let account = judge(
            seen(r#"{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty"}"#),
            false,
        );
        assert_eq!(account.billing, Billing::Subscription);
        assert_eq!(account.source, LONG_LIVED);
    }

    #[test]
    fn fields_a_newer_claude_adds_do_not_break_the_reading() {
        let account = judge(
            seen(r#"{"loggedIn":false,"authMethod":"none","somethingNew":{"x":1}}"#),
            false,
        );
        assert_eq!(account.billing, Billing::SignedOut);
    }
}
