use std::path::Path;
use std::time::Duration;

use serde::Serialize;

pub const CANCELLED: &str = "cancelado";
pub const UNINSTALLER: &str = "Copiando el desinstalador";
pub const REGISTERING: &str = "Registrando Sens en Windows";
pub const START_MENU: &str = "Acceso directo en el menú Inicio";
pub const DESKTOP: &str = "Acceso directo en el escritorio";
pub const LOOK: &str = "Guardando tu apariencia";
pub const WAITING: &str = "Sens está abierta; esperando a que se cierre";
pub const CLOSED: &str = "Sens se ha cerrado";
pub const UNSEEN: &str = "Sens seguía abierta sin ventana; cerrándola";
pub const UNLINKING: &str = "Quitando los accesos directos";
pub const UNREGISTERING: &str = "Quitando Sens de Windows";
pub const FORGETTING: &str = "Borrando tus ajustes, skills y plugins de Sens";

const MEGABYTE: f64 = 1_000_000.0;
const GIGABYTE: f64 = 1_000_000_000.0;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Step {
    Check,
    Close,
    Extract,
    Swap,
    Register,
    Shortcuts,
    Done,
    Remove,
}

pub type Report<'a> = &'a dyn Fn(Step, f64, &str);

pub fn space(free: Option<u64>) -> String {
    match free {
        Some(free) => format!("Comprobando espacio · {} libres", amount(free)),
        None => "Comprobando espacio".into(),
    }
}

pub fn extracting(size: u64) -> String {
    format!("Descomprimiendo sens-app.exe · {}", amount(size))
}

pub fn placing(dir: &Path) -> String {
    format!("Colocando sens-app.exe en {}", dir.display())
}

pub fn deleting(dir: &Path) -> String {
    format!("Borrando sens-app.exe y el desinstalador de {}", dir.display())
}

pub fn unsaved_look(reason: &str) -> String {
    format!("Tu apariencia no se guardó: {reason}")
}

pub fn finished(elapsed: Duration) -> String {
    format!("Listo en {}", decimal(elapsed.as_secs_f64(), "s"))
}

pub fn amount(bytes: u64) -> String {
    let bytes = bytes as f64;
    if bytes >= 10.0 * GIGABYTE {
        format!("{:.0} GB", bytes / GIGABYTE)
    } else if bytes >= GIGABYTE {
        decimal(bytes / GIGABYTE, "GB")
    } else {
        decimal(bytes / MEGABYTE, "MB")
    }
}

fn decimal(value: f64, unit: &str) -> String {
    format!("{value:.1} {unit}").replace('.', ",")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_read_the_spanish_way() {
        assert_eq!(amount(7_329_792), "7,3 MB");
        assert_eq!(amount(120_400_000_000), "120 GB");
        assert_eq!(amount(2_500_000_000), "2,5 GB");
        assert_eq!(finished(Duration::from_millis(1_940)), "Listo en 1,9 s");
    }

    #[test]
    fn steps_travel_as_the_names_the_interface_expects() {
        let names: Vec<String> = [Step::Check, Step::Close, Step::Extract, Step::Swap, Step::Register, Step::Shortcuts, Step::Done, Step::Remove]
            .iter()
            .map(|step| serde_json::to_string(step).unwrap())
            .collect();

        assert_eq!(names, ["\"check\"", "\"close\"", "\"extract\"", "\"swap\"", "\"register\"", "\"shortcuts\"", "\"done\"", "\"remove\""]);
    }
}
