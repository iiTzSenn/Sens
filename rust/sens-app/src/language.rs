use std::path::Path;

use sens_agent::language::{self, Language};
use serde::{Deserialize, Serialize};

const FILE: &str = "language.json";

#[derive(Serialize, Deserialize)]
struct Chosen {
    language: Language,
}

pub fn load(base: &Path) -> Option<Language> {
    let text = std::fs::read_to_string(base.join(FILE)).ok()?;
    serde_json::from_str::<Chosen>(&text).ok().map(|chosen| chosen.language)
}

pub fn save(base: &Path, chosen: Language) -> Result<(), String> {
    crate::store::store(base, FILE, &Chosen { language: chosen })
}

fn spoken(base: Option<&Path>) -> Language {
    base.and_then(load).unwrap_or_else(language::system)
}

pub fn speak(base: Option<&Path>) {
    language::set(spoken(base));
}

pub fn script(chosen: Option<Language>) -> String {
    format!("window.__SENS_LANGUAGE__ = {};", serde_json::to_string(&chosen).unwrap_or_else(|_| "null".into()))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("sens-language-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn a_language_never_chosen_reads_as_none() {
        assert_eq!(load(&temp_root("missing")), None);
    }

    #[test]
    fn a_saved_language_comes_back() {
        let base = temp_root("round-trip").join("datos");
        save(&base, Language::Fr).unwrap();

        assert_eq!(load(&base), Some(Language::Fr));
        let written: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(base.join(FILE)).unwrap()).unwrap();
        assert_eq!(written, serde_json::json!({ "language": "fr" }));
    }

    #[test]
    fn a_language_sens_does_not_speak_or_a_damaged_file_reads_as_none() {
        let base = temp_root("unknown");
        for text in [r#"{"language":"pt"}"#, r#"{"language":"FR"}"#, r#"{"idioma":"fr"}"#, "fr", ""] {
            std::fs::write(base.join(FILE), text).unwrap();

            assert_eq!(load(&base), None, "{text}");
        }
    }

    #[test]
    fn a_language_written_by_the_installer_reads_the_same() {
        let base = temp_root("installer");
        std::fs::write(base.join(FILE), r#"{"language":"ja"}"#).unwrap();

        assert_eq!(load(&base), Some(Language::Ja));
    }

    #[test]
    fn without_a_chosen_language_or_a_data_folder_sens_speaks_the_system_language() {
        let chosen = temp_root("spoken");
        save(&chosen, Language::De).unwrap();

        assert_eq!(spoken(Some(&chosen)), Language::De);
        assert_eq!(spoken(Some(&temp_root("spoken-missing"))), language::system());
        assert_eq!(spoken(None), language::system());
    }

    #[test]
    fn the_page_learns_the_language_before_it_draws() {
        assert_eq!(script(Some(Language::Zh)), r#"window.__SENS_LANGUAGE__ = "zh";"#);
        assert_eq!(script(None), "window.__SENS_LANGUAGE__ = null;");
    }
}
