use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

static IS_PORTABLE: AtomicBool = AtomicBool::new(false);
static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Detects and initializes portable mode.
/// Must be invoked at the very start of run() before Tauri and WebView2 initialize.
pub fn init_portable_mode() -> bool {
    let args: Vec<String> = std::env::args().collect();
    let flag_present = args.iter().any(|a| a == "--portable" || a == "-portable");

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));

    let data_folder = exe_dir.join("Data");
    let portable_marker = exe_dir.join("PORTABLE");
    let portable_dat = exe_dir.join("portable.dat");
    let local_orbital = exe_dir.join(".orbital");

    let is_portable = flag_present
        || data_folder.is_dir()
        || portable_marker.exists()
        || portable_dat.exists()
        || local_orbital.is_dir();

    if is_portable {
        IS_PORTABLE.store(true, Ordering::SeqCst);

        // Path where all Orbital X settings and data should live
        let target_dir = if data_folder.is_dir() || flag_present || portable_marker.exists() || portable_dat.exists() {
            data_folder.join(".orbital")
        } else {
            local_orbital
        };

        // Strict Requirement: Never silently fall back to normal storage if portable mode fails!
        if let Err(e) = std::fs::create_dir_all(&target_dir) {
            eprintln!("CRITICAL ERROR: Failed to initialize portable storage at {}: {}", target_dir.display(), e);
            panic!("FATAL: Orbital X is running in Portable Mode, but the portable storage directory at '{}' could not be created or is write-protected ({}). Application cannot safely start without risking data leakage to host machine.", target_dir.display(), e);
        }

        // Verify write access by testing atomic write inside target_dir
        let probe = target_dir.join(".write_test.tmp");
        if let Err(e) = std::fs::write(&probe, b"ok") {
            panic!("FATAL: Orbital X Portable Mode directory '{}' is read-only or not writable ({}). Please run on a writable drive.", target_dir.display(), e);
        }
        let _ = std::fs::remove_file(&probe);

        // On Windows, set WebView2 user data folder into Data/webview so cookies/localStorage/cache stay on portable drive
        #[cfg(target_os = "windows")]
        {
            let webview_dir = if let Some(parent) = target_dir.parent() {
                if parent.ends_with("Data") {
                    parent.join("webview")
                } else {
                    target_dir.join("webview")
                }
            } else {
                target_dir.join("webview")
            };
            if let Err(e) = std::fs::create_dir_all(&webview_dir) {
                panic!("FATAL: Orbital X Portable Mode could not initialize WebView2 portable profile at '{}': {}", webview_dir.display(), e);
            }
            unsafe {
                std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_dir);
            }
        }

        let _ = DATA_DIR.set(target_dir);
        true
    } else {
        IS_PORTABLE.store(false, Ordering::SeqCst);
        let default_dir = dirs::home_dir()
            .map(|h| h.join(".orbital"))
            .unwrap_or_else(|| PathBuf::from(".orbital"));
        let _ = DATA_DIR.set(default_dir);
        false
    }
}

pub fn is_portable() -> bool {
    IS_PORTABLE.load(Ordering::SeqCst)
}

pub fn orbital_data_dir() -> PathBuf {
    DATA_DIR
        .get()
        .cloned()
        .unwrap_or_else(|| {
            dirs::home_dir()
                .map(|h| h.join(".orbital"))
                .unwrap_or_else(|| PathBuf::from(".orbital"))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_orbital_data_dir_resolution() {
        let dir = orbital_data_dir();
        assert!(!dir.as_os_str().is_empty());
    }
}
