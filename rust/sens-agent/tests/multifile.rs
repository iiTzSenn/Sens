use std::path::PathBuf;

use sens_agent::model::{Edit, Proposal, Scripted};
use sens_agent::{Crew, Step};

const LIB_BEFORE: &str = "pub mod suma;
";

const LIB_AFTER: &str = "pub mod resta;
pub mod suma;

#[cfg(test)]
mod tests {
    #[test]
    fn resta_cinco_menos_tres() {
        assert_eq!(crate::resta::resta(5, 3), 2);
    }
}
";

fn resta(body: &str) -> String {
    format!("pub fn resta(a: i32, b: i32) -> i32 {{\n    {body}\n}}\n")
}

fn crate_at(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("sens-multi-{name}"));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(
        root.join("Cargo.toml"),
        "[package]\nname = \"probeta\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
    )
    .unwrap();
    std::fs::write(root.join("src").join("lib.rs"), LIB_BEFORE).unwrap();
    std::fs::write(
        root.join("src").join("suma.rs"),
        "pub fn suma(a: i32, b: i32) -> i32 {\n    a + b\n}\n",
    )
    .unwrap();
    sens_hook::refresh::rebuild(&root).expect("indexar");
    root
}

fn says(body: &str) -> Proposal {
    Proposal {
        files: vec![
            Edit {
                path: "src/lib.rs".into(),
                after: LIB_AFTER.into(),
            },
            Edit {
                path: "src/resta.rs".into(),
                after: resta(body),
            },
        ],
        note: "dos ficheros".into(),
    }
}

#[test]
fn two_files_land_together_and_the_diff_covers_both() {
    let root = crate_at("together");
    let writer = Scripted::new(vec![says("a - b")]);
    let dieter = Scripted::new(vec![]);
    let crew = Crew {
        writer: &writer,
        dieter: &dieter,
    };

    let mut written: Vec<String> = Vec::new();
    let landed = sens_agent::run(&root, "añade resta", &crew, &mut |step| {
        if let Step::Applied { files, .. } = &step {
            written = files.iter().map(|file| file.path.clone()).collect();
        }
    })
    .expect("debería haber aterrizado");

    assert_eq!(written, vec!["src/lib.rs", "src/resta.rs"]);
    assert_eq!(landed.paths.len(), 2);
    assert!(root.join("src").join("resta.rs").exists());
    assert!(std::fs::read_to_string(root.join("src").join("lib.rs"))
        .unwrap()
        .contains("pub mod resta;"));
}

#[test]
fn a_broken_pair_is_undone_whole_leaving_no_half_written_file() {
    let root = crate_at("undo-pair");
    let writer = Scripted::new(vec![says("a + b"), says("a + b"), says("a + b")]);
    let dieter = Scripted::new(vec![]);
    let crew = Crew {
        writer: &writer,
        dieter: &dieter,
    };

    let mut stopped_by = String::new();
    let landed = sens_agent::run(&root, "añade resta", &crew, &mut |step| {
        if let Step::Repairing { gate, .. } = &step {
            stopped_by = gate.clone();
        }
    });

    assert!(landed.is_err());
    assert_eq!(stopped_by, "G4");
    assert_eq!(
        std::fs::read_to_string(root.join("src").join("lib.rs")).unwrap(),
        LIB_BEFORE,
        "lib.rs no volvió a su estado original"
    );
    assert!(
        !root.join("src").join("resta.rs").exists(),
        "el fichero nuevo sobrevivió a la marcha atrás"
    );
}
