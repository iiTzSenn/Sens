use std::path::Path;

use serde_json::Value;

use crate::chat::Event;
use crate::language::{self, Language};
use crate::process::{claude, run};
use crate::said;
use crate::session::{self, Entry, Namer};

const ASKING: &[&str] = &[
    "-p",
    "--model",
    "haiku",
    "--output-format",
    "json",
    "--max-turns",
    "1",
    "--tools",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--settings",
    "{\"disableAllHooks\":true}",
    "--thinking",
    "disabled",
    "--system-prompt",
];

const EXCERPT_CAP: usize = 1_500;
const WRAPPERS: &[char] = &['"', '\'', '«', '»', '“', '”', '「', '」', '『', '』', '《', '》', '*', '`', '#'];
const LABELS: &[&str] = &["title", "título", "titulo", "titre", "titel", "タイトル", "标题"];

fn tongue(language: Language) -> &'static str {
    match language {
        Language::En => "English",
        Language::Es => "Spanish as spoken in Spain",
        Language::Fr => "French",
        Language::De => "German",
        Language::Ja => "Japanese",
        Language::Zh => "Simplified Chinese",
    }
}

fn brief() -> String {
    let tongue = tongue(language::now());
    format!(
        "You title conversations between a person and a coding agent. Reply with the title only, written in {tongue} whatever language the conversation is in: a short phrase of about 3 to 6 words that says what the work is about. No quotes, no final period, no emojis and no prefix such as \"Title:\"."
    )
}

pub fn suggest(root: &Path, id: &str) -> Result<Option<String>, String> {
    let entries = session::read(root, id);
    let Some(opening) = opening(&entries) else {
        return Ok(None);
    };
    let mut args: Vec<String> = ASKING.iter().map(|arg| arg.to_string()).collect();
    args.push(brief());

    let mut asking = claude();
    asking.args(&args);
    let answer: Value = serde_json::from_str(&run(asking, &opening)?).map_err(|error| {
        said!(
            en: "unreadable reply when asking for the title: {error}",
            es: "respuesta ilegible al pedir el título: {error}",
            fr: "réponse illisible à la demande de titre : {error}",
            de: "unlesbare Antwort auf die Titelanfrage: {error}",
            ja: "タイトルを依頼したときの返信を読み取れませんでした: {error}",
            zh: "请求标题时收到了无法读取的回复：{error}",
        )
    })?;
    if answer["is_error"] == true {
        return Err(said!(
            en: "Claude Code couldn’t give the session a title",
            es: "Claude Code no pudo poner título a la sesión",
            fr: "Claude Code n’a pas pu donner de titre à la session",
            de: "Claude Code konnte der Sitzung keinen Titel geben",
            ja: "Claude Code はセッションにタイトルを付けられませんでした",
            zh: "Claude Code 无法为会话设置标题",
        ));
    }
    let title = cleaned(answer["result"].as_str().unwrap_or_default());
    if title.is_empty() {
        return Ok(None);
    }
    if session::named_by(&session::read(root, id)).is_some() {
        return Ok(None);
    }
    session::entitle(root, id, &title, Namer::Ai).map(Some)
}

fn opening(entries: &[Entry]) -> Option<String> {
    if session::named_by(entries).is_some() {
        return None;
    }
    let asked = entries.iter().find_map(|entry| match entry {
        Entry::Task { text, .. } if !text.trim().is_empty() => Some(text.as_str()),
        _ => None,
    })?;
    let answered = entries.iter().find_map(|entry| match entry {
        Entry::Agent { event: Event::Said { text }, .. } if !text.trim().is_empty() => Some(text.as_str()),
        _ => None,
    })?;
    Some(format!(
        "The person's message:\n{}\n\nThe agent's reply:\n{}\n",
        excerpt(asked),
        excerpt(answered)
    ))
}

fn excerpt(text: &str) -> String {
    let text = text.trim();
    match text.char_indices().nth(EXCERPT_CAP) {
        Some((cut, _)) => format!("{}…", &text[..cut]),
        None => text.to_string(),
    }
}

fn cleaned(answer: &str) -> String {
    let line = answer.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or_default();
    let bare = line
        .split_once([':', '：'])
        .filter(|(label, _)| LABELS.contains(&label.trim().to_lowercase().as_str()))
        .map_or(line, |(_, rest)| rest);
    bare.trim().trim_matches(WRAPPERS).trim().trim_end_matches(['.', '。']).trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::language::speaking;

    fn task(text: &str) -> Entry {
        Entry::Task { at: 1, text: text.into(), files: Vec::new(), images: Vec::new() }
    }

    fn said(text: &str) -> Entry {
        Entry::Agent { at: 2, event: Event::Said { text: text.into() } }
    }

    #[test]
    fn a_title_is_asked_only_once_the_first_reply_arrived() {
        assert!(opening(&[task("arregla el login")]).is_none());
        assert!(opening(&[said("hola")]).is_none());

        let asked = opening(&[task("arregla el login"), said("Hecho: el token se renueva antes.")]).unwrap();
        assert!(asked.contains("arregla el login"));
        assert!(asked.contains("el token se renueva antes"));
    }

    #[test]
    fn a_session_already_named_is_never_asked_again() {
        let named = |by| Entry::Titled { at: 3, title: "Login".into(), by };
        assert!(opening(&[task("a"), said("b"), named(Namer::Ai)]).is_none());
        assert!(opening(&[task("a"), said("b"), named(Namer::User)]).is_none());
    }

    #[test]
    fn long_messages_are_cut_before_asking() {
        let asked = opening(&[task(&"á".repeat(5_000)), said("ok")]).unwrap();
        assert!(asked.chars().count() < 2 * EXCERPT_CAP);
        assert!(asked.contains('…'));
    }

    #[test]
    fn the_answer_is_cleaned_of_quotes_labels_and_final_dot() {
        assert_eq!(cleaned("\"Arreglar el login.\""), "Arreglar el login");
        assert_eq!(cleaned("Título: «Modo oscuro»"), "Modo oscuro");
        assert_eq!(cleaned("\n  **Refactor del parser**  \nextra"), "Refactor del parser");
        assert_eq!(cleaned("Hora: 10 y cuarto"), "Hora: 10 y cuarto");
        assert_eq!(cleaned("   "), "");
    }

    #[test]
    fn a_label_or_quotes_in_any_language_sens_speaks_are_cleaned_too() {
        assert_eq!(cleaned("Titre : « Mode sombre »"), "Mode sombre");
        assert_eq!(cleaned("Titel: Dunkler Modus."), "Dunkler Modus");
        assert_eq!(cleaned("タイトル：「ログインの修正」"), "ログインの修正");
        assert_eq!(cleaned("标题：《深色模式》"), "深色模式");
        assert_eq!(cleaned("深色模式。"), "深色模式");
    }

    #[test]
    fn the_title_is_asked_in_the_language_sens_speaks() {
        assert!(speaking(Language::Es, brief).contains("written in Spanish as spoken in Spain"));
        assert!(speaking(Language::Ja, brief).contains("written in Japanese"));
        assert!(speaking(Language::Zh, brief).contains("written in Simplified Chinese"));
        assert!(!speaking(Language::De, brief).contains("French"));
    }
}
