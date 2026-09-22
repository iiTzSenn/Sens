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

pub fn checkout(root: &Path, branch: &str) -> Result<Repo, String> {
    let done = git(root, &["checkout", branch])
        .output()
        .map_err(|error| format!("no pude lanzar git: {error}"))?;

    if !done.status.success() {
        let said = String::from_utf8_lossy(&done.stderr).trim().to_string();
        return Err(if said.is_empty() {
            format!("git no pudo cambiar a {branch}")
        } else {
            said
        });
    }

    read(root).ok_or_else(|| format!("{branch} dejó de leerse como repositorio"))
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
