use std::path::Path;

use serde::Serialize;
use serde::de::DeserializeOwned;

pub fn stored<T: DeserializeOwned + Default>(path: &Path) -> T {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn editable<T: DeserializeOwned + Default>(path: &Path) -> Result<T, String> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Ok(T::default());
    };
    serde_json::from_str(&text).map_err(|error| {
        format!("{} está dañado ({error}); arréglalo o bórralo antes de guardar", path.display())
    })
}

pub fn store<T: Serialize>(base: &Path, name: &str, value: &T) -> Result<(), String> {
    std::fs::create_dir_all(base)
        .map_err(|error| format!("no pude crear {}: {error}", base.display()))?;
    let text = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    let path = base.join(name);
    std::fs::write(&path, text)
        .map_err(|error| format!("no pude escribir {}: {error}", path.display()))
}
