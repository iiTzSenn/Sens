use std::cell::Cell;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU8, Ordering};

use serde::{Deserialize, Serialize};

use crate::progress;

const FILE: &str = "language.json";

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    En,
    Es,
    Fr,
    De,
    Ja,
    Zh,
}

const ALL: [Language; 6] = [Language::En, Language::Es, Language::Fr, Language::De, Language::Ja, Language::Zh];

#[derive(Serialize, Deserialize)]
struct Chosen {
    language: Language,
}

static NOW: AtomicU8 = AtomicU8::new(0);

thread_local! {
    static HERE: Cell<Option<Language>> = const { Cell::new(None) };
}

impl Language {
    fn id(self) -> &'static str {
        match self {
            Language::En => "en",
            Language::Es => "es",
            Language::Fr => "fr",
            Language::De => "de",
            Language::Ja => "ja",
            Language::Zh => "zh",
        }
    }

    fn of(tag: &str) -> Option<Language> {
        let base = tag.split(['-', '_']).next().unwrap_or_default().to_ascii_lowercase();
        ALL.into_iter().find(|language| language.id() == base)
    }
}

pub fn read(settings: &Path) -> Option<Language> {
    let text = fs::read_to_string(settings.join(FILE)).ok()?;
    serde_json::from_str::<Chosen>(&text).ok().map(|chosen| chosen.language)
}

pub fn write(settings: &Path, language: Language) -> Result<(), String> {
    fs::create_dir_all(settings).map_err(|error| progress::cannot_create(settings, &error))?;
    let path = settings.join(FILE);
    let text = serde_json::to_string(&Chosen { language }).map_err(|error| error.to_string())?;
    fs::write(&path, text).map_err(|error| progress::cannot_write(&path, &error))
}

pub fn script(saved: Option<Language>) -> String {
    format!("window.__SENS_LANGUAGE__ = {};", serde_json::to_string(&saved).unwrap_or_else(|_| "null".into()))
}

pub fn system() -> Language {
    let tags = system_tags();
    preferred(tags.iter().map(String::as_str))
}

fn preferred<'a>(tags: impl IntoIterator<Item = &'a str>) -> Language {
    tags.into_iter().find_map(Language::of).unwrap_or_default()
}

pub fn set(language: Language) {
    NOW.store(language as u8, Ordering::Relaxed);
}

pub fn now() -> Language {
    HERE.with(Cell::get)
        .unwrap_or_else(|| ALL.get(usize::from(NOW.load(Ordering::Relaxed))).copied().unwrap_or_default())
}

#[cfg(test)]
pub fn speaking<T>(language: Language, work: impl FnOnce() -> T) -> T {
    let before = HERE.replace(Some(language));
    let done = work();
    HERE.set(before);
    done
}

macro_rules! said {
    (en: $en:literal, es: $es:literal, fr: $fr:literal, de: $de:literal, ja: $ja:literal, zh: $zh:literal $(, $name:ident = $value:expr)* $(,)?) => {
        match $crate::language::now() {
            $crate::language::Language::En => format!($en $(, $name = $value)*),
            $crate::language::Language::Es => format!($es $(, $name = $value)*),
            $crate::language::Language::Fr => format!($fr $(, $name = $value)*),
            $crate::language::Language::De => format!($de $(, $name = $value)*),
            $crate::language::Language::Ja => format!($ja $(, $name = $value)*),
            $crate::language::Language::Zh => format!($zh $(, $name = $value)*),
        }
    };
}

pub(crate) use said;

fn system_tags() -> Vec<String> {
    use windows::Win32::Globalization::{GetUserPreferredUILanguages, MUI_LANGUAGE_NAME};
    use windows::core::PWSTR;

    let (mut count, mut size) = (0u32, 0u32);
    if unsafe { GetUserPreferredUILanguages(MUI_LANGUAGE_NAME, &mut count, None, &mut size) }.is_err() {
        return Vec::new();
    }
    let mut buffer = vec![0u16; size as usize];
    if unsafe { GetUserPreferredUILanguages(MUI_LANGUAGE_NAME, &mut count, Some(PWSTR(buffer.as_mut_ptr())), &mut size) }.is_err() {
        return Vec::new();
    }
    String::from_utf16_lossy(&buffer).split('\0').filter(|tag| !tag.is_empty()).map(String::from).collect()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("sens-setup-language-{name}"));
        let _ = fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn the_language_is_written_where_the_app_reads_it_and_comes_back() {
        let settings = temp_root("round-trip").join("dev.sens.desktop");
        write(&settings, Language::De).unwrap();

        assert_eq!(fs::read_to_string(settings.join("language.json")).unwrap(), r#"{"language":"de"}"#);
        assert_eq!(read(&settings), Some(Language::De));
    }

    #[test]
    fn no_saved_language_or_one_sens_does_not_speak_reads_as_none() {
        assert_eq!(read(&temp_root("missing")), None);
        let settings = temp_root("unknown");
        fs::create_dir_all(&settings).unwrap();
        for text in [r#"{"language":"pt"}"#, "idioma: es", ""] {
            fs::write(settings.join(FILE), text).unwrap();

            assert_eq!(read(&settings), None, "{text}");
        }
    }

    #[test]
    fn the_page_learns_the_saved_language_or_that_there_is_none() {
        assert_eq!(script(Some(Language::Ja)), r#"window.__SENS_LANGUAGE__ = "ja";"#);
        assert_eq!(script(None), "window.__SENS_LANGUAGE__ = null;");
    }

    #[test]
    fn the_first_language_windows_prefers_that_sens_speaks_wins_else_english() {
        assert_eq!(preferred(["pt-BR", "fr-CA", "en-US"]), Language::Fr);
        assert_eq!(preferred(["zh-Hans-CN"]), Language::Zh);
        assert_eq!(preferred(["ru-RU"]), Language::En);
        assert_eq!(preferred([]), Language::En);
    }

    #[test]
    fn a_line_is_said_in_the_language_spoken_now_and_english_by_default() {
        let hello = || said!(en: "Hello", es: "Hola", fr: "Bonjour", de: "Hallo", ja: "こんにちは", zh: "你好");

        assert_eq!(hello(), "Hello");
        assert_eq!(speaking(Language::Es, hello), "Hola");
        assert_eq!(speaking(Language::Zh, hello), "你好");
        assert_eq!(std::thread::spawn(hello).join().unwrap(), "Hello");
    }
}
