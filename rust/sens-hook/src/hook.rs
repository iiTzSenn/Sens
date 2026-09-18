//! The PreToolUse decision, mirroring src/hook.ts.
//!
//! Same rules, same wording, same JSON — the model must not be able to tell
//! which implementation answered:
//!  - Grep for a symbol sens knows -> deny the grep, return every use.
//!  - Grep for anything else -> let it run, just mention sens (once per session).
//!  - Read of an indexed source file -> inject the outline as context.
//!  - Glob -> mention that map/deps orient faster.

use serde::Deserialize;
use serde_json::{json, Value};

use crate::format::{format_symbols, format_who_uses};
use crate::query::Engine;

#[derive(Deserialize, Default)]
pub struct HookPayload {
    #[serde(default)]
    pub hook_event_name: Option<String>,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub tool_input: Option<Value>,
}

pub struct Action {
    pub deny: bool,
    pub message: String,
    /// Generic reminders fire at most once per session per tool.
    pub once: bool,
}

pub const GREP_NUDGE: &str = "sens is indexed for this project. Before grepping, its commands usually answer in one call and far fewer tokens: `sens find <name>` (where a symbol is defined), `sens who <name>` (every call site), `sens exists <keywords>` (is it already there before you write it).";

pub const GLOB_NUDGE: &str = "sens is indexed for this project. `sens map [subdir]` gives a compact map (files + exported symbols) to orient faster than globbing, and `sens deps <file>` finds a file's related files.";

/// A bare symbol name (what a symbol-hunting grep looks like), not a regex.
fn is_identifier(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' || c == '$' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

/// Extensions the TypeScript indexer claims — used only to decide whether a
/// Read is worth outlining. Mirrors PARSERS in indexer/languages/parser.ts.
const INDEXED_EXTENSIONS: [&str; 19] = [
    "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "cs", "c",
    "cpp", "php", "rb", "kt", "h",
];

fn is_indexed_file(path: &str) -> bool {
    path.rsplit('.')
        .next()
        .is_some_and(|ext| INDEXED_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

fn str_field<'a>(input: &'a Option<Value>, key: &str) -> Option<&'a str> {
    input.as_ref()?.get(key)?.as_str()
}

pub fn decide(engine: &Engine, root: &str, payload: &HookPayload) -> Option<Action> {
    match payload.tool_name.as_deref().unwrap_or("") {
        "Grep" => {
            let pattern = str_field(&payload.tool_input, "pattern").unwrap_or("");
            if is_identifier(pattern) {
                let results = engine.who_uses(pattern);
                if !results.is_empty() {
                    let answer = format_who_uses(&results, false);
                    return Some(Action {
                        deny: true,
                        message: format!(
                            "sens answered this without a grep — `{pattern}` (definition + every use):\n\n{answer}\n\nIf you actually meant a text/regex search rather than this symbol, run the search again with a pattern that isn't a bare identifier."
                        ),
                        once: false,
                    });
                }
            }
            Some(Action { deny: false, message: GREP_NUDGE.to_string(), once: true })
        }
        "Read" => {
            let raw = str_field(&payload.tool_input, "file_path").unwrap_or("");
            if raw.is_empty() || !is_indexed_file(raw) {
                return None;
            }
            let file = relative_to(root, raw);
            let syms = engine.file_outline(&file);
            if syms.is_empty() {
                return None;
            }
            Some(Action {
                deny: false,
                message: format!(
                    "sens outline of this file (signatures only) — often enough without reading the whole file:\n\n{}",
                    format_symbols(&syms)
                ),
                once: false,
            })
        }
        "Glob" => Some(Action { deny: false, message: GLOB_NUDGE.to_string(), once: true }),
        _ => None,
    }
}

/// Claude Code passes an absolute path; the index stores root-relative POSIX.
fn relative_to(root: &str, path: &str) -> String {
    let norm = |s: &str| s.replace(std::path::MAIN_SEPARATOR, "/");
    let (root, path) = (norm(root), norm(path));
    path.strip_prefix(&root)
        .map(|r| r.trim_start_matches('/').to_string())
        .unwrap_or(path)
}

pub fn render(action: &Action) -> String {
    let mut out = json!({ "hookEventName": "PreToolUse" });
    if action.deny {
        out["permissionDecision"] = json!("deny");
        out["permissionDecisionReason"] = json!(action.message);
    } else {
        out["additionalContext"] = json!(action.message);
    }
    json!({ "hookSpecificOutput": out }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_bare_symbol_names_but_not_patterns() {
        for good in ["login", "_private", "$el", "Widget2", "a"] {
            assert!(is_identifier(good), "{good} should be an identifier");
        }
        for bad in ["", "foo.*bar", "2fast", "a-b", "foo bar", "a.b", "TODO:"] {
            assert!(!is_identifier(bad), "{bad} should not be an identifier");
        }
    }

    #[test]
    fn recognises_files_the_index_covers() {
        for good in ["a.ts", "b.TSX", "s/c.py", "x.rs", "Main.kt"] {
            assert!(is_indexed_file(good), "{good} should be indexed");
        }
        for bad in ["README.md", "data.json", "notes", "img.png"] {
            assert!(!is_indexed_file(bad), "{bad} should not be indexed");
        }
    }

    #[test]
    fn makes_an_absolute_path_relative_to_the_project() {
        assert_eq!(relative_to("P:/proj", "P:/proj/src/a.ts"), "src/a.ts");
        // Already relative, or outside the project: left as-is rather than guessed.
        assert_eq!(relative_to("P:/proj", "src/a.ts"), "src/a.ts");
        assert_eq!(relative_to("P:/proj", "Q:/other/a.ts"), "Q:/other/a.ts");
    }

    #[test]
    fn renders_a_denial_and_a_hint_differently() {
        let deny = render(&Action { deny: true, message: "no".into(), once: false });
        assert!(deny.contains(r#""permissionDecision":"deny""#));
        assert!(deny.contains(r#""permissionDecisionReason":"no""#));
        assert!(!deny.contains("additionalContext"));

        let hint = render(&Action { deny: false, message: "hi".into(), once: false });
        assert!(hint.contains(r#""additionalContext":"hi""#));
        assert!(!hint.contains("permissionDecision"));

        // Claude Code keys off this; both shapes must carry it.
        assert!(deny.contains(r#""hookEventName":"PreToolUse""#));
        assert!(hint.contains(r#""hookEventName":"PreToolUse""#));
    }
}
