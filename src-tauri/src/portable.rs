use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use serde::{Deserialize, Serialize};

static IS_PORTABLE: AtomicBool = AtomicBool::new(false);
static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableStatus {
    pub is_portable: bool,
    pub data_dir: String,
    pub usb_mounted: bool,
    pub lock_active: bool,
    pub host_platform: String,
    pub host_arch: String,
    pub role_usb: String,
    pub role_host: String,
    pub synced_projects_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSyncResult {
    pub success: bool,
    pub workspace_path: String,
    pub sync_dir: String,
    pub files_synced: usize,
    pub timestamp: String,
    pub message: String,
}

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

        // Path where all Orbital X settings and user configurations live on USB
        let target_dir = if data_folder.is_dir() || flag_present || portable_marker.exists() || portable_dat.exists() {
            data_folder.join(".orbital")
        } else {
            local_orbital
        };

        // Strict Requirement: Never silently fall back to normal host storage if portable mode fails!
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

        // Auto-recover any orphaned .tmp files from previous ungraceful shutdowns
        recover_orphaned_tmp_files(&target_dir);

        // Acquire process lock to guard against conflicting simultaneous writes
        acquire_portable_lock(&target_dir);

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

/// Atomically writes content to a target file with a crash-safe temporary file and backup.
pub fn safe_atomic_write(file_path: &Path, content: &[u8]) -> Result<(), std::io::Error> {
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let tmp_path = file_path.with_extension("tmp");
    let bak_path = file_path.with_extension("bak");

    // 1. Write to tmp file
    {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp_path)?;
        f.write_all(content)?;
        f.sync_all()?;
    }

    // 2. Backup existing file if valid
    if file_path.exists() {
        let _ = std::fs::copy(file_path, &bak_path);
    }

    // 3. Atomic rename tmp -> target
    #[cfg(target_os = "windows")]
    {
        if file_path.exists() {
            let _ = std::fs::remove_file(file_path);
        }
    }
    std::fs::rename(&tmp_path, file_path)?;

    Ok(())
}

/// Recovers any orphaned .tmp files left over from sudden power cuts or USB detachments.
fn recover_orphaned_tmp_files(dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if ext == "tmp" {
                        let target = path.with_extension("");
                        let target_is_corrupt = !target.exists() || std::fs::metadata(&target).map(|m| m.len() == 0).unwrap_or(true);
                        if target_is_corrupt && std::fs::metadata(&path).map(|m| m.len() > 0).unwrap_or(false) {
                            let _ = std::fs::rename(&path, &target);
                        } else {
                            let _ = std::fs::remove_file(&path);
                        }
                    }
                }
            }
        }
    }
}

/// Writes process lockfile to coordinate multi-window or simultaneous processes.
fn acquire_portable_lock(dir: &Path) {
    let lock_path = dir.join("portable.lock");
    let pid = std::process::id();
    let hostname = whoami_hostname();
    let lock_content = format!("pid={}\nhostname={}\ntime={}\n", pid, hostname, chrono_now());
    let _ = std::fs::write(lock_path, lock_content);
}

fn whoami_hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "localhost".into())
}

fn chrono_now() -> String {
    // Basic RFC3339 fallback using SystemTime
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => format!("{}.{:03}Z", d.as_secs(), d.subsec_millis()),
        Err(_) => "0Z".into(),
    }
}

/// Query portable configuration and hybrid hardware status.
pub fn get_status() -> PortableStatus {
    let is_p = is_portable();
    let data_dir_buf = orbital_data_dir();
    let lock_file = data_dir_buf.join("portable.lock");
    let lock_active = lock_file.exists();

    let sync_dir = data_dir_buf.join("project_sync");
    let count = if sync_dir.is_dir() {
        std::fs::read_dir(&sync_dir).map(|r| r.count()).unwrap_or(0)
    } else {
        0
    };

    PortableStatus {
        is_portable: is_p,
        data_dir: data_dir_buf.to_string_lossy().to_string(),
        usb_mounted: is_p,
        lock_active,
        host_platform: std::env::consts::OS.to_string(),
        host_arch: std::env::consts::ARCH.to_string(),
        role_usb: "Carries environment settings, extensions, skills, agent instructions, and portable chat sessions.".into(),
        role_host: "Provides Ollama local models, GPU acceleration, toolchain compilers, and system compute.".into(),
        synced_projects_count: count,
    }
}

/// Safely synchronizes project memory from `<workspace>/.orbital/` to `Data/.orbital/project_sync/<hash>/`.
/// The project workspace always maintains its own primary `.orbital/` knowledge store.
pub fn sync_workspace_memory_to_portable(workspace_path: &str) -> Result<ProjectSyncResult, String> {
    let ws = Path::new(workspace_path);
    if !ws.is_dir() {
        return Err(format!("Workspace directory '{}' not found", workspace_path));
    }

    let ws_orbital = ws.join(".orbital");
    if !ws_orbital.is_dir() {
        return Err("Project workspace has no .orbital/ memory directory to synchronize.".into());
    }

    // Deterministic key for the project based on folder name and path
    let folder_name = ws.file_name().and_then(|n| n.to_str()).unwrap_or("project");
    let hash = format!("{:x}", md5_hash(workspace_path.as_bytes()));
    let project_key = format!("{}_{}", folder_name, &hash[..8]);

    let target_sync = orbital_data_dir().join("project_sync").join(&project_key);
    std::fs::create_dir_all(&target_sync).map_err(|e| format!("Failed to create sync target dir: {}", e))?;

    let mut synced = 0;
    if let Ok(entries) = std::fs::read_dir(&ws_orbital) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(file_name) = path.file_name() {
                    let dest = target_sync.join(file_name);
                    if let Ok(bytes) = std::fs::read(&path) {
                        if safe_atomic_write(&dest, &bytes).is_ok() {
                            synced += 1;
                        }
                    }
                }
            }
        }
    }

    let manifest = format!(
        "{{\n  \"workspace_path\": \"{}\",\n  \"synced_at\": \"{}\",\n  \"files_count\": {}\n}}",
        workspace_path.replace('\\', "/"),
        chrono_now(),
        synced
    );
    let _ = safe_atomic_write(&target_sync.join("sync_manifest.json"), manifest.as_bytes());

    Ok(ProjectSyncResult {
        success: true,
        workspace_path: workspace_path.to_string(),
        sync_dir: target_sync.to_string_lossy().to_string(),
        files_synced: synced,
        timestamp: chrono_now(),
        message: format!("Successfully synced {} project memory files to portable storage. Original workspace retains independent .orbital/ store.", synced),
    })
}

/// Safely synchronizes portable memory backup back into `<workspace>/.orbital/`.
pub fn sync_workspace_memory_from_portable(workspace_path: &str) -> Result<ProjectSyncResult, String> {
    let ws = Path::new(workspace_path);
    if !ws.is_dir() {
        return Err(format!("Workspace directory '{}' not found", workspace_path));
    }

    let folder_name = ws.file_name().and_then(|n| n.to_str()).unwrap_or("project");
    let hash = format!("{:x}", md5_hash(workspace_path.as_bytes()));
    let project_key = format!("{}_{}", folder_name, &hash[..8]);

    let sync_dir = orbital_data_dir().join("project_sync").join(&project_key);
    if !sync_dir.is_dir() {
        return Err(format!("No portable backup found for project key '{}'", project_key));
    }

    let ws_orbital = ws.join(".orbital");
    std::fs::create_dir_all(&ws_orbital).map_err(|e| format!("Failed to create workspace .orbital: {}", e))?;

    let mut restored = 0;
    if let Ok(entries) = std::fs::read_dir(&sync_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(file_name) = path.file_name() {
                    let file_name_str = file_name.to_str().unwrap_or_default();
                    if file_name_str != "sync_manifest.json" && !file_name_str.ends_with(".bak") {
                        let dest = ws_orbital.join(file_name);
                        if let Ok(bytes) = std::fs::read(&path) {
                            if safe_atomic_write(&dest, &bytes).is_ok() {
                                restored += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(ProjectSyncResult {
        success: true,
        workspace_path: workspace_path.to_string(),
        sync_dir: sync_dir.to_string_lossy().to_string(),
        files_synced: restored,
        timestamp: chrono_now(),
        message: format!("Restored {} memory files into workspace .orbital/.", restored),
    })
}

fn md5_hash(data: &[u8]) -> u128 {
    // Lightweight checksum hashing without heavy external dependency
    let mut hash: u128 = 0xcbf29ce484222325;
    for &b in data {
        hash ^= b as u128;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_orbital_data_dir_resolution() {
        let dir = orbital_data_dir();
        assert!(!dir.as_os_str().is_empty());
    }

    #[test]
    fn test_safe_atomic_write_and_backup() {
        let tmp_dir = std::env::temp_dir().join("orbital_portable_test");
        let _ = std::fs::create_dir_all(&tmp_dir);
        let test_file = tmp_dir.join("config.json");

        // Write 1
        safe_atomic_write(&test_file, b"{\"version\":1}").expect("write 1 ok");
        assert_eq!(std::fs::read_to_string(&test_file).unwrap(), "{\"version\":1}");

        // Write 2 (should create .bak)
        safe_atomic_write(&test_file, b"{\"version\":2}").expect("write 2 ok");
        assert_eq!(std::fs::read_to_string(&test_file).unwrap(), "{\"version\":2}");

        let bak_file = tmp_dir.join("config.bak");
        assert!(bak_file.exists());
        assert_eq!(std::fs::read_to_string(&bak_file).unwrap(), "{\"version\":1}");

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
}
