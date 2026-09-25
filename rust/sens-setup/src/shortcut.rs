use std::fs;
use std::path::Path;
use std::thread;

use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile,
};
use windows::Win32::System::Variant::VT_LPWSTR;
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{IShellLinkW, SHStrDupW, ShellLink};
use windows::core::{HSTRING, Interface};

use crate::language::said;

const APP_ID: &str = "dev.sens.desktop";

pub fn create(at: &Path, target: &Path, dir: &Path) -> Result<(), String> {
    let shown = at.display();
    let failed = |error: String| {
        said!(
            en: "couldn’t create the shortcut {shown}: {error}",
            es: "no pude crear el acceso directo {shown}: {error}",
            fr: "impossible de créer le raccourci {shown} : {error}",
            de: "die Verknüpfung {shown} konnte nicht erstellt werden: {error}",
            ja: "ショートカット {shown} を作成できませんでした: {error}",
            zh: "无法创建快捷方式 {shown}：{error}",
        )
    };
    if let Some(parent) = at.parent() {
        fs::create_dir_all(parent).map_err(|error| failed(error.to_string()))?;
    }
    thread::scope(|scope| scope.spawn(|| in_apartment(|| save(at, target, dir))).join())
        .map_err(|_| {
            failed(said!(
                en: "Windows didn’t respond",
                es: "Windows no respondió",
                fr: "Windows n’a pas répondu",
                de: "Windows hat nicht geantwortet",
                ja: "Windows が応答しませんでした",
                zh: "Windows 没有响应",
            ))
        })?
        .map_err(|error| failed(error.message()))
}

fn in_apartment<T>(work: impl FnOnce() -> windows::core::Result<T>) -> windows::core::Result<T> {
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()? };
    let done = work();
    unsafe { CoUninitialize() };
    done
}

fn save(at: &Path, target: &Path, dir: &Path) -> windows::core::Result<()> {
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        link.SetPath(&HSTRING::from(target))?;
        link.SetWorkingDirectory(&HSTRING::from(dir))?;
        let mut value = PROPVARIANT::default();
        (*value.Anonymous.Anonymous).vt = VT_LPWSTR;
        (*value.Anonymous.Anonymous).Anonymous.pwszVal = SHStrDupW(&HSTRING::from(APP_ID))?;
        let store: IPropertyStore = link.cast()?;
        store.SetValue(&PKEY_AppUserModel_ID, &value)?;
        store.Commit()?;
        link.cast::<IPersistFile>()?.Save(&HSTRING::from(at), true)
    }
}

#[cfg(test)]
pub fn read(at: &Path) -> (std::path::PathBuf, std::path::PathBuf, String) {
    use windows::Win32::System::Com::STGM_READ;

    thread::scope(|scope| {
        scope
            .spawn(|| {
                in_apartment(|| unsafe {
                    let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
                    link.cast::<IPersistFile>()?.Load(&HSTRING::from(at), STGM_READ)?;
                    let mut target = [0u16; 1024];
                    link.GetPath(&mut target, std::ptr::null_mut(), 0)?;
                    let mut dir = [0u16; 1024];
                    link.GetWorkingDirectory(&mut dir)?;
                    let value = link.cast::<IPropertyStore>()?.GetValue(&PKEY_AppUserModel_ID)?;
                    let app_id = value.Anonymous.Anonymous.Anonymous.pwszVal.to_string().unwrap_or_default();
                    Ok((wide_path(&target), wide_path(&dir), app_id))
                })
            })
            .join()
            .unwrap()
            .unwrap()
    })
}

#[cfg(test)]
fn wide_path(wide: &[u16]) -> std::path::PathBuf {
    let end = wide.iter().position(|unit| *unit == 0).unwrap_or(wide.len());
    std::path::PathBuf::from(String::from_utf16_lossy(&wide[..end]))
}
