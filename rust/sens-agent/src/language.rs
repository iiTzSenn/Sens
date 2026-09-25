use std::cell::Cell;
use std::sync::atomic::{AtomicU8, Ordering};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
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

pub const ALL: [Language; 6] = [Language::En, Language::Es, Language::Fr, Language::De, Language::Ja, Language::Zh];

static NOW: AtomicU8 = AtomicU8::new(0);

thread_local! {
    static HERE: Cell<Option<Language>> = const { Cell::new(None) };
}

impl Language {
    pub fn id(self) -> &'static str {
        match self {
            Language::En => "en",
            Language::Es => "es",
            Language::Fr => "fr",
            Language::De => "de",
            Language::Ja => "ja",
            Language::Zh => "zh",
        }
    }

    pub fn of(tag: &str) -> Option<Language> {
        let base = tag.split(['-', '_']).next().unwrap_or_default().to_ascii_lowercase();
        ALL.into_iter().find(|language| language.id() == base)
    }
}

pub fn preferred<'a>(tags: impl IntoIterator<Item = &'a str>) -> Language {
    tags.into_iter().find_map(Language::of).unwrap_or_default()
}

pub fn system() -> Language {
    let tags = system_tags();
    preferred(tags.iter().map(String::as_str))
}

pub fn set(language: Language) {
    NOW.store(language as u8, Ordering::Relaxed);
}

pub fn now() -> Language {
    HERE.with(Cell::get)
        .unwrap_or_else(|| ALL.get(usize::from(NOW.load(Ordering::Relaxed))).copied().unwrap_or_default())
}

struct Spoken(Option<Language>);

impl Drop for Spoken {
    fn drop(&mut self) {
        HERE.set(self.0);
    }
}

pub fn speaking<T>(language: Language, work: impl FnOnce() -> T) -> T {
    let _before = Spoken(HERE.replace(Some(language)));
    work()
}

#[macro_export]
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

#[cfg(windows)]
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

#[cfg(not(windows))]
fn system_tags() -> Vec<String> {
    ["LC_ALL", "LC_MESSAGES", "LANG"].iter().filter_map(|name| std::env::var(name).ok()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved(folder: &str, count: usize) -> String {
        said!(
            en: "Saved {count} files in {folder}",
            es: "Guardados {count} ficheros en {folder}",
            fr: "{count} fichiers enregistrés dans {folder}",
            de: "{count} Dateien in {folder} gespeichert",
            ja: "{folder} に {count} 個のファイルを保存しました",
            zh: "已在 {folder} 中保存 {count} 个文件",
        )
    }

    #[test]
    fn a_language_travels_as_its_two_letter_id() {
        let ids: Vec<String> = ALL.iter().map(|language| serde_json::to_string(language).unwrap()).collect();

        assert_eq!(ids, ["\"en\"", "\"es\"", "\"fr\"", "\"de\"", "\"ja\"", "\"zh\""]);
        assert_eq!(serde_json::from_str::<Language>("\"ja\"").unwrap(), Language::Ja);
        assert!(serde_json::from_str::<Language>("\"pt\"").is_err());
        assert!(ALL.iter().all(|language| Language::of(language.id()) == Some(*language)));
    }

    #[test]
    fn a_tag_names_its_language_by_its_base() {
        assert_eq!(Language::of("fr-CA"), Some(Language::Fr));
        assert_eq!(Language::of("zh_Hans_CN"), Some(Language::Zh));
        assert_eq!(Language::of("DE"), Some(Language::De));
        assert_eq!(Language::of("pt-BR"), None);
        assert_eq!(Language::of(""), None);
    }

    #[test]
    fn the_first_preferred_language_sens_speaks_wins_else_english() {
        assert_eq!(preferred(["pt-BR", "de-AT", "es-ES"]), Language::De);
        assert_eq!(preferred(["ja-JP"]), Language::Ja);
        assert_eq!(preferred(["pt-BR", "ru"]), Language::En);
        assert_eq!(preferred([]), Language::En);
    }

    #[test]
    fn english_is_spoken_until_told_otherwise() {
        assert_eq!(Language::default(), Language::En);
        assert_eq!(now(), Language::En);
    }

    #[test]
    fn a_message_is_said_in_the_language_spoken_now() {
        assert_eq!(saved("C:/code", 3), "Saved 3 files in C:/code");
        assert_eq!(speaking(Language::Es, || saved("C:/code", 3)), "Guardados 3 ficheros en C:/code");
        assert_eq!(speaking(Language::Fr, || saved("C:/code", 3)), "3 fichiers enregistrés dans C:/code");
        assert_eq!(speaking(Language::De, || saved("C:/code", 3)), "3 Dateien in C:/code gespeichert");
        assert_eq!(speaking(Language::Ja, || saved("C:/code", 3)), "C:/code に 3 個のファイルを保存しました");
        assert_eq!(speaking(Language::Zh, || saved("C:/code", 3)), "已在 C:/code 中保存 3 个文件");
        assert_eq!(now(), Language::En);
    }

    #[test]
    fn a_message_can_name_the_values_it_carries() {
        let path = std::path::Path::new("C:/Sens");
        let error = "denied";
        let line = |language| {
            speaking(language, || {
                said!(
                    en: "Could not write {path}: {error}",
                    es: "No pude escribir {path}: {error}",
                    fr: "Impossible d’écrire {path} : {error}",
                    de: "{path} konnte nicht geschrieben werden: {error}",
                    ja: "{path} に書き込めませんでした: {error}",
                    zh: "无法写入 {path}：{error}",
                    path = path.display(),
                )
            })
        };

        assert_eq!(line(Language::En), "Could not write C:/Sens: denied");
        assert_eq!(line(Language::Fr), "Impossible d’écrire C:/Sens : denied");
        assert_eq!(line(Language::Zh), "无法写入 C:/Sens：denied");
    }

    #[test]
    fn a_language_spoken_on_one_thread_stays_on_it() {
        speaking(Language::Ja, || {
            assert_eq!(now(), Language::Ja);
            assert_eq!(std::thread::spawn(now).join().unwrap(), Language::En);
            speaking(Language::De, || assert_eq!(now(), Language::De));
            assert_eq!(now(), Language::Ja);
        });
        assert_eq!(now(), Language::En);
    }

    #[test]
    fn a_language_spoken_for_work_that_panics_does_not_stay_behind() {
        let panicked = std::panic::catch_unwind(|| speaking(Language::De, || panic!("roto")));

        assert!(panicked.is_err());
        assert_eq!(now(), Language::En);
    }
}
