use std::path::Path;

use serde_json::Value;

use crate::chat::Event;
use crate::process::{claude, run};
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

const BRIEF: &str = "Pones título a conversaciones entre una persona y un agente de programación. Responde solo con el título: de 3 a 6 palabras, en el idioma de la persona, que diga de qué trata el trabajo. Sin comillas, sin punto final, sin emojis y sin prefijos como \"Título:\".";

const EXCERPT_CAP: usize = 1_500;
const WRAPPERS: &[char] = &['"', '\'', '«', '»', '“', '”', '*', '`', '#'];

pub fn suggest(root: &Path, id: &str) -> Result<Option<String>, String> {
    let entries = session::read(root, id);
    let Some(opening) = opening(&entries) else {
        return Ok(None);
    };
    let mut args: Vec<String> = ASKING.iter().map(|arg| arg.to_string()).collect();
    args.push(BRIEF.to_string());

    let mut asking = claude();
    asking.args(&args);
    let answer: Value = serde_json::from_str(&run(asking, &opening)?)
        .map_err(|error| format!("respuesta ilegible al pedir el título: {error}"))?;
    if answer["is_error"] == true {
        return Err("Claude Code no pudo poner título a la sesión".into());
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
        "Mensaje de la persona:\n{}\n\nRespuesta del agente:\n{}\n",
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
        .split_once(':')
        .filter(|(label, _)| ["título", "titulo", "title"].contains(&label.trim().to_lowercase().as_str()))
        .map_or(line, |(_, rest)| rest);
    bare.trim().trim_matches(WRAPPERS).trim().trim_end_matches('.').trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
