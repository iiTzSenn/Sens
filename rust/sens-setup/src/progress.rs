use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use crate::language::{self, Language, said};

pub const CANCELLED: &str = "cancelled";

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

pub fn uninstaller() -> String {
    said!(
        en: "Copying the uninstaller",
        es: "Copiando el desinstalador",
        fr: "Copie du programme de désinstallation",
        de: "Deinstallationsprogramm wird kopiert",
        ja: "アンインストーラーをコピーしています",
        zh: "正在复制卸载程序",
    )
}

pub fn registering() -> String {
    said!(
        en: "Registering Sens with Windows",
        es: "Registrando Sens en Windows",
        fr: "Inscription de Sens dans Windows",
        de: "Sens wird in Windows registriert",
        ja: "Sens を Windows に登録しています",
        zh: "正在向 Windows 注册 Sens",
    )
}

pub fn start_menu() -> String {
    said!(
        en: "Start menu shortcut",
        es: "Acceso directo en el menú Inicio",
        fr: "Raccourci dans le menu Démarrer",
        de: "Verknüpfung im Startmenü",
        ja: "スタートメニューのショートカット",
        zh: "“开始”菜单快捷方式",
    )
}

pub fn desktop() -> String {
    said!(
        en: "Desktop shortcut",
        es: "Acceso directo en el escritorio",
        fr: "Raccourci sur le Bureau",
        de: "Verknüpfung auf dem Desktop",
        ja: "デスクトップのショートカット",
        zh: "桌面快捷方式",
    )
}

pub fn saving_look() -> String {
    said!(
        en: "Saving your appearance",
        es: "Guardando tu apariencia",
        fr: "Enregistrement de votre apparence",
        de: "Deine Darstellung wird gespeichert",
        ja: "外観を保存しています",
        zh: "正在保存你的外观",
    )
}

pub fn saving_language() -> String {
    said!(
        en: "Saving your language",
        es: "Guardando tu idioma",
        fr: "Enregistrement de votre langue",
        de: "Deine Sprache wird gespeichert",
        ja: "言語を保存しています",
        zh: "正在保存你的语言",
    )
}

pub fn waiting() -> String {
    said!(
        en: "Sens is open; waiting for it to close",
        es: "Sens está abierta; esperando a que se cierre",
        fr: "Sens est ouvert ; en attente de sa fermeture",
        de: "Sens ist geöffnet; es wird gewartet, bis es geschlossen wird",
        ja: "Sens が開いています。閉じるのを待っています",
        zh: "Sens 正在运行，等待其关闭",
    )
}

pub fn closed() -> String {
    said!(
        en: "Sens has closed",
        es: "Sens se ha cerrado",
        fr: "Sens s’est fermé",
        de: "Sens wurde geschlossen",
        ja: "Sens が閉じました",
        zh: "Sens 已关闭",
    )
}

pub fn unseen() -> String {
    said!(
        en: "Sens was still running without a window; closing it",
        es: "Sens seguía abierta sin ventana; cerrándola",
        fr: "Sens tournait encore sans fenêtre ; fermeture en cours",
        de: "Sens lief noch ohne Fenster und wird geschlossen",
        ja: "Sens がウィンドウなしで動いていたため、閉じています",
        zh: "Sens 仍在无窗口运行，正在关闭",
    )
}

pub fn unlinking() -> String {
    said!(
        en: "Removing the shortcuts",
        es: "Quitando los accesos directos",
        fr: "Suppression des raccourcis",
        de: "Verknüpfungen werden entfernt",
        ja: "ショートカットを削除しています",
        zh: "正在删除快捷方式",
    )
}

pub fn unregistering() -> String {
    said!(
        en: "Removing Sens from Windows",
        es: "Quitando Sens de Windows",
        fr: "Retrait de Sens de Windows",
        de: "Sens wird aus Windows entfernt",
        ja: "Windows から Sens を削除しています",
        zh: "正在从 Windows 中移除 Sens",
    )
}

pub fn forgetting() -> String {
    said!(
        en: "Deleting your Sens settings, skills and plugins",
        es: "Borrando tus ajustes, skills y plugins de Sens",
        fr: "Suppression de vos paramètres, skills et plugins de Sens",
        de: "Deine Einstellungen, Skills und Plugins von Sens werden gelöscht",
        ja: "Sens の設定、スキル、プラグインを削除しています",
        zh: "正在删除你的 Sens 设置、技能和插件",
    )
}

pub fn space(free: Option<u64>) -> String {
    match free {
        Some(free) => said!(
            en: "Checking space · {free} free",
            es: "Comprobando espacio · {free} libres",
            fr: "Vérification de l’espace · {free} libres",
            de: "Speicherplatz wird geprüft · {free} frei",
            ja: "空き容量を確認しています · 空き {free}",
            zh: "正在检查空间 · 可用 {free}",
            free = amount(free),
        ),
        None => said!(
            en: "Checking space",
            es: "Comprobando espacio",
            fr: "Vérification de l’espace",
            de: "Speicherplatz wird geprüft",
            ja: "空き容量を確認しています",
            zh: "正在检查空间",
        ),
    }
}

pub fn extracting(size: u64) -> String {
    said!(
        en: "Unpacking sens-app.exe · {size}",
        es: "Descomprimiendo sens-app.exe · {size}",
        fr: "Décompression de sens-app.exe · {size}",
        de: "sens-app.exe wird entpackt · {size}",
        ja: "sens-app.exe を展開しています · {size}",
        zh: "正在解压 sens-app.exe · {size}",
        size = amount(size),
    )
}

pub fn placing(dir: &Path) -> String {
    said!(
        en: "Placing sens-app.exe in {dir}",
        es: "Colocando sens-app.exe en {dir}",
        fr: "Mise en place de sens-app.exe dans {dir}",
        de: "sens-app.exe wird in {dir} abgelegt",
        ja: "sens-app.exe を {dir} に配置しています",
        zh: "正在将 sens-app.exe 放入 {dir}",
        dir = dir.display(),
    )
}

pub fn deleting(dir: &Path) -> String {
    said!(
        en: "Deleting sens-app.exe and the uninstaller from {dir}",
        es: "Borrando sens-app.exe y el desinstalador de {dir}",
        fr: "Suppression de sens-app.exe et du programme de désinstallation de {dir}",
        de: "sens-app.exe und das Deinstallationsprogramm werden aus {dir} gelöscht",
        ja: "{dir} から sens-app.exe とアンインストーラーを削除しています",
        zh: "正在从 {dir} 删除 sens-app.exe 和卸载程序",
        dir = dir.display(),
    )
}

pub fn unsaved_look(reason: &str) -> String {
    said!(
        en: "Your appearance wasn’t saved: {reason}",
        es: "Tu apariencia no se guardó: {reason}",
        fr: "Votre apparence n’a pas été enregistrée : {reason}",
        de: "Deine Darstellung wurde nicht gespeichert: {reason}",
        ja: "外観を保存できませんでした: {reason}",
        zh: "未能保存你的外观：{reason}",
    )
}

pub fn unsaved_language(reason: &str) -> String {
    said!(
        en: "Your language wasn’t saved: {reason}",
        es: "Tu idioma no se guardó: {reason}",
        fr: "Votre langue n’a pas été enregistrée : {reason}",
        de: "Deine Sprache wurde nicht gespeichert: {reason}",
        ja: "言語を保存できませんでした: {reason}",
        zh: "未能保存你的语言：{reason}",
    )
}

pub fn finished(elapsed: Duration) -> String {
    said!(
        en: "Done in {seconds} s",
        es: "Listo en {seconds} s",
        fr: "Terminé en {seconds} s",
        de: "Fertig in {seconds} s",
        ja: "{seconds} 秒で完了しました",
        zh: "已完成，用时 {seconds} 秒",
        seconds = decimal(elapsed.as_secs_f64()),
    )
}

pub fn error(reason: &str) -> String {
    said!(
        en: "Error: {reason}",
        es: "Error: {reason}",
        fr: "Erreur : {reason}",
        de: "Fehler: {reason}",
        ja: "エラー: {reason}",
        zh: "错误：{reason}",
    )
}

pub fn not_absolute() -> String {
    said!(
        en: "choose a folder with its full path",
        es: "elige una carpeta con su ruta completa",
        fr: "choisissez un dossier avec son chemin complet",
        de: "wähle einen Ordner mit vollständigem Pfad",
        ja: "フォルダーはフルパスで指定してください",
        zh: "请选择带完整路径的文件夹",
    )
}

pub fn cannot_create(path: &Path, error: &dyn std::fmt::Display) -> String {
    said!(
        en: "couldn’t create {path}: {error}",
        es: "no pude crear {path}: {error}",
        fr: "impossible de créer {path} : {error}",
        de: "{path} konnte nicht erstellt werden: {error}",
        ja: "{path} を作成できませんでした: {error}",
        zh: "无法创建 {path}：{error}",
        path = path.display(),
    )
}

pub fn cannot_write(path: &Path, error: &dyn std::fmt::Display) -> String {
    said!(
        en: "couldn’t write {path}: {error}",
        es: "no pude escribir {path}: {error}",
        fr: "impossible d’écrire {path} : {error}",
        de: "{path} konnte nicht geschrieben werden: {error}",
        ja: "{path} に書き込めませんでした: {error}",
        zh: "无法写入 {path}：{error}",
        path = path.display(),
    )
}

pub fn cannot_delete(path: &Path, error: &dyn std::fmt::Display) -> String {
    said!(
        en: "couldn’t delete {path}: {error}",
        es: "no pude borrar {path}: {error}",
        fr: "impossible de supprimer {path} : {error}",
        de: "{path} konnte nicht gelöscht werden: {error}",
        ja: "{path} を削除できませんでした: {error}",
        zh: "无法删除 {path}：{error}",
        path = path.display(),
    )
}

pub fn amount(bytes: u64) -> String {
    let bytes = bytes as f64;
    let giga = bytes >= GIGABYTE;
    let value = if giga { bytes / GIGABYTE } else { bytes / MEGABYTE };
    let number = if bytes >= 10.0 * GIGABYTE { format!("{value:.0}") } else { decimal(value) };
    let unit = match (giga, language::now()) {
        (true, Language::Fr) => "Go",
        (true, _) => "GB",
        (false, Language::Fr) => "Mo",
        (false, _) => "MB",
    };
    format!("{number} {unit}")
}

fn decimal(value: f64) -> String {
    let point = format!("{value:.1}");
    match language::now() {
        Language::Es | Language::Fr | Language::De => point.replace('.', ","),
        Language::En | Language::Ja | Language::Zh => point,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::language::speaking;

    #[test]
    fn sizes_and_times_read_the_way_each_language_writes_them() {
        assert_eq!(amount(7_329_792), "7.3 MB");
        assert_eq!(amount(120_400_000_000), "120 GB");
        assert_eq!(amount(2_500_000_000), "2.5 GB");
        assert_eq!(finished(Duration::from_millis(1_940)), "Done in 1.9 s");
        speaking(Language::Es, || {
            assert_eq!(amount(7_329_792), "7,3 MB");
            assert_eq!(amount(2_500_000_000), "2,5 GB");
            assert_eq!(finished(Duration::from_millis(1_940)), "Listo en 1,9 s");
        });
        speaking(Language::Fr, || {
            assert_eq!(amount(7_329_792), "7,3 Mo");
            assert_eq!(amount(120_400_000_000), "120 Go");
            assert_eq!(space(Some(2_500_000_000)), "Vérification de l’espace · 2,5 Go libres");
        });
        speaking(Language::De, || assert_eq!(extracting(7_329_792), "sens-app.exe wird entpackt · 7,3 MB"));
        speaking(Language::Ja, || assert_eq!(finished(Duration::from_millis(1_940)), "1.9 秒で完了しました"));
        speaking(Language::Zh, || assert_eq!(error("磁盘已满"), "错误：磁盘已满"));
    }

    #[test]
    fn a_line_that_carries_a_path_names_it_in_every_language() {
        let dir = Path::new(r"C:\Sens");
        for (language, line) in [
            (Language::En, r"Placing sens-app.exe in C:\Sens"),
            (Language::Es, r"Colocando sens-app.exe en C:\Sens"),
            (Language::Fr, r"Mise en place de sens-app.exe dans C:\Sens"),
            (Language::De, r"sens-app.exe wird in C:\Sens abgelegt"),
            (Language::Ja, r"sens-app.exe を C:\Sens に配置しています"),
            (Language::Zh, r"正在将 sens-app.exe 放入 C:\Sens"),
        ] {
            assert_eq!(speaking(language, || placing(dir)), line);
        }
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
