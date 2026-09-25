use std::path::Path;
use std::process::Command;

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    pub branch: String,
    pub detached: bool,
    pub dirty: usize,
    pub branches: Vec<String>,
}

pub fn read(root: &Path) -> Option<Repo> {
    if say(root, &["rev-parse", "--is-inside-work-tree"])? != "true" {
        return None;
    }

    let named = say(root, &["symbolic-ref", "--quiet", "--short", "HEAD"]);
    let detached = named.is_none();
    let branch = match named {
        Some(name) => name,
        None => say(root, &["rev-parse", "--short", "HEAD"])?,
    };

    Some(Repo {
        branch,
        detached,
        dirty: say(root, &["status", "--porcelain"])
            .map(|listed| listed.lines().filter(|line| !line.trim().is_empty()).count())
            .unwrap_or_default(),
        branches: say(root, &["for-each-ref", "--format=%(refname:short)", "refs/heads"])
            .map(|listed| listed.lines().map(str::to_string).collect())
            .unwrap_or_default(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    pub diff: String,
    pub fresh: Vec<String>,
}

const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

pub fn changes(root: &Path) -> Option<Changes> {
    if say(root, &["rev-parse", "--is-inside-work-tree"])? != "true" {
        return None;
    }
    let base = match say(root, &["rev-parse", "--verify", "--quiet", "HEAD"]) {
        Some(_) => "HEAD",
        None => EMPTY_TREE,
    };
    Some(Changes {
        diff: say(root, &["-c", "core.quotePath=false", "diff", base, "--no-color", "--no-ext-diff", "--find-renames"])
            .unwrap_or_default(),
        fresh: say(root, &["-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard"])
            .map(|listed| listed.lines().map(str::to_string).collect())
            .unwrap_or_default(),
    })
}

pub fn checkout(root: &Path, branch: &str) -> Result<Repo, String> {
    ran(git(root, &["checkout", branch]), &format!("git no pudo cambiar a {branch}"))?;
    read(root).ok_or_else(|| format!("{branch} dejó de leerse como repositorio"))
}

pub fn add_worktree(root: &Path, path: &Path, branch: &str) -> Result<String, String> {
    let head = say(root, &["rev-parse", "--short", "--verify", "--quiet", "HEAD"]).ok_or("el proyecto no tiene ningún commit del que partir")?;
    let base = say(root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).unwrap_or(head);
    ran(git(root, &["worktree", "add", "-b", branch, &path.to_string_lossy(), "HEAD"]), "git no pudo crear el worktree")?;
    Ok(base)
}

pub fn remove_worktree(root: &Path, path: &Path) -> Result<(), String> {
    ran(git(root, &["worktree", "remove", &path.to_string_lossy()]), "git no pudo quitar el worktree")
}

pub fn delete_branch(root: &Path, branch: &str) -> Result<(), String> {
    ran(git(root, &["branch", "-D", branch]), &format!("git no pudo borrar la rama {branch}"))
}

pub fn dirty(root: &Path) -> bool {
    say(root, &["status", "--porcelain"]).is_some_and(|listed| !listed.is_empty())
}

fn ran(mut command: Command, failed: &str) -> Result<(), String> {
    let done = command.output().map_err(|error| format!("no pude lanzar git: {error}"))?;
    if done.status.success() {
        return Ok(());
    }
    let said = String::from_utf8_lossy(&done.stderr).trim().to_string();
    Err(if said.is_empty() { failed.to_string() } else { said })
}

fn git(root: &Path, args: &[&str]) -> Command {
    let mut command = Command::new("git");
    command.arg("-C").arg(root).args(args);
    hush(&mut command);
    command
}

fn say(root: &Path, args: &[&str]) -> Option<String> {
    let done = git(root, args).output().ok()?;
    done.status
        .success()
        .then(|| String::from_utf8_lossy(&done.stdout).trim().to_string())
}

#[cfg(windows)]
fn hush(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hush(_command: &mut Command) {}
