use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::update;

const FILE: &str = "profile.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    pub name: String,
    pub check_updates: bool,
    pub welcomed: bool,
    pub seen: String,
    pub notify: bool,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            name: String::new(),
            check_updates: true,
            welcomed: false,
            seen: String::new(),
            notify: true,
        }
    }
}

impl Profile {
    pub fn owes_news(&self, version: &str) -> bool {
        self.welcomed && update::number(version) > update::number(&self.seen)
    }

    pub fn script(&self) -> String {
        format!("window.__SENS_WELCOMED__ = {}; window.__SENS_NEWS__ = {};", self.welcomed, self.owes_news(update::current()))
    }
}

pub fn load(base: &Path) -> Profile {
    crate::store::stored(&base.join(FILE))
}

pub fn rename(base: &Path, name: &str) -> Result<(), String> {
    change(base, |profile| profile.name = name.trim().to_string())
}

pub fn set_update_check(base: &Path, on: bool) -> Result<(), String> {
    change(base, |profile| profile.check_updates = on)
}

pub fn set_notify(base: &Path, on: bool) -> Result<(), String> {
    change(base, |profile| profile.notify = on)
}

pub fn set_welcomed(base: &Path, on: bool) -> Result<(), String> {
    change(base, |profile| {
        profile.welcomed = on;
        if on {
            profile.seen = update::current().to_string();
        }
    })
}

pub fn saw_news(base: &Path) -> Result<(), String> {
    change(base, |profile| profile.seen = update::current().to_string())
}

fn change(base: &Path, apply: impl FnOnce(&mut Profile)) -> Result<(), String> {
    crate::store::update(base, FILE, |profile: &mut Profile| {
        apply(profile);
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("sens-profile-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn a_saved_name_comes_back_without_surrounding_spaces() {
        let base = temp_root("round-trip").join("datos");
        rename(&base, "  Sofía García \n").unwrap();

        assert_eq!(load(&base).name, "Sofía García");
    }

    #[test]
    fn a_missing_profile_loads_without_a_name() {
        assert_eq!(load(&temp_root("missing")).name, "");
    }

    #[test]
    fn a_corrupt_profile_loads_without_a_name() {
        let base = temp_root("corrupt");
        std::fs::write(base.join(FILE), "nombre: Sofía").unwrap();

        assert_eq!(load(&base).name, "");
    }

    #[test]
    fn a_profile_saved_before_the_switch_existed_checks_for_updates() {
        let base = temp_root("before-switch");
        std::fs::write(base.join(FILE), r#"{ "name": "Sofía" }"#).unwrap();

        assert!(load(&base).check_updates);
    }

    #[test]
    fn notices_are_on_until_switched_off_even_for_a_profile_from_before_them() {
        let base = temp_root("notify");
        std::fs::write(base.join(FILE), r#"{ "name": "Sofía", "checkUpdates": false }"#).unwrap();
        assert!(load(&base).notify);

        set_notify(&base, false).unwrap();

        let saved = load(&base);
        assert!(!saved.notify);
        assert!(!saved.check_updates);
        assert_eq!(saved.name, "Sofía");
    }

    #[test]
    fn renaming_keeps_the_update_switch_and_switching_keeps_the_name() {
        let base = temp_root("both");
        set_update_check(&base, false).unwrap();
        rename(&base, "Sofía").unwrap();

        assert!(!load(&base).check_updates);

        set_update_check(&base, true).unwrap();

        assert_eq!(load(&base).name, "Sofía");
    }

    #[test]
    fn a_profile_saved_before_the_welcome_existed_has_not_been_welcomed() {
        let base = temp_root("before-welcome");
        std::fs::write(base.join(FILE), r#"{ "name": "Sofía", "checkUpdates": false }"#).unwrap();

        let profile = load(&base);
        assert!(!profile.welcomed);
        assert!(!profile.check_updates);
        assert!(!load(&temp_root("welcome-missing")).welcomed);
    }

    #[test]
    fn the_page_learns_before_it_draws_whether_to_welcome() {
        let base = temp_root("script");
        assert_eq!(load(&base).script(), "window.__SENS_WELCOMED__ = false; window.__SENS_NEWS__ = false;");

        set_welcomed(&base, true).unwrap();
        assert_eq!(load(&base).script(), "window.__SENS_WELCOMED__ = true; window.__SENS_NEWS__ = false;");
    }

    #[test]
    fn the_page_learns_before_it_draws_whether_to_tell_the_news() {
        let base = temp_root("script-news");
        std::fs::write(base.join(FILE), r#"{ "welcomed": true, "seen": "0.0.1" }"#).unwrap();

        assert_eq!(load(&base).script(), "window.__SENS_WELCOMED__ = true; window.__SENS_NEWS__ = true;");
    }

    #[test]
    fn news_are_owed_once_for_each_newer_version() {
        let seen = Profile { welcomed: true, seen: "0.19.2".into(), ..Profile::default() };

        assert!(seen.owes_news("0.20.0"));
        assert!(seen.owes_news("0.19.10"));
        assert!(!seen.owes_news("0.19.2"));
        assert!(!seen.owes_news("0.19.1"));
    }

    #[test]
    fn a_profile_saved_before_the_news_existed_is_owed_the_installed_version() {
        let base = temp_root("before-news");
        std::fs::write(base.join(FILE), r#"{ "name": "Sofía", "welcomed": true }"#).unwrap();

        assert!(load(&base).owes_news("0.20.0"));
    }

    #[test]
    fn nothing_is_owed_before_the_welcome() {
        assert!(!Profile::default().owes_news("0.20.0"));
    }

    #[test]
    fn the_news_seen_are_the_running_version_and_keep_the_rest() {
        let base = temp_root("saw-news");
        std::fs::write(base.join(FILE), r#"{ "name": "Sofía", "checkUpdates": false, "welcomed": true }"#).unwrap();
        saw_news(&base).unwrap();

        let profile = load(&base);
        assert_eq!(profile.seen, update::current());
        assert!(!profile.owes_news(update::current()));
        assert_eq!(profile.name, "Sofía");
        assert!(!profile.check_updates);
        assert!(profile.welcomed);
    }

    #[test]
    fn a_new_install_owes_no_news_for_the_version_it_was_welcomed_in() {
        let base = temp_root("welcomed-news");
        set_welcomed(&base, true).unwrap();

        assert!(!load(&base).owes_news(update::current()));
    }

    #[test]
    fn the_welcome_is_remembered_and_renaming_or_switching_keeps_it() {
        let base = temp_root("welcomed");
        set_welcomed(&base, true).unwrap();
        rename(&base, "Sofía").unwrap();
        set_update_check(&base, false).unwrap();

        let profile = load(&base);
        assert!(profile.welcomed);
        assert_eq!(profile.name, "Sofía");

        set_welcomed(&base, false).unwrap();

        let profile = load(&base);
        assert!(!profile.welcomed);
        assert_eq!(profile.name, "Sofía");
        assert!(!profile.check_updates);
    }
}
