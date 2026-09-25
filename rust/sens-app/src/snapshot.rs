use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime};

use flate2::read::GzDecoder;
use sens_agent::said;
use serde::Serialize;
use serde_json::Value;

use crate::web::{self, MEGABYTE};

const REPOS: [&str; 2] = ["market", "repos"];
const STAGING: &str = ".descargando-";
const USED: &str = ".sens-usado";
const TARBALL_CAP: u64 = 50 * MEGABYTE;
const READ_CAP: u64 = 512 * 1024;
const STALE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

pub fn unsupported() -> String {
    said!(
        en: "this source can’t be installed from Sens",
        es: "este origen no se puede instalar desde Sens",
        fr: "cette source ne peut pas être installée depuis Sens",
        de: "diese Quelle lässt sich nicht über Sens installieren",
        ja: "この提供元は Sens からインストールできません",
        zh: "此来源无法从 Sens 安装",
    )
}

pub fn not_in_repository(path: &str) -> String {
    said!(
        en: "{path} doesn’t exist in the repository",
        es: "no existe {path} en el repositorio",
        fr: "{path} n’existe pas dans le dépôt",
        de: "{path} gibt es im Repository nicht",
        ja: "リポジトリに {path} がありません",
        zh: "仓库中不存在 {path}",
    )
}

#[derive(Clone, Copy)]
pub struct Limits {
    pub files: usize,
    pub bytes: u64,
}

pub const LIMITS: Limits = Limits { files: 2_000, bytes: 100 * MEGABYTE };

#[derive(Clone, Debug, PartialEq)]
pub struct Wanted {
    pub repo: String,
    pub reference: String,
    pub path: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Origin {
    pub repo: String,
    pub sha: String,
    pub path: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct FileRow {
    pub path: String,
    pub size: u64,
}

pub fn github_repo(url: &str) -> Option<String> {
    let url = url.trim();
    let bare = ["https://github.com/", "http://github.com/", "git@github.com:", "github.com/"]
        .iter()
        .find_map(|prefix| url.strip_prefix(prefix));
    let bare = match bare {
        Some(bare) => bare,
        None if url.contains("://") || url.contains('@') => return None,
        None => url,
    };
    let mut parts = bare.trim_end_matches('/').split('/');
    let owner = parts.next()?;
    let name = parts.next()?.trim_end_matches(".git");
    let named = |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte));
    (named(owner) && named(name) && !name.starts_with('.')).then(|| format!("{owner}/{name}"))
}

pub fn inner_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim().trim_start_matches("./").trim_end_matches('/');
    let parts: Vec<&str> = trimmed.split(['/', '\\']).filter(|part| !part.is_empty() && *part != ".").collect();
    if Path::new(trimmed).is_absolute() || parts.iter().any(|part| *part == ".." || part.contains(':')) {
        return Err(said!(
            en: "the path {path} leaves its repository",
            es: "la ruta {path} sale de su repositorio",
            fr: "le chemin {path} sort de son dépôt",
            de: "der Pfad {path} verlässt sein Repository",
            ja: "パス {path} はリポジトリの外を指しています",
            zh: "路径 {path} 指向仓库之外",
        ));
    }
    Ok(parts.join("/"))
}

pub fn wanted(source: &Value, catalog: &Origin) -> Result<Wanted, String> {
    if let Some(relative) = source.as_str() {
        let inside = inner_path(relative)?;
        let path = [catalog.path.as_str(), inside.as_str()].into_iter().filter(|part| !part.is_empty()).collect::<Vec<_>>().join("/");
        return Ok(Wanted { repo: catalog.repo.clone(), reference: catalog.sha.clone(), path });
    }
    let text = |key: &str| source[key].as_str().unwrap_or_default().trim().to_string();
    let reference = [text("sha"), text("ref")].into_iter().find(|value| !value.is_empty()).unwrap_or_default();
    let (repo, path) = match text("source").as_str() {
        "url" | "git-subdir" => (github_repo(&text("url")), inner_path(&text("path"))?),
        "github" => (github_repo(&text("repo")), inner_path(&text("path"))?),
        _ => (None, String::new()),
    };
    let repo = repo.ok_or_else(unsupported)?;
    Ok(Wanted { repo, reference, path })
}

pub fn pin(wanted: &Wanted) -> Result<Origin, String> {
    Ok(Origin {
        sha: web::revision(&wanted.repo, &wanted.reference)?,
        repo: wanted.repo.clone(),
        path: wanted.path.clone(),
    })
}

fn digest(value: impl Hash) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

fn repos(base: &Path) -> PathBuf {
    REPOS.iter().fold(base.to_path_buf(), |path, part| path.join(part))
}

fn slot(base: &Path, origin: &Origin) -> PathBuf {
    let repo = origin.repo.replace('/', "-");
    let short = &origin.sha[..origin.sha.len().min(12)];
    let name = match origin.path.is_empty() {
        true => format!("{repo}-{short}"),
        false => format!("{repo}-{short}-{:08x}", digest(&origin.path) as u32),
    };
    repos(base).join(name)
}

pub fn ensure(base: &Path, origin: &Origin) -> Result<PathBuf, String> {
    let folder = slot(base, origin);
    if folder.is_dir() {
        touch(&folder);
        return Ok(folder);
    }
    let url = format!("https://codeload.github.com/{}/tar.gz/{}", origin.repo, origin.sha);
    let archive = web::bytes(&url, &[], TARBALL_CAP)?;
    place(&folder, |staging| extract(&archive, &origin.path, staging, LIMITS).map(|_| ()))
        .map_err(|error| format!("{} · {}", origin.repo, error))?;
    Ok(folder)
}

pub fn ensure_files(base: &Path, key: &str, files: &[(String, String)]) -> Result<PathBuf, String> {
    let folder = repos(base).join(format!("skills-sh-{:016x}", digest((key, files))));
    if folder.is_dir() {
        touch(&folder);
        return Ok(folder);
    }
    place(&folder, |staging| {
        let mut total = 0u64;
        for (at, (path, contents)) in files.iter().enumerate() {
            let inside = inner_path(path)?;
            if inside.is_empty() {
                continue;
            }
            total += contents.len() as u64;
            if at >= LIMITS.files || total > LIMITS.bytes {
                return Err(said!(
                    en: "the skill is too big",
                    es: "la skill es demasiado grande",
                    fr: "la skill est trop volumineuse",
                    de: "der Skill ist zu groß",
                    ja: "スキルが大きすぎます",
                    zh: "该技能过大",
                ));
            }
            write(&staging.join(&inside), contents.as_bytes())?;
        }
        Ok(())
    })?;
    Ok(folder)
}

fn place(folder: &Path, fill: impl FnOnce(&Path) -> Result<(), String>) -> Result<(), String> {
    let parent = folder.parent().ok_or_else(|| {
        said!(
            en: "there’s nowhere to save the download",
            es: "no sé dónde guardar la descarga",
            fr: "impossible de savoir où enregistrer le téléchargement",
            de: "unklar, wo der Download gespeichert werden soll",
            ja: "ダウンロードの保存先がわかりません",
            zh: "找不到保存下载内容的位置",
        )
    })?;
    let staging = parent.join(format!("{STAGING}{:016x}", digest((folder, std::process::id(), SystemTime::now()))));
    std::fs::create_dir_all(&staging).map_err(|error| crate::files::uncreated(&staging, error))?;
    let placed = fill(&staging).and_then(|()| match std::fs::rename(&staging, folder) {
        Ok(()) => Ok(()),
        Err(_) if folder.is_dir() => Ok(()),
        Err(error) => Err(said!(
            en: "couldn’t save the download: {error}",
            es: "no pude guardar la descarga: {error}",
            fr: "impossible d’enregistrer le téléchargement : {error}",
            de: "der Download konnte nicht gespeichert werden: {error}",
            ja: "ダウンロードを保存できませんでした: {error}",
            zh: "无法保存下载内容：{error}",
        )),
    });
    let _ = std::fs::remove_dir_all(&staging);
    placed?;
    touch(folder);
    prune(parent, folder);
    Ok(())
}

fn write(path: &Path, contents: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| crate::files::uncreated(parent, error))?;
    }
    std::fs::write(path, contents).map_err(|error| crate::files::unwritten(path, error))
}

pub fn extract(archive: &[u8], inner: &str, into: &Path, limits: Limits) -> Result<usize, String> {
    let wanted: Vec<&str> = inner.split('/').filter(|part| !part.is_empty()).collect();
    let mut unpacked = tar::Archive::new(GzDecoder::new(archive));
    let mut files = 0usize;
    let mut bytes = 0u64;
    let unreadable = |error: std::io::Error| {
        said!(
            en: "the package is damaged: {error}",
            es: "el paquete está dañado: {error}",
            fr: "le paquet est endommagé : {error}",
            de: "das Paket ist beschädigt: {error}",
            ja: "パッケージが壊れています: {error}",
            zh: "软件包已损坏：{error}",
        )
    };

    for entry in unpacked.entries().map_err(unreadable)? {
        let mut entry = entry.map_err(unreadable)?;
        let kind = entry.header().entry_type();
        if !kind.is_file() && !kind.is_dir() {
            continue;
        }
        let path = entry.path().map_err(unreadable)?.into_owned();
        let Some(parts) = plain_parts(&path) else { continue };
        let Some(rest) = parts.get(1..).and_then(|rest| rest.strip_prefix(wanted.as_slice())) else {
            continue;
        };
        if rest.is_empty() {
            continue;
        }
        let target = rest.iter().fold(into.to_path_buf(), |path, part| path.join(part));
        if kind.is_dir() {
            std::fs::create_dir_all(&target).map_err(|error| crate::files::uncreated(&target, error))?;
            continue;
        }
        files += 1;
        bytes += entry.size();
        if files > limits.files {
            return Err(said!(
                en: "it has more than {count} files",
                es: "tiene más de {count} ficheros",
                fr: "il contient plus de {count} fichiers",
                de: "es enthält mehr als {count} Dateien",
                ja: "ファイルが {count} 個を超えています",
                zh: "文件超过 {count} 个",
                count = limits.files,
            ));
        }
        if bytes > limits.bytes {
            return Err(said!(
                en: "it’s over {cap} MB once unpacked",
                es: "pasa de {cap} MB al descomprimir",
                fr: "il dépasse {cap} Mo une fois décompressé",
                de: "entpackt ist es größer als {cap} MB",
                ja: "展開すると {cap} MB を超えます",
                zh: "解压后超过 {cap} MB",
                cap = limits.bytes / MEGABYTE,
            ));
        }
        let mut contents = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut contents).map_err(unreadable)?;
        write(&target, &contents)?;
    }

    if files == 0 && !wanted.is_empty() {
        return Err(not_in_repository(inner));
    }
    Ok(files)
}

fn plain_parts(path: &Path) -> Option<Vec<&str>> {
    path.components()
        .map(|part| match part {
            Component::Normal(name) => name.to_str().filter(|name| !name.contains(':')),
            _ => None,
        })
        .collect()
}

pub fn files(folder: &Path) -> Vec<FileRow> {
    let mut found = Vec::new();
    let mut pending = vec![PathBuf::new()];
    while let Some(relative) = pending.pop() {
        let Ok(listing) = std::fs::read_dir(folder.join(&relative)) else { continue };
        for entry in listing.filter_map(Result::ok) {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(kind) = entry.file_type() else { continue };
            let inner = relative.join(&name);
            if kind.is_dir() {
                pending.push(inner);
            } else if kind.is_file() && name != USED {
                let size = entry.metadata().map_or(0, |meta| meta.len());
                found.push(FileRow { path: slashed(&inner), size });
            }
        }
    }
    found.sort_by(|a, b| a.path.cmp(&b.path));
    found
}

fn slashed(path: &Path) -> String {
    path.components().filter_map(|part| part.as_os_str().to_str()).collect::<Vec<_>>().join("/")
}

pub fn read(folder: &Path, relative: &str) -> Result<String, String> {
    let inside = inner_path(relative)?;
    let path = folder.join(&inside);
    let meta = std::fs::symlink_metadata(&path).map_err(|_| {
        said!(
            en: "{relative} doesn’t exist",
            es: "no existe {relative}",
            fr: "{relative} n’existe pas",
            de: "{relative} existiert nicht",
            ja: "{relative} は存在しません",
            zh: "{relative} 不存在",
        )
    })?;
    if !meta.is_file() {
        return Err(crate::files::not_a_file(relative));
    }
    if meta.len() > READ_CAP {
        return Err(said!(
            en: "{relative} is too big to show",
            es: "{relative} es demasiado grande para mostrarlo",
            fr: "{relative} est trop volumineux pour être affiché",
            de: "{relative} ist zu groß zum Anzeigen",
            ja: "{relative} は大きすぎて表示できません",
            zh: "{relative} 太大，无法显示",
        ));
    }
    let bytes = std::fs::read(&path).map_err(|error| crate::files::unread(relative, error))?;
    String::from_utf8(bytes).map_err(|_| {
        said!(
            en: "{relative} isn’t text",
            es: "{relative} no es texto",
            fr: "{relative} n’est pas du texte",
            de: "{relative} ist kein Text",
            ja: "{relative} はテキストではありません",
            zh: "{relative} 不是文本",
        )
    })
}

pub fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    for row in files(from) {
        let contents = std::fs::read(from.join(&row.path)).map_err(|error| crate::files::unread(&row.path, error))?;
        write(&to.join(&row.path), &contents)?;
    }
    Ok(())
}

fn touch(folder: &Path) {
    let _ = std::fs::write(folder.join(USED), b"");
}

fn prune(parent: &Path, keep: &Path) {
    let stale = |path: &Path| {
        std::fs::metadata(path.join(USED))
            .or_else(|_| std::fs::metadata(path))
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|at| at.elapsed().ok())
            .is_some_and(|age| age > STALE)
    };
    for entry in std::fs::read_dir(parent).into_iter().flatten().filter_map(Result::ok) {
        let path = entry.path();
        if path != keep && path.is_dir() && stale(&path) {
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sens_agent::language::{Language, speaking};
    use flate2::Compression;
    use flate2::write::GzEncoder;
    use serde_json::json;

    fn temp_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("sens-snapshot-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn raw_entry(builder: &mut tar::Builder<GzEncoder<Vec<u8>>>, name: &str, kind: tar::EntryType, body: &[u8]) {
        let mut header = tar::Header::new_gnu();
        header.as_gnu_mut().unwrap().name[..name.len()].copy_from_slice(name.as_bytes());
        header.set_entry_type(kind);
        header.set_size(body.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder.append(&header, body).unwrap();
    }

    fn tarball(entries: &[(&str, tar::EntryType, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::fast()));
        for (name, kind, body) in entries {
            raw_entry(&mut builder, name, *kind, body);
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    fn catalog() -> Origin {
        Origin { repo: "anthropics/claude-plugins-official".into(), sha: "a".repeat(40), path: String::new() }
    }

    #[test]
    fn github_urls_and_the_owner_repo_shorthand_name_a_repository() {
        assert_eq!(github_repo("https://github.com/o/r.git").as_deref(), Some("o/r"));
        assert_eq!(github_repo("https://github.com/o/r/").as_deref(), Some("o/r"));
        assert_eq!(github_repo("git@github.com:o/r.git").as_deref(), Some("o/r"));
        assert_eq!(github_repo("o/r").as_deref(), Some("o/r"));
        assert_eq!(github_repo("https://gitlab.com/o/r.git"), None);
        assert_eq!(github_repo("https://github.com/o"), None);
        assert_eq!(github_repo("o/.."), None);
    }

    #[test]
    fn every_source_shape_seen_in_the_catalogs_resolves() {
        let sha = "b".repeat(40);
        let relative = wanted(&json!("./plugins/code-review"), &catalog()).unwrap();
        assert_eq!(relative, Wanted { repo: catalog().repo, reference: "a".repeat(40), path: "plugins/code-review".into() });

        let url = wanted(&json!({ "source": "url", "url": "https://github.com/o/r.git", "sha": sha }), &catalog()).unwrap();
        assert_eq!(url, Wanted { repo: "o/r".into(), reference: sha.clone(), path: String::new() });

        let subdir = wanted(&json!({ "source": "git-subdir", "url": "o/r", "path": "plugins/x", "ref": "v1.5.5", "sha": sha }), &catalog()).unwrap();
        assert_eq!(subdir, Wanted { repo: "o/r".into(), reference: sha.clone(), path: "plugins/x".into() });

        let github = wanted(&json!({ "source": "github", "repo": "o/r", "ref": "main" }), &catalog()).unwrap();
        assert_eq!(github, Wanted { repo: "o/r".into(), reference: "main".into(), path: String::new() });
    }

    #[test]
    fn sources_sens_cannot_fetch_are_refused() {
        for source in [
            json!({ "source": "npm", "package": "x" }),
            json!({ "source": "url", "url": "https://gitlab.com/o/r.git" }),
            json!({ "source": "archive", "url": "https://x/y.zip" }),
            json!(42),
        ] {
            assert_eq!(wanted(&source, &catalog()).unwrap_err(), unsupported());
        }
        assert!(wanted(&json!("../fuera"), &catalog()).is_err());
        assert!(wanted(&json!({ "source": "git-subdir", "url": "o/r", "path": "../x" }), &catalog()).is_err());
    }

    #[test]
    fn only_the_wanted_folder_is_extracted_and_nothing_escapes() {
        let root = temp_root("extract");
        let archive = tarball(&[
            ("repo-sha/plugins/x/.claude-plugin/plugin.json", tar::EntryType::Regular, b"{\"name\":\"x\"}"),
            ("repo-sha/plugins/x/skills/a/SKILL.md", tar::EntryType::Regular, b"# a"),
            ("repo-sha/plugins/x/../../fuera.txt", tar::EntryType::Regular, b"x"),
            ("repo-sha/plugins/x/atajo", tar::EntryType::Symlink, b""),
            ("repo-sha/plugins/y/otro.md", tar::EntryType::Regular, b"y"),
            ("repo-sha/README.md", tar::EntryType::Regular, b"raiz"),
        ]);

        let count = extract(&archive, "plugins/x", &root.join("dentro"), LIMITS).unwrap();

        assert_eq!(count, 2);
        let listed: Vec<String> = files(&root.join("dentro")).into_iter().map(|row| row.path).collect();
        assert_eq!(listed, vec![".claude-plugin/plugin.json", "skills/a/SKILL.md"]);
        assert!(!root.join("fuera.txt").exists());
        assert!(!root.join("dentro").join("atajo").exists());
    }

    #[test]
    fn a_name_windows_reads_as_a_drive_or_a_stream_is_skipped() {
        let root = temp_root("extract-drive");
        let archive = tarball(&[
            ("repo-sha/plugins/x/C:sens-fuera.txt", tar::EntryType::Regular, b"x"),
            ("repo-sha/plugins/x/a.md:flujo", tar::EntryType::Regular, b"x"),
            ("repo-sha/plugins/x/C:carpeta/b.md", tar::EntryType::Regular, b"x"),
            ("repo-sha/plugins/x/ok.md", tar::EntryType::Regular, b"ok"),
        ]);

        let count = extract(&archive, "plugins/x", &root.join("dentro"), LIMITS).unwrap();

        assert_eq!(count, 1);
        let listed: Vec<String> = files(&root.join("dentro")).into_iter().map(|row| row.path).collect();
        assert_eq!(listed, vec!["ok.md"]);
        assert!(!Path::new("C:sens-fuera.txt").exists());
    }

    #[test]
    fn the_whole_repository_comes_out_when_no_folder_is_asked() {
        let root = temp_root("extract-all");
        let archive = tarball(&[("repo-sha/a.md", tar::EntryType::Regular, b"a"), ("repo-sha/b/c.md", tar::EntryType::Regular, b"c")]);
        assert_eq!(extract(&archive, "", &root, LIMITS).unwrap(), 2);
        assert_eq!(read(&root, "b/c.md").unwrap(), "c");
    }

    #[test]
    fn too_many_files_or_bytes_or_a_missing_folder_are_errors() {
        let root = temp_root("extract-caps");
        let archive = tarball(&[
            ("t/p/a", tar::EntryType::Regular, b"12345"),
            ("t/p/b", tar::EntryType::Regular, b"12345"),
            ("t/p/c", tar::EntryType::Regular, b"12345"),
        ]);
        assert!(extract(&archive, "p", &root.join("1"), Limits { files: 2, bytes: 1_000 }).unwrap_err().contains("more than 2"));
        assert!(extract(&archive, "p", &root.join("2"), Limits { files: 10, bytes: 12 }).is_err());
        assert!(extract(&archive, "nada", &root.join("3"), LIMITS).unwrap_err().contains("doesn’t exist"));
        let spoken = speaking(Language::Es, || extract(&archive, "p", &root.join("4"), Limits { files: 2, bytes: 1_000 }));
        assert_eq!(spoken.unwrap_err(), "tiene más de 2 ficheros");
        let spoken = speaking(Language::Zh, || extract(&archive, "nada", &root.join("5"), LIMITS));
        assert_eq!(spoken.unwrap_err(), "仓库中不存在 nada");
    }

    #[test]
    fn reading_stays_inside_the_folder_and_refuses_binaries() {
        let root = temp_root("read");
        write(&root.join("a.md"), b"hola").unwrap();
        write(&root.join("b.bin"), &[0xff, 0xfe, 0x00]).unwrap();
        write(&root.parent().unwrap().join("sens-snapshot-secreto.txt"), b"x").unwrap();

        assert_eq!(read(&root, "a.md").unwrap(), "hola");
        assert!(read(&root, "b.bin").unwrap_err().contains("isn’t text"));
        assert!(read(&root, "../sens-snapshot-secreto.txt").is_err());
        assert!(read(&root, "nada.md").is_err());
    }

    #[test]
    fn a_skills_sh_download_is_written_with_the_same_checks() {
        let base = temp_root("files");
        let files = vec![
            ("SKILL.md".to_string(), "---\nname: a\ndescription: b\n---\n".to_string()),
            ("scripts/run.py".to_string(), "print(1)".to_string()),
        ];
        let folder = ensure_files(&base, "o/r/a", &files).unwrap();
        assert_eq!(read(&folder, "scripts/run.py").unwrap(), "print(1)");
        assert_eq!(ensure_files(&base, "o/r/a", &files).unwrap(), folder);

        let escaping = vec![("../fuera.md".to_string(), "x".to_string())];
        assert!(ensure_files(&base, "o/r/b", &escaping).is_err());
        assert!(!base.join("market").join("fuera.md").exists());
        assert_eq!(std::fs::read_dir(repos(&base)).unwrap().count(), 1);
    }

    #[test]
    fn a_copy_takes_every_file_but_the_usage_marker() {
        let base = temp_root("copy");
        write(&base.join("desde").join("a").join("b.md"), b"b").unwrap();
        touch(&base.join("desde"));
        copy_tree(&base.join("desde"), &base.join("hasta")).unwrap();
        assert_eq!(files(&base.join("hasta")), vec![FileRow { path: "a/b.md".into(), size: 1 }]);
    }
}
