use std::env;
use std::fs;
use std::path::PathBuf;

const APP_CONFIG: &str = "../sens-app/tauri.conf.json";

fn main() {
    expose_version();
    embed_payload();
    tauri_build::build();
}

fn expose_version() {
    println!("cargo:rerun-if-changed={APP_CONFIG}");
    let text = fs::read_to_string(APP_CONFIG).expect("no pude leer ../sens-app/tauri.conf.json");
    let config: serde_json::Value = serde_json::from_str(&text).expect("../sens-app/tauri.conf.json no es JSON");
    let version = config["version"].as_str().expect("../sens-app/tauri.conf.json no tiene version");
    println!("cargo:rustc-env=SENS_VERSION={version}");
}

fn embed_payload() {
    println!("cargo::rustc-check-cfg=cfg(payload)");
    println!("cargo:rerun-if-env-changed=SENS_PAYLOAD");
    let Some(path) = env::var_os("SENS_PAYLOAD").filter(|path| !path.is_empty()).map(PathBuf::from) else {
        return;
    };
    let path = std::path::absolute(&path).unwrap_or(path);
    assert!(path.is_file(), "SENS_PAYLOAD apunta a {}, que no existe", path.display());
    println!("cargo:rerun-if-changed={}", path.display());
    println!("cargo:rustc-cfg=payload");
    println!("cargo:rustc-env=SENS_PAYLOAD_FILE={}", path.display());
}
