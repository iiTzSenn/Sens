use std::collections::HashSet;
use std::fs::{self, Permissions};
use std::io::{ErrorKind, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::SystemTime;

use sens_hook::gate::Patch;

static NEXT: AtomicU64 = AtomicU64::new(0);

pub struct Origin {
    pub path: String,
    pub text: Option<String>,
    modified: Option<SystemTime>,
    permissions: Option<Permissions>,
}

pub struct Transaction {
    root: PathBuf,
    pub origins: Vec<Origin>,
    after: Vec<String>,
    written: usize,
    directories: Vec<PathBuf>,
    backup: Option<PathBuf>,
}

impl Transaction {
    pub fn prepare(root: &Path, patch: &Patch) -> Result<Self, String> {
        let root = root.canonicalize().map_err(|error| error.to_string())?;
        let mut seen = HashSet::new();
        let mut origins = Vec::new();
        for file in &patch.files {
            let target = target(&root, &file.path)?;
            let identity = target.to_string_lossy().to_string();
            let identity = if cfg!(windows) {
                identity.to_lowercase()
            } else {
                identity
            };
            if !seen.insert(identity) {
                return Err(format!("ruta repetida: {}", file.path));
            }
            let text = read(&target)?;
            let metadata = text
                .as_ref()
                .map(|_| fs::metadata(&target))
                .transpose()
                .map_err(|error| error.to_string())?;
            origins.push(Origin {
                path: file.path.clone(),
                text,
                modified: metadata
                    .as_ref()
                    .map(|meta| meta.modified())
                    .transpose()
                    .map_err(|error| error.to_string())?,
                permissions: metadata.map(|meta| meta.permissions()),
            });
        }
        Ok(Self {
            root,
            origins,
            after: patch.files.iter().map(|file| file.after.clone()).collect(),
            written: 0,
            directories: Vec::new(),
            backup: None,
        })
    }

    pub fn apply(&mut self) -> Result<(), String> {
        self.apply_with(|_, path, text, permissions| replace(path, text, permissions))
    }

    fn apply_with(
        &mut self,
        mut write: impl FnMut(usize, &Path, &str, Option<&Permissions>) -> Result<(), String>,
    ) -> Result<(), String> {
        if self.backup.is_some() || self.written != 0 {
            return Err("la transacción ya se ha utilizado".into());
        }
        self.verify_originals()?;
        self.save()?;
        let result = (|| {
            for index in 0..self.origins.len() {
                let origin = &self.origins[index];
                let path = target(&self.root, &origin.path)?;
                verify(&path, origin)?;
                make_parents(&path, &mut self.directories)?;
                write(
                    index,
                    &path,
                    &self.after[index],
                    origin.permissions.as_ref(),
                )?;
                self.written = index + 1;
            }
            self.verify_applied()
        })();
        if let Err(reason) = result {
            return match self.rollback() {
                Ok(()) => Err(reason),
                Err(recovery) => Err(format!("{reason}; {recovery}")),
            };
        }
        Ok(())
    }

    pub fn verify_originals(&self) -> Result<(), String> {
        for origin in &self.origins {
            verify(&target(&self.root, &origin.path)?, origin)?;
        }
        Ok(())
    }

    pub fn verify_applied(&self) -> Result<(), String> {
        for (origin, expected) in self.origins.iter().zip(&self.after) {
            let result = target(&self.root, &origin.path).and_then(|path| read(&path));
            match result {
                Ok(current) if current.as_deref() == Some(expected.as_str()) => {}
                other => {
                    let reason = other
                        .err()
                        .unwrap_or_else(|| format!("{} cambió durante la operación", origin.path));
                    return Err(format!(
                        "{reason}. Respaldo: {}",
                        self.backup.as_deref().unwrap_or(&self.root).display()
                    ));
                }
            }
        }
        Ok(())
    }

    pub fn rollback(&mut self) -> Result<(), String> {
        let mut errors = Vec::new();
        for index in (0..self.written).rev() {
            let origin = &self.origins[index];
            let result = (|| {
                let path = target(&self.root, &origin.path)?;
                let current = read(&path)?;
                if current != origin.text {
                    if current.as_deref() != Some(self.after[index].as_str()) {
                        return Err(format!(
                            "{} cambió; no sobrescribo cambios ajenos",
                            origin.path
                        ));
                    }
                    match &origin.text {
                        Some(text) => replace(&path, text, origin.permissions.as_ref())?,
                        None => fs::remove_file(&path).map_err(|error| error.to_string())?,
                    }
                }
                if let Some(stamp) = origin.modified {
                    fs::OpenOptions::new()
                        .write(true)
                        .open(&path)
                        .and_then(|file| file.set_times(fs::FileTimes::new().set_modified(stamp)))
                        .map_err(|error| error.to_string())?;
                }
                verify(&path, origin)
            })();
            if let Err(error) = result {
                errors.push(format!("{}: {error}", origin.path));
            }
        }
        for directory in self.directories.iter().rev() {
            if let Err(error) = fs::remove_dir(directory) {
                if error.kind() != ErrorKind::NotFound {
                    errors.push(format!("{}: {error}", directory.display()));
                }
            }
        }
        if !errors.is_empty() {
            return Err(format!(
                "recuperación incompleta: {}. Respaldo: {}",
                errors.join("; "),
                self.backup.as_deref().unwrap_or(&self.root).display()
            ));
        }
        self.written = 0;
        self.directories.clear();
        self.clean();
        Ok(())
    }

    pub fn commit(mut self) -> Result<(), String> {
        self.verify_applied()?;
        self.clean();
        Ok(())
    }

    pub fn expect(&mut self, patch: &Patch) -> Result<(), String> {
        if !self
            .origins
            .iter()
            .map(|origin| &origin.path)
            .eq(patch.files.iter().map(|file| &file.path))
        {
            return Err("la transacción cambió de ficheros".into());
        }
        self.after = patch.files.iter().map(|file| file.after.clone()).collect();
        self.verify_applied()
    }

    fn save(&mut self) -> Result<(), String> {
        let directory = fs::canonicalize(std::env::temp_dir())
            .map_err(|error| error.to_string())?
            .join(unique("sens-recovery"));
        fs::create_dir(&directory).map_err(|error| error.to_string())?;
        self.backup = Some(directory.clone());
        let result = (|| {
            let mut files = Vec::new();
            for (index, origin) in self.origins.iter().enumerate() {
                if let Some(text) = &origin.text {
                    durable(&directory.join(index.to_string()), text.as_bytes())?;
                }
                files.push(serde_json::json!({
                    "path": origin.path,
                    "existed": origin.text.is_some(),
                    "backup": index.to_string(),
                    "modified": origin.modified,
                    "readonly": origin.permissions.as_ref().map(Permissions::readonly)
                }));
            }
            let manifest = serde_json::json!({"root": self.root, "files": files});
            durable(
                &directory.join("manifest.json"),
                manifest.to_string().as_bytes(),
            )
        })();
        if result.is_err() {
            self.clean();
        }
        result
    }

    fn clean(&mut self) {
        if let Some(directory) = self.backup.take() {
            for index in 0..self.origins.len() {
                let _ = fs::remove_file(directory.join(index.to_string()));
            }
            let _ = fs::remove_file(directory.join("manifest.json"));
            let _ = fs::remove_dir(directory);
        }
    }
}

fn target(root: &Path, path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(path);
    if path.is_empty()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        || path.split(['/', '\\']).any(|part| {
            let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            part.is_empty()
                || part == "."
                || part == ".."
                || part.contains(':')
                || part.ends_with(['.', ' '])
                || part.eq_ignore_ascii_case(".git")
                || part.eq_ignore_ascii_case(".sens")
                || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                || (stem.len() == 4
                    && (stem.starts_with("COM") || stem.starts_with("LPT"))
                    && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        })
    {
        return Err(format!("ruta no permitida: {path}"));
    }
    let mut resolved = root.to_path_buf();
    for part in relative.components() {
        resolved.push(part);
        match fs::symlink_metadata(&resolved) {
            Ok(meta) => {
                if linked(&meta) {
                    return Err(format!("no escribo a través de enlaces: {path}"));
                }
                let canonical = resolved.canonicalize().map_err(|error| error.to_string())?;
                if !canonical.starts_with(root) {
                    return Err(format!("ruta fuera del proyecto: {path}"));
                }
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(format!("{path}: {error}")),
        }
    }
    Ok(resolved)
}

fn linked(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    metadata.file_type().is_symlink()
}

fn read(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("{}: {error}", path.display())),
    }
}

fn verify(path: &Path, origin: &Origin) -> Result<(), String> {
    if read(path)? != origin.text {
        return Err(format!("{} cambió desde la revisión", origin.path));
    }
    if let Some(stamp) = origin.modified {
        let meta = fs::metadata(path).map_err(|error| error.to_string())?;
        if meta.modified().map_err(|error| error.to_string())? != stamp {
            return Err(format!("{} cambió desde la revisión", origin.path));
        }
    }
    Ok(())
}

fn make_parents(path: &Path, created: &mut Vec<PathBuf>) -> Result<(), String> {
    let mut missing = Vec::new();
    let mut parent = path.parent();
    while let Some(directory) = parent {
        if directory.exists() {
            break;
        }
        missing.push(directory.to_path_buf());
        parent = directory.parent();
    }
    for directory in missing.into_iter().rev() {
        fs::create_dir(&directory).map_err(|error| error.to_string())?;
        created.push(directory);
    }
    Ok(())
}

fn unique(prefix: &str) -> String {
    let ticks = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "{prefix}-{}-{ticks}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

fn durable(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| error.to_string())
}

fn replace(path: &Path, text: &str, permissions: Option<&Permissions>) -> Result<(), String> {
    let stage = path.with_file_name(unique(".sens-write"));
    let result = (|| {
        durable(&stage, text.as_bytes())?;
        if let Some(permissions) = permissions {
            fs::set_permissions(&stage, permissions.clone()).map_err(|error| error.to_string())?;
        }
        fs::rename(&stage, path).map_err(|error| format!("{}: {error}", path.display()))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&stage);
    }
    result
}

pub fn write(root: &Path, patch: &Patch) -> Result<(), String> {
    let mut transaction = Transaction::prepare(root, patch)?;
    transaction.apply()?;
    transaction.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sens_hook::gate::FilePatch;

    fn patch(files: &[(&str, &str)]) -> Patch {
        Patch {
            files: files
                .iter()
                .map(|(path, after)| FilePatch {
                    path: (*path).into(),
                    before: String::new(),
                    after: (*after).into(),
                })
                .collect(),
        }
    }

    #[test]
    fn invalid_paths_reject_every_file_before_writing() {
        let root = temp_root("invalid-paths");
        fs::write(root.join("a.rs"), "original").unwrap();
        for path in [
            "../escape.rs",
            "/escape.rs",
            "C:\\escape.rs",
            "a.rs:stream",
            ".git/config",
            ".sens/index.bin",
            "a/../b.rs",
            "NUL",
            "a.rs.",
            "a.rs ",
        ] {
            assert!(
                write(&root, &patch(&[("a.rs", "changed"), (path, "bad")])).is_err(),
                "{path}"
            );
            assert_eq!(fs::read_to_string(root.join("a.rs")).unwrap(), "original");
        }
    }

    #[test]
    fn empty_existing_files_survive_rollback_and_new_directories_do_not() {
        let root = temp_root("empty-rollback");
        fs::write(root.join("empty.rs"), "").unwrap();
        let mut transaction = Transaction::prepare(
            &root,
            &patch(&[("empty.rs", "changed"), ("new/deep/file.rs", "new")]),
        )
        .unwrap();
        transaction.apply().unwrap();
        let backup = transaction.backup.clone().unwrap();
        transaction.rollback().unwrap();
        assert_eq!(fs::read(root.join("empty.rs")).unwrap(), b"");
        assert!(!root.join("new").exists());
        assert!(!backup.exists());
    }

    #[test]
    fn a_second_write_failure_restores_the_first_file() {
        let root = temp_root("partial-write");
        fs::write(root.join("a.rs"), "old a").unwrap();
        fs::write(root.join("b.rs"), "old b").unwrap();
        let stamp = fs::metadata(root.join("a.rs")).unwrap().modified().unwrap();
        let mut transaction =
            Transaction::prepare(&root, &patch(&[("a.rs", "new a"), ("b.rs", "new b")])).unwrap();
        let result = transaction.apply_with(|index, path, text, permissions| {
            if index == 1 {
                return Err("fallo de escritura simulado".into());
            }
            replace(path, text, permissions)
        });
        assert!(result.unwrap_err().contains("simulado"));
        assert_eq!(fs::read_to_string(root.join("a.rs")).unwrap(), "old a");
        assert_eq!(fs::read_to_string(root.join("b.rs")).unwrap(), "old b");
        assert_eq!(
            fs::metadata(root.join("a.rs")).unwrap().modified().unwrap(),
            stamp
        );
    }

    #[test]
    fn concurrent_edits_before_apply_are_preserved() {
        let root = temp_root("concurrent-before");
        fs::write(root.join("a.rs"), "old").unwrap();
        let mut transaction = Transaction::prepare(&root, &patch(&[("a.rs", "model")])).unwrap();
        fs::write(root.join("a.rs"), "human").unwrap();
        assert!(transaction.apply().unwrap_err().contains("cambió"));
        assert_eq!(fs::read_to_string(root.join("a.rs")).unwrap(), "human");
    }

    #[test]
    fn recovery_failure_keeps_backups_and_restores_other_files() {
        let root = temp_root("failed-recovery");
        fs::write(root.join("a.rs"), "old a").unwrap();
        fs::write(root.join("b.rs"), "old b").unwrap();
        let mut transaction =
            Transaction::prepare(&root, &patch(&[("a.rs", "new a"), ("b.rs", "new b")])).unwrap();
        transaction.apply().unwrap();
        fs::write(root.join("b.rs"), "human").unwrap();
        let backup = transaction.backup.clone().unwrap();
        let error = transaction.rollback().unwrap_err();
        assert!(error.contains("recuperación incompleta"));
        assert!(error.contains(backup.to_str().unwrap()));
        assert_eq!(fs::read_to_string(root.join("a.rs")).unwrap(), "old a");
        assert_eq!(fs::read_to_string(root.join("b.rs")).unwrap(), "human");
        assert_eq!(fs::read_to_string(backup.join("1")).unwrap(), "old b");
        assert!(backup.join("manifest.json").is_file());
        fs::write(root.join("b.rs"), "new b").unwrap();
        transaction.rollback().unwrap();
    }

    #[test]
    fn unreadable_originals_are_not_treated_as_missing() {
        let root = temp_root("binary-original");
        fs::write(root.join("a.rs"), [0xff, 0xfe]).unwrap();
        assert!(Transaction::prepare(&root, &patch(&[("a.rs", "new")])).is_err());
        assert_eq!(fs::read(root.join("a.rs")).unwrap(), [0xff, 0xfe]);
    }

    #[cfg(windows)]
    #[test]
    fn windows_aliases_cannot_write_the_same_file_twice() {
        let root = temp_root("alias-paths");
        assert!(Transaction::prepare(&root, &patch(&[("A.rs", "a"), ("a.rs", "b")])).is_err());
        assert!(
            Transaction::prepare(&root, &patch(&[("src/a.rs", "a"), ("src\\a.rs", "b")])).is_err()
        );
    }

    #[cfg(windows)]
    #[test]
    fn junctions_cannot_redirect_writes_outside_the_project() {
        let root = temp_root("junction-root");
        let outside = temp_root("junction-outside");
        let link = root.join("linked");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "{}",
            String::from_utf8_lossy(&status.stderr)
        );
        let result = write(&root, &patch(&[("linked/escape.rs", "bad")]));
        fs::remove_dir(&link).unwrap();
        assert!(result.unwrap_err().contains("enlaces"));
        assert!(!outside.join("escape.rs").exists());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_redirect_writes_outside_the_project() {
        let root = temp_root("symlink-root");
        let outside = temp_root("symlink-outside");
        std::os::unix::fs::symlink(&outside, root.join("linked")).unwrap();
        assert!(write(&root, &patch(&[("linked/escape.rs", "bad")])).is_err());
        assert!(!outside.join("escape.rs").exists());
    }

    fn temp_root(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("sens-agent-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_the_file_and_the_directories_it_needs() {
        let root = temp_root("apply-nested");
        let patch = Patch {
            files: vec![FilePatch {
                path: "src/deep/boot.rs".into(),
                before: String::new(),
                after: "fn boot() {}\n".into(),
            }],
        };

        write(&root, &patch).unwrap();

        let written = std::fs::read_to_string(root.join("src/deep/boot.rs")).unwrap();
        assert_eq!(written, "fn boot() {}\n");
    }

    #[test]
    fn replaces_what_was_there_before() {
        let root = temp_root("apply-replace");
        std::fs::write(root.join("a.rs"), "viejo\n").unwrap();
        let patch = Patch {
            files: vec![FilePatch {
                path: "a.rs".into(),
                before: "viejo\n".into(),
                after: "nuevo\n".into(),
            }],
        };

        write(&root, &patch).unwrap();

        assert_eq!(
            std::fs::read_to_string(root.join("a.rs")).unwrap(),
            "nuevo\n"
        );
    }
}
