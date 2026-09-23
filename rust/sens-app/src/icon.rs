use tauri::{App, Manager};

const HOST: &str = "main";

#[cfg(windows)]
pub fn sharpen(app: &App) {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
    use windows::Win32::UI::WindowsAndMessaging::{
        ICON_BIG, ICON_SMALL, IMAGE_ICON, LR_DEFAULTCOLOR, LoadImageW, SM_CXICON, SM_CXSMICON, SendMessageW, WM_SETICON,
    };
    use windows::core::PCWSTR;

    const EMBEDDED: usize = 32512;

    let Some(window) = app.get_window(HOST) else {
        return;
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    unsafe {
        let Ok(module) = GetModuleHandleW(PCWSTR::null()) else {
            return;
        };
        let dpi = GetDpiForWindow(hwnd);
        for (kind, metric) in [(ICON_SMALL, SM_CXSMICON), (ICON_BIG, SM_CXICON)] {
            let side = GetSystemMetricsForDpi(metric, dpi);
            let loaded = LoadImageW(Some(module.into()), PCWSTR(EMBEDDED as *const u16), IMAGE_ICON, side, side, LR_DEFAULTCOLOR);
            if let Ok(icon) = loaded {
                SendMessageW(hwnd, WM_SETICON, Some(WPARAM(kind as usize)), Some(LPARAM(icon.0 as isize)));
            }
        }
    }
}

#[cfg(not(windows))]
pub fn sharpen(_app: &App) {}
