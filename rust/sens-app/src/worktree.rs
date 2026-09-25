use std::path::{Path, PathBuf};

use sens_agent::session::{self, Isolation};

use crate::git;

const FOLDER: &str = "worktrees";
const SHORT: usize = 8;
const BEGUN: &str = "esta sesión ya empezó: su carpeta de trabajo no puede cambiar";

pub fn isolate(root: &Path, id: &str) -> Result<Isolation, String> {
    if !session::is_uuid(id) {
        return Err(format!("{id} no es un identificador de sesión válido"));
    }
    if let Some(known) = session::isolation(root, id) {
        return Ok(known);
    }
    if session::has_tasks(root, id) {
        return Err(BEGUN.into());
    }
    let short: String = id.chars().filter(char::is_ascii_hexdigit).take(SHORT).collect::<String>().to_ascii_lowercase();
    let path = root.join(".sens").join(FOLDER).join(&short);
    let branch = format!("sens/{short}");
    session::keep_from_git(root);
    let base = git::add_worktree(root, &path, &branch)?;
    let isolation = Isolation {
        path: path.to_string_lossy().into_owned(),
        branch,
        base,
    };
    if let Err(error) = session::isolate(root, id, &isolation) {
        let _ = git::remove_worktree(root, &path);
        let _ = git::delete_branch(root, &isolation.branch);
        return Err(error);
    }
    Ok(isolation)
}

pub fn work_dir(root: &Path, id: &str) -> Result<Option<PathBuf>, String> {
    let Some(isolation) = session::is_uuid(id).then(|| session::isolation(root, id)).flatten() else {
        return Ok(None);
    };
    let path = PathBuf::from(&isolation.path);
    if !path.is_dir() {
        return Err(format!("el worktree de esta sesión ya no está en {}", isolation.path));
    }
    Ok(Some(path))
}

pub fn release(root: &Path, id: &str, clear: impl FnOnce(&Path)) -> Result<(), String> {
    let Some(isolation) = session::is_uuid(id).then(|| session::isolation(root, id)).flatten() else {
        return Ok(());
    };
    let path = Path::new(&isolation.path);
    if !path.exists() {
        return Ok(());
    }
    if git::dirty(path) {
        return Err(format!(
            "el worktree de la rama {} tiene cambios sin confirmar: confírmalos o descártalos antes de eliminar la sesión",
            isolation.branch
        ));
    }
    clear(path);
    git::remove_worktree(root, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git_in(root: &Path, args: &[&str]) {
        let done = Command::new("git").arg("-C").arg(root).args(args).output().unwrap();
        assert!(done.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&done.stderr));
    }

    fn repo(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("sens-worktree-{name}"));
        if root.exists() {
            let _ = Command::new("git").arg("-C").arg(&root).args(["worktree", "prune"]).output();
            std::fs::remove_dir_all(&root).unwrap();
        }
        std::fs::create_dir_all(&root).unwrap();
        git_in(&root, &["init", "--quiet", "--initial-branch", "main"]);
        git_in(&root, &["config", "user.email", "sens@example.com"]);
        git_in(&root, &["config", "user.name", "Sens"]);
        std::fs::write(root.join("README.md"), "hola\n").unwrap();
        git_in(&root, &["add", "README.md"]);
        git_in(&root, &["commit", "--quiet", "-m", "primero"]);
        root
    }

    #[test]
    fn a_new_session_gets_a_worktree_on_a_branch_of_its_own_that_git_leaves_out() {
        let root = repo("isolate");
        let id = session::open(&root).unwrap();

        let isolation = isolate(&root, &id).unwrap();

        let short = &id[..SHORT];
        assert_eq!(isolation.branch, format!("sens/{short}"));
        assert_eq!(isolation.base, "main");
        let work = work_dir(&root, &id).unwrap().unwrap();
        assert_eq!(work, root.join(".sens").join(FOLDER).join(short));
        assert_eq!(std::fs::read_to_string(work.join("README.md")).unwrap().trim(), "hola");
        assert!(!git::dirty(&root));
        assert_eq!(isolate(&root, &id).unwrap(), isolation);
    }

    #[test]
    fn a_session_that_began_or_a_folder_without_git_stays_where_it_is() {
        let root = repo("begun");
        let id = session::open(&root).unwrap();
        session::append(&root, &id, &session::Entry::Task { at: 1, text: "hola".into(), files: Vec::new(), images: Vec::new() }).unwrap();
        assert_eq!(isolate(&root, &id), Err(BEGUN.to_string()));

        let plain = std::env::temp_dir().join("sens-worktree-plain");
        let _ = std::fs::remove_dir_all(&plain);
        std::fs::create_dir_all(&plain).unwrap();
        let id = session::open(&plain).unwrap();
        assert!(isolate(&plain, &id).is_err());
        assert_eq!(session::isolation(&plain, &id), None);
        assert_eq!(work_dir(&plain, &id), Ok(None));
    }

    #[test]
    fn a_repository_without_commits_says_so() {
        let root = std::env::temp_dir().join("sens-worktree-unborn");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        git_in(&root, &["init", "--quiet"]);
        let id = session::open(&root).unwrap();

        assert_eq!(isolate(&root, &id), Err("el proyecto no tiene ningún commit del que partir".to_string()));
        assert_eq!(session::isolation(&root, &id), None);
    }

    #[test]
    fn a_worktree_with_work_in_it_is_not_thrown_away() {
        let root = repo("release");
        let id = session::open(&root).unwrap();
        let isolation = isolate(&root, &id).unwrap();
        let work = PathBuf::from(&isolation.path);
        std::fs::write(work.join("nuevo.txt"), "a medias").unwrap();

        let mut cleared = Vec::new();
        assert!(release(&root, &id, |path| cleared.push(path.to_path_buf())).unwrap_err().contains("cambios sin confirmar"));
        assert!(cleared.is_empty());
        assert!(work.is_dir());

        std::fs::remove_file(work.join("nuevo.txt")).unwrap();
        release(&root, &id, |path| cleared.push(path.to_path_buf())).unwrap();
        assert_eq!(cleared, std::slice::from_ref(&work));
        assert!(!work.exists());
        assert!(work_dir(&root, &id).unwrap_err().contains("ya no está"));
        git_in(&root, &["rev-parse", "--verify", &isolation.branch]);
    }
}
