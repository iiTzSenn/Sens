use std::cmp::Reverse;
use std::path::Path;

use sens_agent::chat::BYPASS;
use sens_agent::said;
use sens_agent::session::{self, Summary};
use serde::{Deserialize, Serialize};

const FILE: &str = "projects.json";

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    pub last: Option<String>,
    pub projects: Vec<Known>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Known {
    pub root: String,
    pub opened: u64,
    #[serde(default)]
    pub trusted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub root: String,
    pub name: String,
    pub active_at: u64,
    pub sessions: Vec<Summary>,
    pub trusted: bool,
}

impl Registry {
    fn known(&mut self, root: &str) -> &mut Known {
        let at = match self.projects.iter().position(|known| known.root == root) {
            Some(at) => at,
            None => {
                self.projects.push(Known {
                    root: root.to_string(),
                    opened: 0,
                    trusted: false,
                });
                self.projects.len() - 1
            }
        };
        &mut self.projects[at]
    }

    fn note(&mut self, root: &str, at: u64) {
        self.known(root).opened = at;
        self.last = Some(root.to_string());
    }
}

pub fn load(base: &Path) -> Registry {
    crate::store::stored(&base.join(FILE))
}

pub fn remember(base: &Path, root: &str) -> Result<(), String> {
    crate::store::update(base, FILE, |registry: &mut Registry| {
        registry.note(root, session::now());
        Ok(())
    })
}

pub fn register(base: &Path, root: &str) -> Result<(), String> {
    crate::store::update(base, FILE, |registry: &mut Registry| {
        registry.known(root);
        Ok(())
    })
}

pub fn trust(base: &Path, root: &str, trusted: bool) -> Result<(), String> {
    crate::store::update(base, FILE, |registry: &mut Registry| {
        match registry.projects.iter().position(|known| known.root == root) {
            Some(at) => registry.projects[at].trusted = trusted,
            None if trusted => registry.known(root).trusted = true,
            None => {}
        }
        Ok(())
    })
}

pub fn trusted(registry: &Registry, root: &str) -> bool {
    registry.projects.iter().any(|known| known.root == root && known.trusted)
}

pub fn allows(registry: &Registry, root: &str, mode: &str) -> Result<(), String> {
    match mode == BYPASS && !trusted(registry, root) {
        true => Err(said!(
            en: "No checks only acts in trusted projects: trust this folder from the permissions picker",
            es: "Sin control solo actúa en proyectos de confianza: confía en esta carpeta desde el selector de permisos",
            fr: "Sans contrôle n’agit que dans les projets de confiance : faites confiance à ce dossier depuis le sélecteur d’autorisations",
            de: "Ohne Kontrolle wirkt nur in vertrauenswürdigen Projekten: vertraue diesem Ordner in der Auswahl der Berechtigungen",
            ja: "「確認なし」は信頼できるプロジェクトでのみ使えます。権限の選択からこのフォルダーを信頼してください",
            zh: "“无需确认”仅在受信任的项目中生效：请在权限选择器中信任此文件夹",
        )),
        false => Ok(()),
    }
}

pub fn last(registry: &Registry) -> Option<String> {
    registry.last.clone().filter(|root| Path::new(root).is_dir())
}

pub fn workspaces(registry: &Registry) -> Vec<Workspace> {
    let mut found: Vec<Workspace> = registry
        .projects
        .iter()
        .filter(|known| Path::new(&known.root).is_dir())
        .map(workspace)
        .collect();
    found.sort_by_key(|space| Reverse(space.active_at));
    found
}

fn workspace(known: &Known) -> Workspace {
    let root = Path::new(&known.root);
    let sessions: Vec<Summary> = session::list(root)
        .into_iter()
        .filter(|summary| summary.tasks > 0)
        .collect();

    Workspace {
        root: known.root.clone(),
        name: name_of(root),
        active_at: sessions
            .iter()
            .map(|summary| summary.started_at)
            .max()
            .unwrap_or(known.opened),
        sessions,
        trusted: known.trusted,
    }
}

pub fn name_of(root: &Path) -> String {
    root.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use sens_agent::language::{Language, speaking};
    use sens_agent::session::Entry;

    fn temp_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("sens-projects-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn text(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    fn session_with_tasks(root: &Path, at: u64, tasks: usize) {
        let id = format!("s{at}");
        session::append(root, &id, &Entry::Opened { at, root: text(root) }).unwrap();
        for step in 0..tasks {
            let entry = Entry::Task { at: at + 1 + step as u64, text: "algo".into(), files: Vec::new(), images: Vec::new() };
            session::append(root, &id, &entry).unwrap();
        }
    }

    fn known(root: &Path, opened: u64) -> Known {
        Known { root: text(root), opened, trusted: false }
    }

    #[test]
    fn remembering_a_project_adds_it_and_marks_it_as_the_last_one() {
        let base = temp_root("insert").join("datos");
        remember(&base, "C:/proyectos/coinpla").unwrap();

        let registry = load(&base);
        assert_eq!(registry.projects.len(), 1);
        assert_eq!(registry.projects[0].root, "C:/proyectos/coinpla");
        assert!(registry.projects[0].opened > 0);
        assert_eq!(registry.last.as_deref(), Some("C:/proyectos/coinpla"));
    }

    #[test]
    fn remembering_a_known_project_again_updates_it_without_duplicating() {
        let base = temp_root("update");
        remember(&base, "C:/a").unwrap();
        remember(&base, "C:/b").unwrap();
        let before = load(&base).projects[0].opened;
        std::thread::sleep(std::time::Duration::from_millis(3));
        remember(&base, "C:/a").unwrap();

        let registry = load(&base);
        assert_eq!(registry.projects.len(), 2);
        assert!(registry.projects[0].opened > before);
        assert_eq!(registry.last.as_deref(), Some("C:/a"));
    }

    #[test]
    fn registering_a_project_adds_it_without_making_it_the_last_one() {
        let base = temp_root("register");
        remember(&base, "C:/a").unwrap();
        let opened = load(&base).projects[0].opened;

        register(&base, "C:/b").unwrap();
        register(&base, "C:/a").unwrap();
        register(&base, "C:/b").unwrap();

        let registry = load(&base);
        assert_eq!(registry.last.as_deref(), Some("C:/a"));
        assert_eq!(registry.projects.len(), 2);
        assert_eq!(registry.projects[0].opened, opened);
        assert_eq!(registry.projects[1].root, "C:/b");
        assert_eq!(registry.projects[1].opened, 0);
    }

    #[test]
    fn trusting_a_folder_is_remembered_and_lets_sin_control_act_only_there() {
        let base = temp_root("trust");
        remember(&base, "C:/a").unwrap();
        remember(&base, "C:/b").unwrap();
        assert!(allows(&load(&base), "C:/a", BYPASS).is_err());

        trust(&base, "C:/a", true).unwrap();
        remember(&base, "C:/a").unwrap();
        let registry = load(&base);
        assert!(trusted(&registry, "C:/a"));
        assert!(!trusted(&registry, "C:/b"));
        assert!(allows(&registry, "C:/a", BYPASS).is_ok());
        assert!(allows(&registry, "C:/b", BYPASS).is_err());
        assert!(allows(&registry, "C:/b", "acceptEdits").is_ok());
        assert_eq!(registry.projects.len(), 2);

        trust(&base, "C:/a", false).unwrap();
        assert!(allows(&load(&base), "C:/a", BYPASS).is_err());

        trust(&base, "C:/nunca", false).unwrap();
        assert_eq!(load(&base).projects.len(), 2);
    }

    #[test]
    fn an_untrusted_folder_is_explained_in_the_language_spoken() {
        let registry = Registry::default();

        assert!(allows(&registry, "C:/a", BYPASS).unwrap_err().starts_with("No checks only acts in trusted projects"));
        assert!(speaking(Language::Es, || allows(&registry, "C:/a", BYPASS)).unwrap_err().starts_with("Sin control solo actúa"));
        assert!(speaking(Language::De, || allows(&registry, "C:/a", BYPASS)).unwrap_err().starts_with("Ohne Kontrolle"));
    }

    #[test]
    fn the_rail_learns_which_folders_are_trusted() {
        let base = temp_root("trust-rail");
        let (sure, unsure) = (temp_root("trust-rail-sure"), temp_root("trust-rail-unsure"));
        remember(&base, &text(&sure)).unwrap();
        remember(&base, &text(&unsure)).unwrap();
        trust(&base, &text(&sure), true).unwrap();
        let trusted: Vec<(String, bool)> = workspaces(&load(&base)).into_iter().map(|space| (space.root, space.trusted)).collect();
        assert!(trusted.contains(&(text(&sure), true)));
        assert!(trusted.contains(&(text(&unsure), false)));
    }

    #[test]
    fn a_registry_saved_before_trust_existed_trusts_nothing() {
        let base = temp_root("before-trust");
        std::fs::write(base.join(FILE), r#"{ "last": "C:/a", "projects": [{ "root": "C:/a", "opened": 5 }] }"#).unwrap();
        let registry = load(&base);
        assert_eq!(registry.projects[0].opened, 5);
        assert!(!trusted(&registry, "C:/a"));
    }

    #[test]
    fn a_missing_registry_loads_as_empty_instead_of_failing() {
        let registry = load(&temp_root("missing"));
        assert!(registry.last.is_none());
        assert!(registry.projects.is_empty());
    }

    #[test]
    fn a_corrupt_registry_loads_as_empty_instead_of_failing() {
        let base = temp_root("corrupt");
        std::fs::write(base.join(FILE), "{ esto no es json").unwrap();

        let registry = load(&base);
        assert!(registry.last.is_none());
        assert!(registry.projects.is_empty());
    }

    #[test]
    fn workspaces_hide_sessions_where_nothing_was_asked() {
        let root = temp_root("empty-sessions");
        session_with_tasks(&root, 100, 0);
        session_with_tasks(&root, 200, 2);

        let registry = Registry { last: None, projects: vec![known(&root, 1)] };
        let found = workspaces(&registry);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].sessions.len(), 1);
        assert_eq!(found[0].sessions[0].id, "s200");
        assert_eq!(found[0].active_at, 200);
        assert_eq!(found[0].name, "sens-projects-empty-sessions");
    }

    #[test]
    fn workspaces_come_back_most_recently_active_first() {
        let quiet = temp_root("quiet");
        let busy = temp_root("busy");
        let fresh = temp_root("fresh");
        session_with_tasks(&quiet, 100, 1);
        session_with_tasks(&busy, 900, 1);

        let registry = Registry {
            last: None,
            projects: vec![known(&quiet, 50), known(&busy, 60), known(&fresh, 500)],
        };
        let order: Vec<u64> = workspaces(&registry).iter().map(|found| found.active_at).collect();

        assert_eq!(order, vec![900, 500, 100]);
    }

    #[test]
    fn a_project_without_sessions_still_shows_up_with_its_opening_time() {
        let root = temp_root("no-sessions");
        let registry = Registry { last: None, projects: vec![known(&root, 42)] };

        let found = workspaces(&registry);

        assert_eq!(found.len(), 1);
        assert!(found[0].sessions.is_empty());
        assert_eq!(found[0].active_at, 42);
    }

    #[test]
    fn a_project_whose_folder_is_gone_is_left_out() {
        let kept = temp_root("kept");
        let gone = temp_root("gone");
        std::fs::remove_dir_all(&gone).unwrap();

        let registry = Registry {
            last: Some(text(&gone)),
            projects: vec![known(&kept, 1), known(&gone, 2)],
        };

        let found = workspaces(&registry);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].root, text(&kept));
        assert!(last(&registry).is_none());
    }
}
