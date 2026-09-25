use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::progress;

const FILE: &str = "look.json";

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    Dark,
    Light,
    System,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct Look {
    pub mode: Mode,
    pub accent: String,
}

pub fn read(settings: &Path) -> Option<Look> {
    let text = fs::read_to_string(settings.join(FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn write(settings: &Path, look: &Look) -> Result<(), String> {
    fs::create_dir_all(settings).map_err(|error| progress::cannot_create(settings, &error))?;
    let path = settings.join(FILE);
    let text = serde_json::to_string(look).map_err(|error| error.to_string())?;
    fs::write(&path, text).map_err(|error| progress::cannot_write(&path, &error))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("sens-setup-look-{name}"));
        let _ = fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn the_look_is_written_where_the_app_reads_it_and_comes_back() {
        let settings = temp_root("round-trip").join("dev.sens.desktop");
        let look = Look {
            mode: Mode::Light,
            accent: "iris".into(),
        };
        write(&settings, &look).unwrap();

        assert_eq!(fs::read_to_string(settings.join("look.json")).unwrap(), r#"{"mode":"light","accent":"iris"}"#);
        assert_eq!(read(&settings), Some(look));
    }

    #[test]
    fn no_saved_look_reads_as_none() {
        assert_eq!(read(&temp_root("missing")), None);
    }

    #[test]
    fn a_damaged_look_reads_as_none() {
        let settings = temp_root("damaged");
        fs::create_dir_all(&settings).unwrap();
        fs::write(settings.join(FILE), "modo: claro").unwrap();

        assert_eq!(read(&settings), None);
    }
}
