use std::path::Path;
use std::process::{Command, Stdio};

use std::time::Duration;

use crate::gate::{Ruling, Verdict};

pub const PATIENCE: Duration = Duration::from_secs(180);

const TAIL: usize = 8;

pub struct Trial {
    pub command: Option<Vec<String>>,
}

impl Trial {
    pub fn detect(root: &Path) -> Self {
        Self {
            command: suite_for(root),
        }
    }

    pub fn fingerprint(&self) -> String {
        match &self.command {
            Some(command) => format!("suite:{}", command.join(" ")),
            None => "suite:none".into(),
        }
    }

    pub fn run(&self, root: &Path) -> Ruling {
        let Some(command) = &self.command else {
            return Ruling::of(
                "G4",
                "tests",
                Verdict::Abstain,
                "No sé cómo probar este proyecto.",
                Vec::new(),
            );
        };

        match execute(root, command) {
            Outcome::Passed => Ruling::of(
                "G4",
                "tests",
                Verdict::Pass,
                format!("`{}` en verde.", command.join(" ")),
                Vec::new(),
            ),
            Outcome::Failed(output) => Ruling::of(
                "G4",
                "tests",
                Verdict::Stop,
                "Un parche que rompe no es un parche.",
                tail(&output),
            ),
            Outcome::Unusable(reason) => Ruling::of(
                "G4",
                "tests",
                Verdict::Abstain,
                "No pude ejecutar las pruebas.",
                vec![reason],
            ),
            Outcome::TooSlow => Ruling::of(
                "G4",
                "tests",
                Verdict::Stop,
                format!(
                    "Las pruebas no terminaron en {} segundos.",
                    PATIENCE.as_secs()
                ),
                vec![command.join(" ")],
            ),
        }
    }
}

enum Outcome {
    Passed,
    Failed(String),
    Unusable(String),
    TooSlow,
}

pub fn suite_for(root: &Path) -> Option<Vec<String>> {
    if root.join("Cargo.toml").exists() {
        return Some(words("cargo test --quiet"));
    }
    if root.join("go.mod").exists() {
        return Some(words("go test ./..."));
    }
    if has_test_script(root) {
        return Some(words("npm test --silent"));
    }
    if root.join("pyproject.toml").exists() || root.join("pytest.ini").exists() {
        return Some(words("pytest -q"));
    }
    None
}

fn has_test_script(root: &Path) -> bool {
    let Ok(raw) = std::fs::read(root.join("package.json")) else {
        return false;
    };
    let Ok(manifest) = serde_json::from_slice::<serde_json::Value>(&raw) else {
        return false;
    };
    manifest["scripts"]["test"].is_string()
}

fn words(line: &str) -> Vec<String> {
    line.split_whitespace().map(str::to_string).collect()
}

fn execute(root: &Path, command: &[String]) -> Outcome {
    let spawned = Command::new(&command[0])
        .args(&command[1..])
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let mut child = match spawned {
        Ok(child) => child,
        Err(error) => return Outcome::Unusable(format!("{}: {error}", command[0])),
    };

    let said = drain(child.stdout.take());
    let complained = drain(child.stderr.take());
    let started = std::time::Instant::now();

    let status = loop {
        match child.try_wait() {
            Err(error) => return Outcome::Unusable(error.to_string()),
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() >= PATIENCE => {
                let _ = child.kill();
                let _ = child.wait();
                return Outcome::TooSlow;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(60)),
        }
    };

    if status.success() {
        return Outcome::Passed;
    }

    let mut output = said.join().unwrap_or_default();
    output.push_str(&complained.join().unwrap_or_default());
    Outcome::Failed(output)
}

fn drain<P: std::io::Read + Send + 'static>(pipe: Option<P>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_string(&mut text);
        }
        text
    })
}

fn tail(output: &str) -> Vec<String> {
    let lines: Vec<&str> = output
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.is_empty())
        .collect();
    let from = lines.len().saturating_sub(TAIL);
    lines[from..].iter().map(|line| line.to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("sens-trial-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn a_rust_project_is_proved_with_cargo() {
        let root = temp_root("cargo");
        std::fs::write(root.join("Cargo.toml"), "[package]\nname = \"x\"\n").unwrap();
        assert_eq!(suite_for(&root), Some(words("cargo test --quiet")));
    }

    #[test]
    fn a_node_project_needs_a_test_script_to_count() {
        let root = temp_root("node");
        std::fs::write(
            root.join("package.json"),
            "{\"scripts\":{\"build\":\"tsc\"}}",
        )
        .unwrap();
        assert_eq!(suite_for(&root), None);

        std::fs::write(
            root.join("package.json"),
            "{\"scripts\":{\"test\":\"vitest run\"}}",
        )
        .unwrap();
        assert_eq!(suite_for(&root), Some(words("npm test --silent")));
    }

    #[test]
    fn a_project_with_no_suite_makes_the_gate_abstain() {
        let root = temp_root("bare");
        let ruling = Trial::detect(&root).run(&root);

        assert_eq!(ruling.verdict, Verdict::Abstain);
        assert_eq!(ruling.gate, "G4");
    }

    #[test]
    fn an_unavailable_runner_is_unverified() {
        let root = temp_root("missing-runner");
        let trial = Trial {
            command: Some(vec![
                root.join("missing-runner.exe")
                    .to_string_lossy()
                    .into_owned(),
            ]),
        };
        let ruling = trial.run(&root);
        assert_eq!(ruling.verdict, Verdict::Abstain);
        assert!(!ruling.evidence.is_empty());
    }

    #[test]
    fn the_fingerprint_changes_with_the_suite() {
        let rust = Trial {
            command: Some(words("cargo test --quiet")),
        };
        let none = Trial { command: None };
        assert_ne!(rust.fingerprint(), none.fingerprint());
    }

    #[test]
    fn only_the_last_lines_of_a_long_failure_travel_as_evidence() {
        let noise = (0..40)
            .map(|n| format!("línea {n}"))
            .collect::<Vec<_>>()
            .join("\n");
        let kept = tail(&noise);

        assert_eq!(kept.len(), TAIL);
        assert_eq!(kept.last().unwrap(), "línea 39");
    }
}
