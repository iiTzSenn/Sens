use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::sync::Mutex;

use windows::Win32::System::SystemInformation::GetLocalTime;

const FILE: &str = "sens-setup.log";
const CAP: u64 = 512 * 1024;

pub struct Log {
    file: Option<Mutex<File>>,
}

impl Log {
    pub fn open(title: &str) -> Log {
        let path = std::env::temp_dir().join(FILE);
        let full = fs::metadata(&path).is_ok_and(|meta| meta.len() > CAP);
        let file = if full {
            File::create(&path)
        } else {
            OpenOptions::new().create(true).append(true).open(&path)
        };
        let log = Log {
            file: file.ok().map(Mutex::new),
        };
        log.write(&format!("{} · {title}", today()));
        log
    }

    pub fn quiet() -> Log {
        Log { file: None }
    }

    pub fn write(&self, line: &str) {
        let Some(file) = self.file.as_ref().filter(|_| !line.is_empty()) else {
            return;
        };
        if let Ok(mut file) = file.lock() {
            let _ = writeln!(file, "{} {line}", clock());
        }
    }
}

fn clock() -> String {
    let now = unsafe { GetLocalTime() };
    format!("{:02}:{:02}:{:02}", now.wHour, now.wMinute, now.wSecond)
}

fn today() -> String {
    let now = unsafe { GetLocalTime() };
    format!("{:04}-{:02}-{:02}", now.wYear, now.wMonth, now.wDay)
}
