use std::path::PathBuf;

use sens_agent::model::{Edit, Proposal, Scripted};
use sens_agent::{Crew, Step};

const SUITE: &str = "
#[cfg(test)]
mod tests {
    #[test]
    fn dos_mas_tres_son_cinco() {
        assert_eq!(super::suma(2, 3), 5);
    }
}
";

fn crate_with(body: &str) -> String {
    format!("pub fn suma(a: i32, b: i32) -> i32 {{\n    {body}\n}}\n{SUITE}")
}

fn crate_at(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("sens-g4-{name}"));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(
        root.join("Cargo.toml"),
        "[package]\nname = \"probeta\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
    )
    .unwrap();
    std::fs::write(root.join("src").join("lib.rs"), crate_with("a + b")).unwrap();
    sens_hook::refresh::rebuild(&root).expect("indexar");
    root
}

fn says(body: &str) -> Proposal {
    Proposal {
        files: vec![Edit {
            path: "src/lib.rs".into(),
            after: crate_with(body),
        }],
        note: "listo".into(),
    }
}

fn name_of(step: &Step) -> String {
    serde_json::to_value(step).unwrap()["step"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn a_failing_suite_makes_g4_stop_with_the_output_as_proof() {
    let root = crate_at("failing");
    std::fs::write(root.join("src").join("lib.rs"), crate_with("a * b")).unwrap();

    let ruling = sens_hook::gate::Gauntlet::over(&root).prove(&root);

    assert_eq!(ruling.gate, "G4");
    assert_eq!(ruling.verdict, sens_hook::gate::Verdict::Stop);
    assert!(
        ruling.evidence.iter().any(|line| line.contains("FAILED") || line.contains("failed")),
        "la evidencia no trae la salida de las pruebas: {:?}",
        ruling.evidence
    );
}

#[test]
fn a_patch_that_breaks_the_tests_is_undone_and_sent_back() {
    let root = crate_at("undo");
    let writer = Scripted::new(vec![says("a * b"), says("a.saturating_add(b)")]);
    let dieter = Scripted::new(vec![]);
    let crew = Crew {
        writer: &writer,
        dieter: &dieter,
    };

    let mut steps: Vec<String> = Vec::new();
    let mut stopped_by = String::new();
    let landed = sens_agent::run(&root, "haz que suma sume", &crew, &mut |step| {
        if let Step::Repairing { gate, .. } = &step {
            stopped_by = gate.clone();
        }
        steps.push(name_of(&step));
    });

    assert!(landed.is_ok(), "el segundo intento debería haber pasado");
    assert_eq!(stopped_by, "G4", "no fue G4 quien lo detuvo");
    assert!(steps.contains(&"proven".to_string()));

    let on_disk = std::fs::read_to_string(root.join("src").join("lib.rs")).unwrap();
    assert!(on_disk.contains("saturating_add"), "no quedó el parche bueno");
    assert!(!on_disk.contains("a * b"), "el parche roto sobrevivió");
}

#[test]
fn a_broken_patch_that_never_gets_fixed_leaves_the_file_untouched() {
    let root = crate_at("keep");
    let original = std::fs::read_to_string(root.join("src").join("lib.rs")).unwrap();
    let writer = Scripted::new(vec![says("a * b"), says("a * b"), says("a * b")]);
    let dieter = Scripted::new(vec![]);
    let crew = Crew {
        writer: &writer,
        dieter: &dieter,
    };

    let mut gave_up = false;
    let landed = sens_agent::run(&root, "haz que suma sume", &crew, &mut |step| {
        if matches!(step, Step::GaveUp { .. }) {
            gave_up = true;
        }
    });

    assert!(landed.is_err());
    assert!(gave_up, "el motor no se plantó");
    assert_eq!(
        std::fs::read_to_string(root.join("src").join("lib.rs")).unwrap(),
        original,
        "el fichero no volvió a su estado original"
    );
}
