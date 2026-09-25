use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::Theme;
use tauri::window::Color;

const FILE: &str = "look.json";
const FIRST_ACCENT: &str = "signal";
const LONGEST_ACCENT: usize = 24;
const DARK_GROUND: Color = Color(0x0c, 0x0d, 0x0d, 0xff);
const LIGHT_GROUND: Color = Color(0xff, 0xff, 0xff, 0xff);

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    #[default]
    Dark,
    Light,
    System,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Look {
    pub mode: Mode,
    pub accent: String,
}

impl Default for Look {
    fn default() -> Self {
        Self {
            mode: Mode::Dark,
            accent: FIRST_ACCENT.into(),
        }
    }
}

impl Look {
    fn tidy(self) -> Look {
        let named = !self.accent.is_empty() && self.accent.len() <= LONGEST_ACCENT && self.accent.bytes().all(|byte| byte.is_ascii_lowercase());
        Look {
            accent: if named { self.accent } else { FIRST_ACCENT.into() },
            ..self
        }
    }

    pub fn theme(&self) -> Option<Theme> {
        match self.mode {
            Mode::Dark => Some(Theme::Dark),
            Mode::Light => Some(Theme::Light),
            Mode::System => None,
        }
    }

    pub fn script(&self) -> String {
        format!("window.__SENS_LOOK__ = {};", serde_json::to_string(self).unwrap_or_else(|_| "null".into()))
    }
}

pub fn ground(theme: Theme) -> Color {
    if theme == Theme::Light { LIGHT_GROUND } else { DARK_GROUND }
}

pub fn load(base: &Path) -> Look {
    crate::store::stored::<Look>(&base.join(FILE)).tidy()
}

pub fn save(base: &Path, look: Look) -> Result<(), String> {
    crate::store::store(base, FILE, &look.tidy())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("sens-look-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn a_missing_look_is_dark_with_signal() {
        assert_eq!(load(&temp_root("missing")), Look::default());
        assert_eq!(Look::default().mode, Mode::Dark);
        assert_eq!(Look::default().accent, "signal");
    }

    #[test]
    fn a_saved_look_comes_back() {
        let base = temp_root("round-trip").join("datos");
        let look = Look {
            mode: Mode::Light,
            accent: "iris".into(),
        };
        save(&base, look.clone()).unwrap();

        assert_eq!(load(&base), look);
    }

    #[test]
    fn a_corrupt_or_unknown_mode_falls_back_to_the_first_look() {
        let base = temp_root("corrupt");
        std::fs::write(base.join(FILE), r#"{ "mode": "sepia", "accent": "iris" }"#).unwrap();

        assert_eq!(load(&base), Look::default());
    }

    #[test]
    fn an_accent_that_is_not_a_plain_word_becomes_signal() {
        let base = temp_root("accent");
        for accent in ["", "Iris", "iris-2", "../x", "a".repeat(40).as_str()] {
            std::fs::write(base.join(FILE), format!(r#"{{ "mode": "system", "accent": {accent:?} }}"#)).unwrap();

            let look = load(&base);
            assert_eq!(look.mode, Mode::System, "{accent}");
            assert_eq!(look.accent, "signal", "{accent}");
        }
    }

    #[test]
    fn a_look_written_by_the_installer_reads_the_same() {
        let base = temp_root("installer");
        std::fs::write(base.join(FILE), r#"{"mode":"system","accent":"rose"}"#).unwrap();

        assert_eq!(
            load(&base),
            Look {
                mode: Mode::System,
                accent: "rose".into()
            }
        );
    }

    #[test]
    fn the_window_follows_the_mode() {
        let look = |mode| Look { mode, ..Look::default() };
        assert_eq!(look(Mode::Dark).theme(), Some(Theme::Dark));
        assert_eq!(look(Mode::Light).theme(), Some(Theme::Light));
        assert_eq!(look(Mode::System).theme(), None);
        assert_eq!(ground(Theme::Light), LIGHT_GROUND);
        assert_eq!(ground(Theme::Dark), DARK_GROUND);
    }

    #[test]
    fn the_page_learns_the_look_before_it_draws() {
        let script = Look {
            mode: Mode::Light,
            accent: "ice".into(),
        }
        .script();

        assert_eq!(script, r#"window.__SENS_LOOK__ = {"mode":"light","accent":"ice"};"#);
    }
}
