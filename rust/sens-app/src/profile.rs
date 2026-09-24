use std::path::Path;

use serde::{Deserialize, Serialize};

const FILE: &str = "profile.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    pub name: String,
    pub check_updates: bool,
    pub welcomed: bool,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            name: String::new(),
            check_updates: true,
            welcomed: false,
        }
    }
}

pub fn load(base: &Path) -> Profile {
    crate::store::stored(&base.join(FILE))
}

pub fn rename(base: &Path, name: &str) -> Result<(), String> {
    let profile = Profile {
        name: name.trim().to_string(),
        ..load(base)
    };
    crate::store::store(base, FILE, &profile)
}

pub fn set_update_check(base: &Path, on: bool) -> Result<(), String> {
    let profile = Profile {
        check_updates: on,
        ..load(base)
    };
    crate::store::store(base, FILE, &profile)
}

pub fn set_welcomed(base: &Path, on: bool) -> Result<(), String> {
    let profile = Profile {
        welcomed: on,
        ..load(base)
    };
    crate::store::store(base, FILE, &profile)
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
