use std::path::PathBuf;

use sens_agent::model::Cli;
use sens_agent::{Crew, Step};

fn scratch(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("sens-live-{name}"));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(
        root.join("Cargo.toml"),
        "[package]
name = \"probeta\"
version = \"0.1.0\"
edition = \"2021\"
",
    )
    .unwrap();
    std::fs::write(root.join("src").join("lib.rs"), "pub mod config;
").unwrap();
    root
}

fn name_of(step: &Step) -> String {
    serde_json::to_value(step).unwrap()["step"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
#[ignore]
fn claude_code_drives_the_whole_loop() {
    let root = scratch("loop");
    std::fs::write(
        root.join("src").join("config.rs"),
        "pub struct Config {\n    pub root: String,\n}\n\npub fn parse_config(raw: &str) -> Config {\n    Config { root: raw.trim().to_string() }\n}\n",
    )
    .unwrap();

    let refreshed = sens_hook::refresh::rebuild(&root).expect("indexar");
    println!("índice listo en {} ms", refreshed.millis());

    let claude = Cli::claude();
    let crew = Crew {
        writer: &claude,
        dieter: &claude,
    };

    let mut seen: Vec<String> = Vec::new();
    let landed = sens_agent::run(
        &root,
        "Crea src/boot.rs con una función boot que lea la configuración de un &str y devuelva Config.",
        &crew,
        &mut |step| {
            println!("  {}", describe(&step));
            seen.push(name_of(&step));
        },
    );

    println!("resultado: {landed:?}", landed = landed.as_ref().map(|l| (&l.paths, l.net)));

    assert_eq!(seen.first().map(String::as_str), Some("oriented"));
    assert!(seen.iter().any(|name| name == "proposed"), "nadie propuso nada");
    assert!(seen.iter().any(|name| name == "judged"), "los gates no juzgaron");
}

#[test]
#[ignore]
fn parse_config_never_ends_up_defined_twice() {
    let root = scratch("duplicate");
    std::fs::write(
        root.join("src").join("config.rs"),
        "pub fn parse_config(raw: &str) -> String {\n    raw.trim().to_string()\n}\n",
    )
    .unwrap();

    sens_hook::refresh::rebuild(&root).expect("indexar");

    let claude = Cli::claude();
    let crew = Crew {
        writer: &claude,
        dieter: &claude,
    };

    let _ = sens_agent::run(
        &root,
        "Crea src/boot.rs con una función llamada parse_config que recorte los espacios de un &str.",
        &crew,
        &mut |step| println!("  {}", describe(&step)),
    );

    let (index, meta) = sens_hook::engine::load(&root).expect("índice tras el trabajo");
    let queries = sens_hook::query::Engine::new(&index, &meta.entry_points);
    let defined = queries.find_symbol("parse_config");

    for hit in &defined {
        println!("  definido en {}:{}", hit.file, hit.line);
    }
    assert_eq!(defined.len(), 1, "parse_config acabó definido dos veces");
}

fn describe(step: &Step) -> String {
    match step {
        Step::Oriented { symbols, files } => format!("orientado · {symbols} símbolos, {files} ficheros"),
        Step::Proposed { paths, model, note } => format!("{model} propone {} · {note}", paths.join(", ")),
        Step::Judged { outcome } => {
            let gates: Vec<String> = outcome
                .rulings
                .iter()
                .map(|ruling| format!("{}={}", ruling.gate, verdict_of(ruling)))
                .collect();
            format!(
                "juzgado · aplica={} · {:+} líneas · {}",
                outcome.applies,
                outcome.net_lines,
                gates.join(" ")
            )
        }
        Step::Proven { ruling } => format!("G4 {} · {}", verdict_of(ruling), ruling.said),
        Step::Repairing { gate, attempt } => format!("{gate} detuvo · rehaciendo ({attempt})"),
        Step::Dieted { from, to } => format!("dieta · {from:+} → {to:+}"),
        Step::DietRejected { reason } => format!("dieta descartada · {reason}"),
        Step::Applied { net, files } => {
            let each: Vec<String> = files
                .iter()
                .map(|file| format!("{} +{} −{}", file.path, file.added.len(), file.removed.len()))
                .collect();
            format!("escrito {net:+} líneas · {}", each.join(" · "))
        }
        Step::Reindexed { millis, delegated } => {
            format!("reindexado · {millis} ms · {}", if *delegated { "node" } else { "nativo" })
        }
        Step::ReindexFailed { reason } => format!("reindexado falló · {reason}"),
        Step::GaveUp { reason } => format!("se planta · {reason}"),
    }
}

fn verdict_of(ruling: &sens_hook::gate::Ruling) -> &'static str {
    match ruling.verdict {
        sens_hook::gate::Verdict::Pass => "pasa",
        sens_hook::gate::Verdict::Stop => "DETIENE",
        sens_hook::gate::Verdict::Abstain => "abstiene",
    }
}
