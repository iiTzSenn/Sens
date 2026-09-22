use std::path::Path;

use sens_hook::gate::Patch;

pub fn write(root: &Path, patch: &Patch) -> Result<(), String> {
    for file in &patch.files {
        let target = root.join(&file.path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("no pude crear {}: {error}", parent.display()))?;
        }
        std::fs::write(&target, &file.after)
            .map_err(|error| format!("no pude escribir {}: {error}", target.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sens_hook::gate::FilePatch;

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

        assert_eq!(std::fs::read_to_string(root.join("a.rs")).unwrap(), "nuevo\n");
    }
}
