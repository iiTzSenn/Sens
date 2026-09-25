use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::Serialize;
use winreg::RegKey;
use winreg::enums::HKEY_CURRENT_USER;

use crate::language::said;
use crate::layout::{APP, Layout};

const PRODUCT: &str = "Sens";
const PUBLISHER: &str = "sens";

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub version: String,
    pub dir: String,
}

fn user() -> RegKey {
    RegKey::predef(HKEY_CURRENT_USER)
}

pub fn write(layout: &Layout, version: &str, kilobytes: u32) -> Result<(), String> {
    let failed = |error: std::io::Error| {
        said!(
            en: "couldn’t register Sens with Windows: {error}",
            es: "no pude registrar Sens en Windows: {error}",
            fr: "impossible d’inscrire Sens dans Windows : {error}",
            de: "Sens konnte nicht in Windows registriert werden: {error}",
            ja: "Sens を Windows に登録できませんでした: {error}",
            zh: "无法向 Windows 注册 Sens：{error}",
        )
    };
    let (entry, _) = user().create_subkey(&layout.uninstall_key).map_err(failed)?;
    let uninstaller = quoted(&layout.uninstaller());
    let texts = [
        ("DisplayName", PRODUCT.to_string()),
        ("DisplayIcon", quoted(&layout.app())),
        ("DisplayVersion", version.to_string()),
        ("Publisher", PUBLISHER.to_string()),
        ("InstallLocation", quoted(&layout.dir)),
        ("UninstallString", uninstaller.clone()),
        ("QuietUninstallString", format!("{uninstaller} /S")),
        ("MainBinaryName", APP.to_string()),
    ];
    for (name, value) in texts {
        entry.set_value(name, &value).map_err(failed)?;
    }
    for (name, value) in [("NoModify", 1u32), ("NoRepair", 1), ("EstimatedSize", kilobytes)] {
        entry.set_value(name, &value).map_err(failed)?;
    }
    let (remembered, _) = user().create_subkey(&layout.remembered_key).map_err(failed)?;
    remembered.set_value("", &layout.dir.display().to_string()).map_err(failed)
}

pub fn erase(layout: &Layout) -> Result<(), String> {
    for key in [&layout.uninstall_key, &layout.remembered_key] {
        match user().delete_subkey_all(key) {
            Err(error) if error.kind() != ErrorKind::NotFound => {
                return Err(said!(
                    en: "couldn’t remove Sens from Windows: {error}",
                    es: "no pude quitar Sens de Windows: {error}",
                    fr: "impossible de retirer Sens de Windows : {error}",
                    de: "Sens konnte nicht aus Windows entfernt werden: {error}",
                    ja: "Windows から Sens を削除できませんでした: {error}",
                    zh: "无法从 Windows 中移除 Sens：{error}",
                ));
            }
            _ => {}
        }
    }
    if let Some((parent, _)) = layout.remembered_key.rsplit_once('\\') {
        remove_if_empty(parent);
    }
    Ok(())
}

fn remove_if_empty(key: &str) {
    let empty = user()
        .open_subkey(key)
        .is_ok_and(|opened| opened.enum_keys().next().is_none() && opened.enum_values().next().is_none());
    if empty {
        let _ = user().delete_subkey(key);
    }
}

pub fn installed(layout: &Layout) -> Option<Installed> {
    let version: String = user().open_subkey(&layout.uninstall_key).ok()?.get_value("DisplayVersion").ok()?;
    let dir = installed_dir(layout)?;
    dir.join(APP).is_file().then(|| Installed {
        version,
        dir: dir.display().to_string(),
    })
}

pub fn installed_dir(layout: &Layout) -> Option<PathBuf> {
    let read = |key: &str, name: &str| user().open_subkey(key).and_then(|opened| opened.get_value::<String, _>(name)).ok();
    read(&layout.remembered_key, "")
        .or_else(|| read(&layout.uninstall_key, "InstallLocation"))
        .map(|dir| PathBuf::from(dir.trim().trim_matches('"')))
        .filter(|dir| dir.is_absolute())
}

fn quoted(path: &Path) -> String {
    format!("\"{}\"", path.display())
}
