use std::collections::BTreeMap;
use std::path::Path;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use sens_agent::account::{self, Account};
use sens_agent::{catalog, process};
use serde::{Deserialize, Serialize};

use crate::store;

const FILE: &str = "providers.json";
pub const KEY_VARIABLE: &str = "ANTHROPIC_API_KEY";
const KEY_PREFIX: &str = "sk-ant-";
const KEY_FLOOR: usize = 24;
const HINT_TAIL: usize = 4;

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub enum Method {
    #[default]
    Subscription,
    Console,
    ApiKey,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct Stored {
    #[serde(default)]
    method: Method,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    sealed_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub id: &'static str,
    pub vendor: &'static str,
    pub label: &'static str,
    pub method: Method,
    pub key_hint: String,
    pub version: String,
    pub account: Option<Account>,
    pub error: String,
    pub installed: bool,
}

fn stored(base: &Path) -> BTreeMap<String, Stored> {
    store::stored(&base.join(FILE))
}

fn known(id: &str) -> Result<(), String> {
    catalog::provider(id).map(drop).ok_or_else(|| format!("no conozco el proveedor {id}"))
}

fn change(base: &Path, id: &str, apply: impl FnOnce(&mut Stored) -> Result<(), String>) -> Result<(), String> {
    known(id)?;
    let mut kept: BTreeMap<String, Stored> = store::editable(&base.join(FILE))?;
    apply(kept.entry(id.to_string()).or_default())?;
    store::store(base, FILE, &kept)
}

fn hint(key: &str) -> String {
    let tail: String = key.chars().rev().take(HINT_TAIL).collect::<Vec<_>>().into_iter().rev().collect();
    format!("{KEY_PREFIX}…{tail}")
}

fn opened_key(one: &Stored) -> Option<String> {
    (!one.sealed_key.is_empty()).then(|| unseal(&one.sealed_key).ok()).flatten()
}

pub fn state(base: &Path) -> Vec<State> {
    let kept = stored(base);
    let version = account::version();
    let installed = version.is_ok() || process::located().is_some();
    let signed = version.as_ref().ok().map(|_| account::read());
    catalog::PROVIDERS
        .iter()
        .map(|provider| {
            let mine = kept.get(provider.id).cloned().unwrap_or_default();
            let error = match (&version, &signed) {
                _ if !installed => String::new(),
                (Err(reason), _) => reason.clone(),
                (_, Some(Err(reason))) => reason.clone(),
                _ => String::new(),
            };
            State {
                id: provider.id,
                vendor: provider.vendor,
                label: provider.label,
                method: mine.method,
                key_hint: opened_key(&mine).map(|key| hint(&key)).unwrap_or_default(),
                version: version.clone().unwrap_or_default(),
                account: signed.as_ref().and_then(|found| found.as_ref().ok().cloned()),
                error,
                installed,
            }
        })
        .collect()
}

pub fn set_method(base: &Path, id: &str, method: Method) -> Result<(), String> {
    change(base, id, |mine| {
        if method == Method::ApiKey && mine.sealed_key.is_empty() {
            return Err("guarda antes una clave de API".into());
        }
        mine.method = method;
        Ok(())
    })
}

fn vetted_key(key: &str) -> Result<&str, String> {
    let key = key.trim();
    if !key.starts_with(KEY_PREFIX) || key.len() < KEY_FLOOR || key.chars().any(char::is_whitespace) {
        return Err(format!("eso no parece una clave de la Consola de Anthropic (empiezan por {KEY_PREFIX})"));
    }
    Ok(key)
}

pub fn save_key(base: &Path, id: &str, key: &str) -> Result<(), String> {
    let key = vetted_key(key)?;
    let sealed = seal(key)?;
    change(base, id, |mine| {
        mine.sealed_key = sealed;
        mine.method = Method::ApiKey;
        Ok(())
    })
}

pub fn forget_key(base: &Path, id: &str) -> Result<(), String> {
    change(base, id, |mine| {
        mine.sealed_key.clear();
        if mine.method == Method::ApiKey {
            mine.method = Method::Subscription;
        }
        Ok(())
    })
}

pub fn environment(base: &Path) -> BTreeMap<String, String> {
    stored(base)
        .get("claude")
        .filter(|mine| mine.method == Method::ApiKey)
        .and_then(opened_key)
        .map(|key| BTreeMap::from([(KEY_VARIABLE.to_string(), key)]))
        .unwrap_or_default()
}

#[cfg(windows)]
fn protect(data: &[u8], sealing: bool) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
    };
    use windows::core::PCWSTR;

    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let done = unsafe {
        match sealing {
            true => CryptProtectData(&input, PCWSTR::null(), None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output),
            false => CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output),
        }
    };
    done.map_err(|error| format!("Windows no pudo proteger la clave: {error}"))?;
    let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        let _ = LocalFree(Some(HLOCAL(output.pbData as _)));
    }
    Ok(bytes)
}

#[cfg(not(windows))]
fn protect(_data: &[u8], _sealing: bool) -> Result<Vec<u8>, String> {
    Err("guardar una clave solo funciona en Windows por ahora".into())
}

fn seal(key: &str) -> Result<String, String> {
    Ok(STANDARD.encode(protect(key.as_bytes(), true)?))
}

fn unseal(sealed: &str) -> Result<String, String> {
    let bytes = STANDARD.decode(sealed).map_err(|_| "la clave guardada está dañada".to_string())?;
    String::from_utf8(protect(&bytes, false)?).map_err(|_| "la clave guardada está dañada".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz-WXYZ";

    fn temp_root(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("sens-providers-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn method(base: &Path) -> Method {
        stored(base).get("claude").map(|mine| mine.method).unwrap_or_default()
    }

    #[test]
    fn the_subscription_is_the_default_and_carries_no_key() {
        let base = temp_root("default");
        assert_eq!(method(&base), Method::Subscription);
        assert!(environment(&base).is_empty());
        set_method(&base, "claude", Method::Console).unwrap();
        assert_eq!(method(&base), Method::Console);
        assert!(environment(&base).is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn a_saved_key_is_sealed_on_disk_and_reaches_claude_only_while_chosen() {
        let base = temp_root("key");
        save_key(&base, "claude", &format!("  {KEY}  ")).unwrap();

        let on_disk = std::fs::read_to_string(base.join(FILE)).unwrap();
        assert!(!on_disk.contains("abcdefghijklmnop"));
        assert_eq!(method(&base), Method::ApiKey);
        assert_eq!(environment(&base).get(KEY_VARIABLE).map(String::as_str), Some(KEY));
        assert_eq!(hint(KEY), "sk-ant-…WXYZ");

        set_method(&base, "claude", Method::Subscription).unwrap();
        assert!(environment(&base).is_empty());

        set_method(&base, "claude", Method::ApiKey).unwrap();
        forget_key(&base, "claude").unwrap();
        assert_eq!(method(&base), Method::Subscription);
        assert!(environment(&base).is_empty());
        assert!(!std::fs::read_to_string(base.join(FILE)).unwrap().contains("sealedKey"));
    }

    #[test]
    fn the_key_method_needs_a_key_and_only_anthropic_keys_are_taken() {
        let base = temp_root("rules");
        assert!(set_method(&base, "claude", Method::ApiKey).unwrap_err().contains("clave"));
        for bad in ["", "sk-ant-", "hola", "sk-proj-abcdefghijklmnopqrstuvwxyz", "sk-ant-api03 con espacios dentro"] {
            assert!(save_key(&base, "claude", bad).is_err(), "{bad}");
        }
        assert!(set_method(&base, "otro", Method::Console).unwrap_err().contains("no conozco"));
        assert_eq!(method(&base), Method::Subscription);
    }

    #[test]
    fn a_damaged_key_reads_as_no_key() {
        let base = temp_root("damaged");
        let broken = Stored { method: Method::ApiKey, sealed_key: "no-es-base64-!!".into() };
        store::store(&base, FILE, &BTreeMap::from([("claude".to_string(), broken)])).unwrap();
        assert!(environment(&base).is_empty());
    }
}
