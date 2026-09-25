use std::path::{Path, PathBuf};

use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::Shell::{
    FOLDERID_Desktop, FOLDERID_LocalAppData, FOLDERID_Programs, FOLDERID_RoamingAppData, KF_FLAG_DEFAULT, SHGetKnownFolderPath,
};
use windows::core::GUID;

use crate::language::said;
use crate::registry;

pub const APP: &str = "sens-app.exe";
pub const UNINSTALLER: &str = "uninstall.exe";
pub const DATA: &str = "dev.sens.desktop";
const PRODUCT: &str = "Sens";
const LINK: &str = "Sens.lnk";
const FRESH: &str = "sens-app.exe.new";
const OLD: &str = "sens-app.exe.old";
const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Sens";
const REMEMBERED_KEY: &str = r"Software\sens\Sens";

#[derive(Clone, Debug)]
pub struct Layout {
    pub dir: PathBuf,
    pub uninstall_key: String,
    pub remembered_key: String,
    pub start_menu: PathBuf,
    pub desktop: PathBuf,
    pub settings: PathBuf,
    pub data: Vec<PathBuf>,
}

impl Layout {
    pub fn for_user(dir: Option<PathBuf>) -> Result<Layout, String> {
        let local = known(&FOLDERID_LocalAppData)?;
        let settings = known(&FOLDERID_RoamingAppData)?.join(DATA);
        let mut layout = Layout {
            dir: local.join(PRODUCT),
            uninstall_key: UNINSTALL_KEY.into(),
            remembered_key: REMEMBERED_KEY.into(),
            start_menu: known(&FOLDERID_Programs)?.join(LINK),
            desktop: known(&FOLDERID_Desktop)?.join(LINK),
            data: vec![settings.clone(), local.join(DATA)],
            settings,
        };
        if let Some(dir) = dir.or_else(|| registry::installed_dir(&layout)) {
            layout.dir = dir;
        }
        Ok(layout)
    }

    pub fn at(&self, dir: &Path) -> Layout {
        Layout {
            dir: dir.to_path_buf(),
            ..self.clone()
        }
    }

    pub fn app(&self) -> PathBuf {
        self.dir.join(APP)
    }

    pub fn fresh_app(&self) -> PathBuf {
        self.dir.join(FRESH)
    }

    pub fn old_app(&self) -> PathBuf {
        self.dir.join(OLD)
    }

    pub fn uninstaller(&self) -> PathBuf {
        self.dir.join(UNINSTALLER)
    }

    pub fn placed_files(&self) -> [PathBuf; 4] {
        [self.app(), self.fresh_app(), self.old_app(), self.uninstaller()]
    }
}

fn known(folder: &GUID) -> Result<PathBuf, String> {
    let missing = |error: String| {
        said!(
            en: "can’t find your user folders in Windows: {error}",
            es: "no encuentro las carpetas de tu usuario en Windows: {error}",
            fr: "impossible de trouver les dossiers de votre utilisateur dans Windows : {error}",
            de: "deine Benutzerordner in Windows wurden nicht gefunden: {error}",
            ja: "Windows のユーザーフォルダーが見つかりません: {error}",
            zh: "找不到你在 Windows 中的用户文件夹：{error}",
        )
    };
    unsafe {
        let path = SHGetKnownFolderPath(folder, KF_FLAG_DEFAULT, None).map_err(|error| missing(error.message()))?;
        let text = path.to_string();
        CoTaskMemFree(Some(path.0 as *const _));
        text.map(PathBuf::from).map_err(|error| missing(error.to_string()))
    }
}

#[cfg(test)]
pub mod sandbox {
    use std::fs;
    use std::path::PathBuf;

    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    use super::{DATA, LINK, Layout, PRODUCT};

    const TEST_ROOT: &str = r"Software\SensSetupTest";

    pub struct Sandbox {
        pub layout: Layout,
        pub root: PathBuf,
        key: String,
    }

    impl Sandbox {
        pub fn new(name: &str) -> Sandbox {
            let root = std::env::temp_dir().join(format!("sens-setup-test-{name}"));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(&root).unwrap();
            let key = format!(r"{TEST_ROOT}\{name}");
            let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(&key);
            let layout = Layout {
                dir: root.join(PRODUCT),
                uninstall_key: format!(r"{key}\Uninstall\Sens"),
                remembered_key: format!(r"{key}\sens\Sens"),
                start_menu: root.join("Programs").join(LINK),
                desktop: root.join("Desktop").join(LINK),
                settings: root.join("Roaming").join(DATA),
                data: vec![root.join("Roaming").join(DATA), root.join("Local").join(DATA)],
            };
            Sandbox { layout, root, key }
        }

        pub fn file(&self, name: &str, contents: &[u8]) -> PathBuf {
            let path = self.root.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, contents).unwrap();
            path
        }

        pub fn key(&self, path: &str) -> Option<RegKey> {
            RegKey::predef(HKEY_CURRENT_USER).open_subkey(path).ok()
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
            let user = RegKey::predef(HKEY_CURRENT_USER);
            let _ = user.delete_subkey_all(&self.key);
            let _ = user.delete_subkey(TEST_ROOT);
        }
    }
}
