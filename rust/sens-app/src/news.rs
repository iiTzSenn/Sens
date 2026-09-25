use std::cmp::Reverse;

use serde::Serialize;
use serde_json::Value;

use crate::update::{self, Number};

const ALERT: &str = "> [!";
const INSTALL: &str = "install";
const SEPARATORS: [char; 6] = [' ', '—', '–', '-', ':', '·'];

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct News {
    pub version: String,
    pub title: String,
    pub notes: String,
    pub page: String,
    pub published: String,
}

pub fn since(seen: &str) -> Result<Vec<News>, String> {
    Ok(between(&update::listed()?, seen, update::current()))
}

fn between(listed: &Value, seen: &str, current: &str) -> Vec<News> {
    let Some(installed) = update::number(current) else {
        return Vec::new();
    };
    let after = update::number(seen).filter(|after| *after < installed);
    let mut found: Vec<(Number, News)> = listed
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(told)
        .filter(|(version, _)| match after {
            Some(after) => *version > after && *version <= installed,
            None => *version == installed,
        })
        .collect();
    found.sort_by_key(|(version, _)| Reverse(*version));
    found.into_iter().map(|(_, news)| news).collect()
}

fn told(entry: &Value) -> Option<(Number, News)> {
    let (found, version) = update::published(entry)?;
    let news = News {
        version: version.to_string(),
        title: title(entry["name"].as_str().unwrap_or_default(), entry["tag_name"].as_str()?),
        notes: notes(entry["body"].as_str().unwrap_or_default()),
        page: entry["html_url"].as_str()?.to_string(),
        published: entry["published_at"].as_str().unwrap_or_default().to_string(),
    };
    Some((found, news))
}

fn title(name: &str, tag: &str) -> String {
    name.strip_prefix(tag).map_or(name, |rest| rest.trim_start_matches(SEPARATORS)).trim().to_string()
}

fn notes(body: &str) -> String {
    body.lines().take_while(|line| !installing(line)).collect::<Vec<_>>().join("\n").trim().to_string()
}

fn installing(line: &str) -> bool {
    let line = line.trim();
    let heading = line.trim_start_matches('#');
    line.starts_with(ALERT) || (heading.len() < line.len() && heading.trim().eq_ignore_ascii_case(INSTALL))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const BODY: &str = "Sens keeps answering at the end of each turn.\r\n\r\n### Fixed\r\n- **No freeze.** The window keeps answering.\r\n\r\n> [!WARNING]\r\n> The installer is **not signed**.\r\n\r\n### Install\r\nIf you have 0.12.0 or later, open Sens.\r\n\r\nSHA-256: `eb30`\r\n";

    fn release(version: &str) -> Value {
        json!({
            "tag_name": format!("v{version}"),
            "name": format!("v{version} — lo que trae la {version}"),
            "draft": false,
            "prerelease": false,
            "body": format!("notas de la {version}"),
            "html_url": format!("https://github.com/iiTzSenn/Sens/releases/tag/v{version}"),
            "published_at": "2026-09-25T09:16:31Z",
        })
    }

    fn versions(told: &[News]) -> Vec<&str> {
        told.iter().map(|news| news.version.as_str()).collect()
    }

    #[test]
    fn every_version_after_the_one_seen_is_told_newest_first() {
        let listed = json!([release("0.19.1"), release("0.21.0"), release("0.19.0"), release("0.20.0"), release("0.19.2")]);

        assert_eq!(versions(&between(&listed, "0.19.0", "0.20.0")), ["0.20.0", "0.19.2", "0.19.1"]);
    }

    #[test]
    fn without_an_older_version_seen_only_the_installed_one_is_told() {
        let listed = json!([release("0.19.2"), release("0.20.0"), release("0.21.0")]);

        for seen in ["", "cero", "0.20.0", "0.21.0"] {
            assert_eq!(versions(&between(&listed, seen, "0.20.0")), ["0.20.0"], "{seen}");
        }
    }

    #[test]
    fn drafts_and_prereleases_are_not_news() {
        let mut draft = release("0.20.0");
        draft["draft"] = json!(true);
        let mut preview = release("0.19.2");
        preview["prerelease"] = json!(true);
        let listed = json!([draft, preview, release("0.19.1")]);

        assert_eq!(versions(&between(&listed, "0.19.0", "0.20.0")), ["0.19.1"]);
        assert!(between(&listed, "", "0.20.0").is_empty());
    }

    #[test]
    fn a_version_carries_its_title_notes_page_and_date() {
        let told = between(&json!([release("0.20.0")]), "", "0.20.0");

        assert_eq!(told[0].title, "lo que trae la 0.20.0");
        assert_eq!(told[0].notes, "notas de la 0.20.0");
        assert_eq!(told[0].page, "https://github.com/iiTzSenn/Sens/releases/tag/v0.20.0");
        assert_eq!(told[0].published, "2026-09-25T09:16:31Z");
    }

    #[test]
    fn the_title_leaves_out_the_tag_it_starts_with() {
        assert_eq!(title("v0.19.2 — Sens keeps answering", "v0.19.2"), "Sens keeps answering");
        assert_eq!(title("v0.19.2: Sens keeps answering", "v0.19.2"), "Sens keeps answering");
        assert_eq!(title("Sens keeps answering", "v0.19.2"), "Sens keeps answering");
        assert_eq!(title("v0.19.2", "v0.19.2"), "");
        assert_eq!(title("", "v0.19.2"), "");
    }

    #[test]
    fn the_notes_stop_where_the_download_instructions_begin() {
        assert_eq!(notes(BODY), "Sens keeps answering at the end of each turn.\n\n### Fixed\n- **No freeze.** The window keeps answering.");
    }

    #[test]
    fn an_install_heading_ends_the_notes_even_without_a_warning() {
        let body = "### New\n- **Installer changes.** A new one.\n\n### Installer\nKept.\n\n## Install\nDownload it.";

        assert_eq!(notes(body), "### New\n- **Installer changes.** A new one.\n\n### Installer\nKept.");
    }

    #[test]
    #[ignore]
    fn the_real_news() {
        let told = since("0.19.0").unwrap();
        for news in &told {
            println!("{} · {} · {}\n{}\n", news.version, news.published, news.title, news.notes);
        }
    }
}
