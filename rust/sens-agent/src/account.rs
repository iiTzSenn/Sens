use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::process::{CLAUDE, claude, launched, unlaunched};
use crate::said;

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

#[derive(Serialize, Clone, PartialEq, Debug)]
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

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Door {
    Subscription,
    Console,
}

impl Door {
    fn flag(self) -> &'static str {
        match self {
            Door::Subscription => "--claudeai",
            Door::Console => "--console",
        }
    }
}

pub fn read() -> Result<Option<Account>, String> {
    let Some(answer) = launched(claude().args(["auth", "status", "--json"]).output())? else {
        return Ok(None);
    };

    let reported: Reported = serde_json::from_slice(&answer.stdout).map_err(|_| {
        let complaint = String::from_utf8_lossy(&answer.stderr);
        let complaint = complaint.trim();
        said!(
            en: "{CLAUDE} didn’t say which account it signs in with: {complaint}",
            es: "{CLAUDE} no dijo con qué cuenta entra: {complaint}",
            fr: "{CLAUDE} n’a pas indiqué avec quel compte il se connecte : {complaint}",
            de: "{CLAUDE} hat nicht angegeben, mit welchem Konto es angemeldet ist: {complaint}",
            ja: "{CLAUDE} がサインインしているアカウントを返しませんでした: {complaint}",
            zh: "{CLAUDE} 没有说明它用哪个账号登录：{complaint}",
        )
    })?;

    let bearer = std::env::var_os(BEARER).is_some_and(|value| !value.is_empty());
    Ok(Some(judge(reported, bearer)))
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

pub fn version() -> Result<String, String> {
    let answer = claude().arg("--version").output().map_err(unlaunched)?;
    let said = String::from_utf8_lossy(&answer.stdout);
    let version = said.split_whitespace().next().unwrap_or_default();
    match answer.status.success() && !version.is_empty() {
        true => Ok(version.to_string()),
        false => Err(said!(
            en: "{CLAUDE} didn’t report its version",
            es: "{CLAUDE} no dijo su versión",
            fr: "{CLAUDE} n’a pas indiqué sa version",
            de: "{CLAUDE} hat seine Version nicht angegeben",
            ja: "{CLAUDE} がバージョンを返しませんでした",
            zh: "{CLAUDE} 没有返回版本号",
        )),
    }
}

pub fn sign_in(door: Door) -> Result<(), String> {
    let finished = login_window(door)?.status().map_err(unlaunched)?;
    match finished.success() {
        true => Ok(()),
        false => Err(said!(
            en: "you didn’t finish signing in",
            es: "no terminaste el inicio de sesión",
            fr: "vous n’avez pas terminé la connexion",
            de: "du hast die Anmeldung nicht abgeschlossen",
            ja: "サインインが完了していません",
            zh: "登录尚未完成",
        )),
    }
}

pub fn sign_out() -> Result<(), String> {
    let answer = claude().args(["auth", "logout"]).output().map_err(unlaunched)?;
    let complaint = String::from_utf8_lossy(&answer.stderr);
    let complaint = complaint.trim();
    match answer.status.success() {
        true => Ok(()),
        false => Err(said!(
            en: "{CLAUDE} didn’t sign out: {complaint}",
            es: "{CLAUDE} no cerró la sesión: {complaint}",
            fr: "{CLAUDE} ne s’est pas déconnecté : {complaint}",
            de: "{CLAUDE} hat sich nicht abgemeldet: {complaint}",
            ja: "{CLAUDE} からサインアウトできませんでした: {complaint}",
            zh: "{CLAUDE} 未能退出登录：{complaint}",
        )),
    }
}

#[cfg(windows)]
fn login_window(door: Door) -> Result<Command, String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    let mut command = Command::new(crate::process::program());
    command.args(["auth", "login", door.flag()]).creation_flags(CREATE_NEW_CONSOLE);
    Ok(command)
}

#[cfg(not(windows))]
fn login_window(door: Door) -> Result<Command, String> {
    let flag = door.flag();
    Err(said!(
        en: "open a terminal and run {CLAUDE} auth login {flag}",
        es: "abre una terminal y ejecuta {CLAUDE} auth login {flag}",
        fr: "ouvrez un terminal et exécutez {CLAUDE} auth login {flag}",
        de: "öffne ein Terminal und führe {CLAUDE} auth login {flag} aus",
        ja: "ターミナルを開いて {CLAUDE} auth login {flag} を実行してください",
        zh: "打开终端并运行 {CLAUDE} auth login {flag}",
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
