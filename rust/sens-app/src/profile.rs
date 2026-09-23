use std::path::Path;

use serde::{Deserialize, Serialize};

const FILE: &str = "profile.json";

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: String,
}

pub fn load(base: &Path) -> Profile {
    crate::store::stored(&base.join(FILE))
}

pub fn save(base: &Path, profile: &Profile) -> Result<(), String> {
    let trimmed = Profile {
        name: profile.name.trim().to_string(),
    };
    crate::store::store(base, FILE, &trimmed)
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
        save(&base, &Profile { name: "  Sofía García \n".into() }).unwrap();

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
}
