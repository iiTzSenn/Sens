use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const SYSTEM_SLOT: &str = "{system}";

pub const CLAUDE_CODE: &str = "claude -p --system-prompt {system} --disallowedTools Bash Edit Write Read Glob Grep Task TodoWrite WebFetch WebSearch NotebookEdit";

const ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";
const MAX_TOKENS: u32 = 8000;

#[derive(Deserialize, Serialize, Clone, PartialEq, Debug)]
pub struct Edit {
    pub path: String,
    pub after: String,
}

#[derive(Clone, PartialEq, Debug, Default)]
pub struct Proposal {
    pub files: Vec<Edit>,
    pub note: String,
}

impl Proposal {
    pub fn paths(&self) -> Vec<&str> {
        self.files.iter().map(|edit| edit.path.as_str()).collect()
    }

    pub fn touches(&self, path: &str) -> Option<&Edit> {
        self.files.iter().find(|edit| edit.path == path)
    }
}

pub trait Model {
    fn name(&self) -> &str;
    fn propose(&self, system: &str, user: &str) -> Result<Proposal, String>;
}

pub struct Anthropic {
    pub key: String,
    pub model: String,
    pub think: u32,
}

impl Anthropic {
    pub fn new(key: impl Into<String>, model: impl Into<String>, think: u32) -> Self {
        Self {
            key: key.into(),
            model: model.into(),
            think,
        }
    }
}

impl Model for Anthropic {
    fn name(&self) -> &str {
        &self.model
    }

    fn propose(&self, system: &str, user: &str) -> Result<Proposal, String> {
        let mut body = json!({
            "model": self.model,
            "max_tokens": MAX_TOKENS + self.think,
            "system": system,
            "messages": [{ "role": "user", "content": user }]
        });
        if self.think > 0 {
            body["thinking"] = json!({ "type": "enabled", "budget_tokens": self.think });
        }

        let mut response = ureq::post(ENDPOINT)
            .header("x-api-key", self.key.as_str())
            .header("anthropic-version", API_VERSION)
            .header("content-type", "application/json")
            .send_json(&body)
            .map_err(|error| format!("{} no respondió: {error}", self.model))?;

        let value: Value = response
            .body_mut()
            .read_json()
            .map_err(|error| format!("respuesta ilegible: {error}"))?;

        let text = said(&value).ok_or_else(|| format!("respuesta sin texto: {value}"))?;

        parse_proposal(text)
    }
}

fn said(value: &Value) -> Option<&str> {
    value["content"]
        .as_array()?
        .iter()
        .find(|block| block["type"] == "text")
        .and_then(|block| block["text"].as_str())
}

pub fn parse_proposal(text: &str) -> Result<Proposal, String> {
    let object = first_object(text).ok_or("la respuesta no trae JSON")?;
    let value: Value =
        serde_json::from_str(object).map_err(|error| format!("JSON inválido: {error}"))?;

    let files: Vec<Edit> = match value.get("files").and_then(Value::as_array) {
        Some(listed) => listed.iter().filter_map(edit_from).collect(),
        None => edit_from(&value).into_iter().collect(),
    };

    if files.is_empty() {
        return Err("la propuesta no dice qué ficheros toca".into());
    }

    let mut seen = std::collections::HashSet::new();
    if let Some(twice) = files.iter().find(|edit| !seen.insert(edit.path.as_str())) {
        return Err(format!("{} aparece dos veces en la propuesta", twice.path));
    }

    Ok(Proposal {
        files,
        note: value["note"].as_str().unwrap_or_default().to_string(),
    })
}

fn edit_from(value: &Value) -> Option<Edit> {
    let path = value.get("path")?.as_str()?.trim();
    if path.is_empty() {
        return None;
    }
    Some(Edit {
        path: path.to_string(),
        after: value.get("after")?.as_str()?.to_string(),
    })
}

pub fn first_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let mut depth = 0usize;
    let mut inside_string = false;
    let mut escaped = false;

    for (offset, character) in text[start..].char_indices() {
        if inside_string {
            match character {
                _ if escaped => escaped = false,
                '\\' => escaped = true,
                '"' => inside_string = false,
                _ => {}
            }
            continue;
        }
        match character {
            '"' => inside_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[start..=start + offset]);
                }
            }
            _ => {}
        }
    }
    None
}

pub struct Cli {
    pub program: String,
    pub args: Vec<String>,
    pub label: String,
}

impl Cli {
    pub fn parse(command: &str) -> Result<Self, String> {
        let mut parts = split(command).into_iter();
        let program = parts.next().ok_or("no dijiste qué programa lanzar")?;
        Ok(Self {
            args: parts.collect(),
            label: program.clone(),
            program,
        })
    }

    pub fn claude() -> Self {
        Cli::parse(CLAUDE_CODE).expect("preset")
    }

    fn fill(&self, system: &str) -> (Vec<String>, bool) {
        let mut carried = false;
        let args = self
            .args
            .iter()
            .map(|arg| {
                if arg == SYSTEM_SLOT {
                    carried = true;
                    return system.to_string();
                }
                arg.clone()
            })
            .collect();
        (args, carried)
    }
}

impl Model for Cli {
    fn name(&self) -> &str {
        &self.label
    }

    fn propose(&self, system: &str, user: &str) -> Result<Proposal, String> {
        use std::io::Write;
        use std::process::{Command, Stdio};

        let (args, carried) = self.fill(system);
        let prompt = if carried {
            user.to_string()
        } else {
            format!("{system}\n\n---\n\n{user}")
        };

        let mut child = Command::new(&self.program)
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("no pude lanzar {}: {error}", self.program))?;

        child
            .stdin
            .take()
            .ok_or("el proceso no acepta entrada")?
            .write_all(prompt.as_bytes())
            .map_err(|error| format!("no pude hablar con {}: {error}", self.program))?;

        let finished = child
            .wait_with_output()
            .map_err(|error| format!("{} se cayó: {error}", self.program))?;

        if !finished.status.success() {
            let complaint = String::from_utf8_lossy(&finished.stderr);
            return Err(format!("{} falló: {}", self.program, complaint.trim()));
        }

        parse_proposal(&String::from_utf8_lossy(&finished.stdout))
    }
}

pub fn split(command: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;

    for character in command.chars() {
        match (quote, character) {
            (Some(open), c) if c == open => quote = None,
            (Some(_), c) => current.push(c),
            (None, '"') | (None, '\'') => quote = Some(character),
            (None, c) if c.is_whitespace() => {
                if !current.is_empty() {
                    parts.push(std::mem::take(&mut current));
                }
            }
            (None, c) => current.push(c),
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }
    parts
}

pub struct Scripted {
    pub replies: std::cell::RefCell<Vec<Proposal>>,
}

impl Scripted {
    pub fn new(replies: Vec<Proposal>) -> Self {
        Self {
            replies: std::cell::RefCell::new(replies),
        }
    }
}

impl Model for Scripted {
    fn name(&self) -> &str {
        "scripted"
    }

    fn propose(&self, _system: &str, _user: &str) -> Result<Proposal, String> {
        let mut replies = self.replies.borrow_mut();
        if replies.is_empty() {
            return Err("el guion se quedó sin respuestas".into());
        }
        Ok(replies.remove(0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_proposal_wrapped_in_prose_and_fences() {
        let raw = "Claro, aquí va:\n```json\n{\"path\":\"src/a.rs\",\"after\":\"fn a() {}\\n\",\"note\":\"listo\"}\n```\nEspero que sirva.";
        let proposal = parse_proposal(raw).unwrap();
        assert_eq!(proposal.paths(), vec!["src/a.rs"]);
        assert_eq!(proposal.files[0].after, "fn a() {}\n");
        assert_eq!(proposal.note, "listo");
    }

    #[test]
    fn a_proposal_without_a_file_is_refused() {
        let raw = "{\"path\":\"  \",\"after\":\"fn a() {}\"}";
        assert!(parse_proposal(raw).is_err());
    }

    #[test]
    fn prose_with_no_json_is_refused() {
        assert!(parse_proposal("no me apetece").is_err());
    }

    #[test]
    fn a_note_is_optional() {
        let proposal = parse_proposal("{\"path\":\"a.rs\",\"after\":\"\"}").unwrap();
        assert_eq!(proposal.note, "");
    }

    #[test]
    fn prose_after_the_json_does_not_confuse_the_parser() {
        let raw = "{\"path\":\"a.rs\",\"after\":\"fn a() {}\\n\"}\n\nNota: revisa {esto} luego.";
        let proposal = parse_proposal(raw).unwrap();
        assert_eq!(proposal.paths(), vec!["a.rs"]);
        assert_eq!(proposal.files[0].after, "fn a() {}\n");
    }

    #[test]
    fn braces_inside_the_code_do_not_close_the_object_early() {
        let raw = "{\"path\":\"a.rs\",\"after\":\"fn a() { if b { c() } }\",\"note\":\"ok\"}";
        let proposal = parse_proposal(raw).unwrap();
        assert_eq!(proposal.files[0].after, "fn a() { if b { c() } }");
    }

    #[test]
    fn an_escaped_quote_inside_the_code_survives() {
        let raw = "{\"path\":\"a.rs\",\"after\":\"println!(\\\"hola\\\");\"}";
        let proposal = parse_proposal(raw).unwrap();
        assert_eq!(proposal.files[0].after, "println!(\"hola\");");
    }

    #[test]
    fn a_second_object_after_the_first_is_ignored() {
        let raw = "{\"path\":\"a.rs\",\"after\":\"x\"}\n{\"path\":\"b.rs\",\"after\":\"y\"}";
        assert_eq!(parse_proposal(raw).unwrap().paths(), vec!["a.rs"]);
    }

    #[test]
    fn an_unfinished_object_is_refused_instead_of_guessed() {
        assert!(parse_proposal("{\"path\":\"a.rs\",\"after\":\"x\"").is_err());
    }

    #[test]
    fn a_proposal_can_carry_several_files() {
        let raw = "{\"files\":[{\"path\":\"a.rs\",\"after\":\"fn a() {}\"},{\"path\":\"b.rs\",\"after\":\"fn b() {}\"}],\"note\":\"dos\"}";
        let proposal = parse_proposal(raw).unwrap();

        assert_eq!(proposal.paths(), vec!["a.rs", "b.rs"]);
        assert_eq!(proposal.note, "dos");
    }

    #[test]
    fn the_old_single_file_shape_still_works() {
        let proposal = parse_proposal("{\"path\":\"a.rs\",\"after\":\"x\"}").unwrap();
        assert_eq!(proposal.paths(), vec!["a.rs"]);
    }

    #[test]
    fn the_same_file_listed_twice_is_refused() {
        let raw = "{\"files\":[{\"path\":\"a.rs\",\"after\":\"x\"},{\"path\":\"a.rs\",\"after\":\"y\"}]}";
        assert!(parse_proposal(raw).unwrap_err().contains("dos veces"));
    }

    #[test]
    fn an_entry_without_content_is_dropped_instead_of_guessed() {
        let raw = "{\"files\":[{\"path\":\"a.rs\"},{\"path\":\"b.rs\",\"after\":\"y\"}]}";
        assert_eq!(parse_proposal(raw).unwrap().paths(), vec!["b.rs"]);
    }

    #[test]
    fn a_command_splits_into_program_and_arguments() {
        let cli = Cli::parse("claude -p --model sonnet").unwrap();
        assert_eq!(cli.program, "claude");
        assert_eq!(cli.args, vec!["-p", "--model", "sonnet"]);
    }

    #[test]
    fn a_quoted_argument_survives_its_spaces() {
        assert_eq!(
            split("ollama run \"qwen 3 coder\""),
            vec!["ollama", "run", "qwen 3 coder"]
        );
    }

    #[test]
    fn an_empty_command_is_refused() {
        assert!(Cli::parse("   ").is_err());
    }

    #[test]
    fn the_system_prompt_replaces_its_slot_in_the_arguments() {
        let cli = Cli::parse("claude -p --system-prompt {system} --model sonnet").unwrap();
        let (args, carried) = cli.fill("eres el motor");

        assert!(carried);
        assert_eq!(args, vec!["-p", "--system-prompt", "eres el motor", "--model", "sonnet"]);
    }

    #[test]
    fn a_command_without_a_slot_gets_the_system_prompt_through_stdin() {
        let cli = Cli::parse("ollama run qwen").unwrap();
        let (args, carried) = cli.fill("eres el motor");

        assert!(!carried);
        assert_eq!(args, vec!["run", "qwen"]);
    }

    #[test]
    fn the_claude_preset_denies_every_tool_that_touches_the_disk() {
        let cli = Cli::claude();
        assert_eq!(cli.program, "claude");
        for forbidden in ["Edit", "Write", "Bash", "NotebookEdit"] {
            assert!(cli.args.iter().any(|arg| arg == forbidden), "falta {forbidden}");
        }
    }

    #[test]
    fn a_program_that_does_not_exist_says_so_instead_of_panicking() {
        let cli = Cli::parse("sens-no-such-program-exists").unwrap();
        let failure = cli.propose("s", "u").unwrap_err();
        assert!(failure.contains("no pude lanzar"));
    }
}
