use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use minisign_verify::{PublicKey, Signature};
use sens_agent::said;
use serde::Serialize;
use serde_json::Value;

use crate::{files, web};

const RELEASES: &str = "https://api.github.com/repos/iiTzSenn/Sens/releases";
const PUBLIC_KEY: &str = include_str!("../updater.pub");
const FOLDER: &str = "updates";
const INSTALLER_CAP: u64 = 64 * web::MEGABYTE;
const SIGNATURE_CAP: u64 = web::MEGABYTE;
pub const INSTALLABLE: bool = !cfg!(debug_assertions);

fn mismatch() -> String {
    said!(
        en: "the signature doesn’t match; it won’t be installed",
        es: "la firma no coincide; no se instala",
        fr: "la signature ne correspond pas ; rien n’est installé",
        de: "die Signatur stimmt nicht überein; es wird nicht installiert",
        ja: "署名が一致しないため、インストールしません",
        zh: "签名不匹配，因此不会安装",
    )
}

pub type Number = (u64, u64, u64);

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub version: String,
    pub notes: String,
    pub page: String,
    pub size: u64,
    #[serde(skip)]
    installer: String,
    #[serde(skip)]
    signature: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    latest: Option<Release>,
    installable: bool,
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Downloading,
    Verifying,
    Installing,
}

pub fn current() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub fn check(manual: bool) -> Result<Check, String> {
    let latest = if manual || INSTALLABLE { latest(current())? } else { None };
    Ok(Check {
        latest,
        installable: INSTALLABLE,
    })
}

pub fn install(base: &Path, report: impl Fn(&str, Stage)) -> Result<(), String> {
    if !INSTALLABLE {
        return Err(said!(
            en: "this is a development build: it checks but doesn’t install",
            es: "esta es una build de desarrollo: comprueba pero no instala",
            fr: "ceci est une version de développement : elle vérifie mais n’installe pas",
            de: "das ist eine Entwicklungsversion: sie prüft, installiert aber nicht",
            ja: "これは開発ビルドです。確認はしますがインストールはしません",
            zh: "这是开发版本：只检查，不安装",
        ));
    }
    let release = latest(current())?.ok_or_else(|| {
        said!(
            en: "you already have the latest version",
            es: "ya tienes la última versión",
            fr: "vous avez déjà la dernière version",
            de: "du hast bereits die neueste Version",
            ja: "すでに最新バージョンです",
            zh: "已是最新版本",
        )
    })?;
    report(&release.version, Stage::Downloading);
    let (installer, signature) = download(&release)?;
    report(&release.version, Stage::Verifying);
    verify(PUBLIC_KEY, &installer, &signature, &release.version)?;
    let path = keep(base, &release.version, &installer)?;
    report(&release.version, Stage::Installing);
    launch(&path)
}

pub fn sweep(base: &Path) {
    let _ = fs::remove_dir_all(base.join(FOLDER));
}

fn latest(current: &str) -> Result<Option<Release>, String> {
    Ok(newest(&listed()?, current))
}

pub fn listed() -> Result<Value, String> {
    web::json(RELEASES, &[("per_page", "20")])
}

fn newest(listed: &Value, current: &str) -> Option<Release> {
    let installed = number(current)?;
    listed
        .as_array()?
        .iter()
        .filter_map(offered)
        .filter(|(version, _)| *version > installed)
        .max_by_key(|(version, _)| *version)
        .map(|(_, release)| release)
}

fn download(release: &Release) -> Result<(Vec<u8>, String), String> {
    let signature = web::text(&release.signature, SIGNATURE_CAP)?;
    let installer = web::bytes(&release.installer, &[], INSTALLER_CAP)?;
    Ok((installer, signature))
}

pub fn published(entry: &Value) -> Option<(Number, &str)> {
    if entry["draft"].as_bool() != Some(false) || entry["prerelease"].as_bool() != Some(false) {
        return None;
    }
    let tag = entry["tag_name"].as_str()?;
    let version = tag.strip_prefix('v').unwrap_or(tag);
    Some((number(version)?, version))
}

fn offered(entry: &Value) -> Option<(Number, Release)> {
    let (found, version) = published(entry)?;
    let name = installer_name(version);
    let assets = entry["assets"].as_array()?;
    let installer = asset(assets, &name)?;
    let signature = asset(assets, &format!("{name}.sig"))?;
    let release = Release {
        version: version.to_string(),
        notes: entry["body"].as_str().unwrap_or_default().to_string(),
        page: entry["html_url"].as_str()?.to_string(),
        size: installer["size"].as_u64()?,
        installer: installer["browser_download_url"].as_str()?.to_string(),
        signature: signature["browser_download_url"].as_str()?.to_string(),
    };
    Some((found, release))
}

fn asset<'a>(assets: &'a [Value], name: &str) -> Option<&'a Value> {
    assets.iter().find(|asset| asset["name"] == name)
}

fn installer_name(version: &str) -> String {
    format!("Sens_{version}_x64-setup.exe")
}

pub fn number(version: &str) -> Option<Number> {
    let mut parts = version.split('.').map(|part| {
        let digits = !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit());
        digits.then(|| part.parse::<u64>().ok()).flatten()
    });
    let found = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some(found)
}

fn verify(key: &str, installer: &[u8], signature: &str, version: &str) -> Result<(), String> {
    let key = PublicKey::decode(&unpacked(key)?).map_err(|_| {
        said!(
            en: "Sens’s public key is damaged",
            es: "la clave pública de Sens está dañada",
            fr: "la clé publique de Sens est endommagée",
            de: "der öffentliche Schlüssel von Sens ist beschädigt",
            ja: "Sens の公開鍵が壊れています",
            zh: "Sens 的公钥已损坏",
        )
    })?;
    let seal = Signature::decode(&unpacked(signature)?).map_err(|_| mismatch())?;
    key.verify(installer, &seal, false).map_err(|_| mismatch())?;
    let claimed = format!("version:{version}");
    if seal.trusted_comment().split('\t').any(|field| field == claimed) {
        Ok(())
    } else {
        Err(said!(
            en: "the signature isn’t for version {version}; it won’t be installed",
            es: "la firma no es de la versión {version}; no se instala",
            fr: "la signature ne correspond pas à la version {version} ; rien n’est installé",
            de: "die Signatur gehört nicht zu Version {version}; es wird nicht installiert",
            ja: "署名がバージョン {version} のものではないため、インストールしません",
            zh: "签名不属于版本 {version}，因此不会安装",
        ))
    }
}

fn unpacked(text: &str) -> Result<String, String> {
    let bytes = STANDARD.decode(text.trim()).map_err(|_| mismatch())?;
    String::from_utf8(bytes).map_err(|_| mismatch())
}

fn keep(base: &Path, version: &str, installer: &[u8]) -> Result<PathBuf, String> {
    let folder = base.join(FOLDER);
    fs::create_dir_all(&folder).map_err(|error| files::uncreated(&folder, error))?;
    let path = folder.join(installer_name(version));
    fs::write(&path, installer).map_err(|error| {
        said!(
            en: "couldn’t save the installer: {error}",
            es: "no pude guardar el instalador: {error}",
            fr: "impossible d’enregistrer le programme d’installation : {error}",
            de: "das Installationsprogramm konnte nicht gespeichert werden: {error}",
            ja: "インストーラーを保存できませんでした: {error}",
            zh: "无法保存安装程序：{error}",
        )
    })?;
    Ok(path)
}

fn launch(installer: &Path) -> Result<(), String> {
    Command::new(installer).args(["/P", "/UPDATE", "/R"]).spawn().map(drop).map_err(|error| {
        said!(
            en: "couldn’t open the installer: {error}",
            es: "no pude abrir el instalador: {error}",
            fr: "impossible d’ouvrir le programme d’installation : {error}",
            de: "das Installationsprogramm konnte nicht geöffnet werden: {error}",
            ja: "インストーラーを開けませんでした: {error}",
            zh: "无法打开安装程序：{error}",
        )
    })
}

#[cfg(test)]
mod tests {
    use sens_agent::language::{Language, speaking};
    use serde_json::json;

    use super::*;

    const TEST_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IENGRTk0MEVCOTk3M0Q2QTgKUldTbzFuT1o2MERwenl2Rlc5aGpBMkhqNFFOMWZNMDcxVEVKenloTTF5QkVGd2RrTGxkdzRNcVcK";
    const OTHER_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDI5QzQ0NzdBRkRGQzJEOTIKUldTU0xmejlla2ZFS2FqNUZxWDRua3RFSWIwNnVvVlZyZFd0MndobDVwaXo1eGJSQjhaN0hlbFAK";
    const SIGNED: &[u8] = b"Sens installer bytes for the updater test\n";
    const SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTbzFuT1o2MERwejdXZVNYVHlpN2pyOVlMeHBIV0Y4M25pTGwyb09QWEc0aVpCcWNaV3FJcW5GRHJsMFd2VkxvWFZqbzZxWW9vOHBhYW1RcGoyd0RjNnVwZU9HbEowZ1EwPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkwMTk0Mjk0CWZpbGU6cGF5bG9hZC5iaW4JdmVyc2lvbjowLjEyLjEKRzBOa2xIRXdKWlg1OGg1bndxeTUvcWZKZlFoYU9UUGJOd3NqTDRZZkprZVVwM0k5bjI3ekVYYTZpc09lc1MvZVp4ZFVDV0YvYWtlWFdxMXJNUkZiRFE9PQo=";

    fn release(tag: &str, files: &[&str]) -> Value {
        json!({
            "tag_name": tag,
            "draft": false,
            "prerelease": false,
            "body": format!("notas de {tag}"),
            "html_url": format!("https://github.com/iiTzSenn/Sens/releases/tag/{tag}"),
            "assets": files.iter().map(|name| json!({
                "name": name,
                "size": 2_078_682,
                "browser_download_url": format!("https://github.com/iiTzSenn/Sens/releases/download/{tag}/{name}"),
            })).collect::<Vec<_>>(),
        })
    }

    fn shipped(version: &str) -> Value {
        let name = installer_name(version);
        release(&format!("v{version}"), &[&name, &format!("{name}.sig")])
    }

    #[test]
    fn versions_compare_as_numbers_not_as_text() {
        assert!(number("0.10.0") > number("0.9.0"));
        assert!(number("1.0.0") > number("0.99.99"));
        assert_eq!(number("0.12.1"), Some((0, 12, 1)));
    }

    #[test]
    fn versions_that_are_not_three_plain_numbers_do_not_count() {
        for odd in ["0.12", "0.12.0.1", "0.12.0-beta", "+1.0.0", "0..1", "v0.12.0", ""] {
            assert_eq!(number(odd), None, "{odd}");
        }
    }

    #[test]
    fn the_highest_signed_desktop_release_wins_whatever_the_listing_order() {
        let listed = json!([shipped("0.12.0"), shipped("0.13.0"), shipped("0.12.5")]);

        assert_eq!(newest(&listed, "0.11.0").unwrap().version, "0.13.0");
    }

    #[test]
    fn a_release_carries_its_notes_page_size_and_download_links() {
        let found = newest(&json!([shipped("0.12.0")]), "0.11.0").unwrap();

        assert_eq!(found.notes, "notas de v0.12.0");
        assert_eq!(found.page, "https://github.com/iiTzSenn/Sens/releases/tag/v0.12.0");
        assert_eq!(found.size, 2_078_682);
        assert!(found.installer.ends_with("/v0.12.0/Sens_0.12.0_x64-setup.exe"));
        assert!(found.signature.ends_with("/v0.12.0/Sens_0.12.0_x64-setup.exe.sig"));
    }

    #[test]
    fn drafts_prereleases_npm_only_and_unsigned_releases_are_passed_over() {
        let mut draft = shipped("0.15.0");
        draft["draft"] = json!(true);
        let mut preview = shipped("0.14.0");
        preview["prerelease"] = json!(true);
        let npm_only = release("v0.13.5", &[]);
        let unsigned = release("v0.13.0", &["Sens_0.13.0_x64-setup.exe"]);
        let listed = json!([draft, preview, npm_only, unsigned, shipped("0.12.0")]);

        assert_eq!(newest(&listed, "0.11.0").unwrap().version, "0.12.0");
    }

    #[test]
    fn nothing_is_offered_when_the_installed_version_is_the_newest() {
        let listed = json!([shipped("0.12.0"), shipped("0.11.0")]);

        assert!(newest(&listed, "0.12.0").is_none());
        assert!(newest(&listed, "0.13.0").is_none());
    }

    #[test]
    fn an_installer_signed_with_the_key_for_its_version_passes() {
        assert_eq!(verify(TEST_KEY, SIGNED, SIGNATURE, "0.12.1"), Ok(()));
    }

    #[test]
    fn an_altered_installer_is_refused() {
        let error = verify(TEST_KEY, b"Sens installer bytes, swapped\n", SIGNATURE, "0.12.1").unwrap_err();

        assert_eq!(error, mismatch());
        assert_eq!(error, "the signature doesn’t match; it won’t be installed");
    }

    #[test]
    fn a_refused_installer_is_explained_in_the_language_spoken() {
        let swapped = b"Sens installer bytes, swapped\n";

        assert_eq!(speaking(Language::Es, || verify(TEST_KEY, swapped, SIGNATURE, "0.12.1")), Err("la firma no coincide; no se instala".into()));
        assert_eq!(speaking(Language::De, || verify(TEST_KEY, swapped, SIGNATURE, "0.12.1")), Err("die Signatur stimmt nicht überein; es wird nicht installiert".into()));
        assert_eq!(speaking(Language::Es, || verify(TEST_KEY, SIGNED, SIGNATURE, "0.13.0")), Err("la firma no es de la versión 0.13.0; no se instala".into()));
    }

    #[test]
    fn a_signature_from_another_key_is_refused() {
        assert_eq!(verify(OTHER_KEY, SIGNED, SIGNATURE, "0.12.1").unwrap_err(), mismatch());
    }

    #[test]
    fn an_older_signed_installer_relabelled_as_a_newer_version_is_refused() {
        let error = verify(TEST_KEY, SIGNED, SIGNATURE, "0.13.0").unwrap_err();

        assert!(error.contains("0.13.0"), "{error}");
    }

    #[test]
    fn a_signature_that_is_not_minisign_is_refused() {
        assert_eq!(verify(TEST_KEY, SIGNED, "no es una firma", "0.12.1").unwrap_err(), mismatch());
    }

    #[test]
    fn the_embedded_public_key_is_a_minisign_key() {
        assert!(PublicKey::decode(&unpacked(PUBLIC_KEY).unwrap()).is_ok());
    }

    #[test]
    fn the_embedded_public_key_is_not_the_test_key() {
        assert_ne!(PUBLIC_KEY.trim(), TEST_KEY);
        assert_ne!(PUBLIC_KEY.trim(), OTHER_KEY);
    }

    #[test]
    #[ignore]
    fn the_real_releases() {
        let found = latest("0.0.0").unwrap();
        println!("{found:?}");
    }

    #[test]
    #[ignore]
    fn the_real_latest_installer_downloads_and_passes_its_signature() {
        let release = latest("0.0.0").unwrap().unwrap();
        let (installer, signature) = download(&release).unwrap();

        assert_eq!(installer.len() as u64, release.size);
        assert_eq!(verify(PUBLIC_KEY, &installer, &signature, &release.version), Ok(()));
        println!("{} descargada y verificada, {} bytes", release.version, installer.len());
    }
}
