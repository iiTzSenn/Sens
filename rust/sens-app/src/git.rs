use std::path::Path;
use std::process::Command;

use sens_agent::said;
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
    let failed = said!(
        en: "Git couldn’t switch to {branch}",
        es: "git no pudo cambiar a {branch}",
        fr: "Git n’a pas pu passer à {branch}",
        de: "Git konnte nicht zu {branch} wechseln",
        ja: "git で {branch} に切り替えられませんでした",
        zh: "git 无法切换到 {branch}",
    );
    ran(git(root, &["checkout", branch]), &failed)?;
    read(root).ok_or_else(|| {
        said!(
            en: "{branch} can no longer be read as a repository",
            es: "{branch} dejó de leerse como repositorio",
            fr: "{branch} ne se lit plus comme un dépôt",
            de: "{branch} lässt sich nicht mehr als Repository lesen",
            ja: "{branch} をリポジトリとして読み取れなくなりました",
            zh: "{branch} 已无法作为仓库读取",
        )
    })
}

pub fn add_worktree(root: &Path, path: &Path, branch: &str) -> Result<String, String> {
    let head = say(root, &["rev-parse", "--short", "--verify", "--quiet", "HEAD"]).ok_or_else(|| {
        said!(
            en: "the project has no commit to start from",
            es: "el proyecto no tiene ningún commit del que partir",
            fr: "le projet n’a aucun commit d’où partir",
            de: "das Projekt hat keinen Commit, von dem aus es losgehen kann",
            ja: "プロジェクトに起点となるコミットがありません",
            zh: "项目中没有可作为起点的提交",
        )
    })?;
    let base = say(root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).unwrap_or(head);
    let failed = said!(
        en: "Git couldn’t create the worktree",
        es: "git no pudo crear el worktree",
        fr: "Git n’a pas pu créer le worktree",
        de: "Git konnte den Worktree nicht erstellen",
        ja: "git でワークツリーを作成できませんでした",
        zh: "git 无法创建工作树",
    );
    ran(git(root, &["worktree", "add", "-b", branch, &path.to_string_lossy(), "HEAD"]), &failed)?;
    Ok(base)
}

pub fn remove_worktree(root: &Path, path: &Path) -> Result<(), String> {
    let failed = said!(
        en: "Git couldn’t remove the worktree",
        es: "git no pudo quitar el worktree",
        fr: "Git n’a pas pu supprimer le worktree",
        de: "Git konnte den Worktree nicht entfernen",
        ja: "git でワークツリーを削除できませんでした",
        zh: "git 无法移除工作树",
    );
    ran(git(root, &["worktree", "remove", &path.to_string_lossy()]), &failed)
}

pub fn delete_branch(root: &Path, branch: &str) -> Result<(), String> {
    let failed = said!(
        en: "Git couldn’t delete the branch {branch}",
        es: "git no pudo borrar la rama {branch}",
        fr: "Git n’a pas pu supprimer la branche {branch}",
        de: "Git konnte den Branch {branch} nicht löschen",
        ja: "git でブランチ {branch} を削除できませんでした",
        zh: "git 无法删除分支 {branch}",
    );
    ran(git(root, &["branch", "-D", branch]), &failed)
}

pub fn dirty(root: &Path) -> bool {
    say(root, &["status", "--porcelain"]).is_some_and(|listed| !listed.is_empty())
}

fn ran(mut command: Command, failed: &str) -> Result<(), String> {
    let done = command.output().map_err(|error| {
        said!(
            en: "couldn’t launch Git: {error}",
            es: "no pude lanzar git: {error}",
            fr: "impossible de lancer Git : {error}",
            de: "Git konnte nicht gestartet werden: {error}",
            ja: "git を起動できませんでした: {error}",
            zh: "无法启动 git：{error}",
        )
    })?;
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
