// ==========================================================================
// Orbital X — Extension Service (extensions.rs)
//
// Orbital X extensions are declarative packs (theme / prompt-pack /
// command-pack) stored as folders under ~/.orbital/extensions/<id>/ with a
// manifest.json. There is deliberately NO arbitrary code execution: VS Code
// .vsix packages and executable extensions are rejected with a clear
// message instead of silently pretending to work.
//
// State (enabled/disabled per id) lives in ~/.orbital/extensions_state.json.
// ==========================================================================

use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub struct ExtensionService;

const SUPPORTED_TYPES: &[&str] = &["theme", "prompt-pack", "command-pack"];

fn extensions_dir() -> PathBuf {
    let dir = dirs::home_dir()
        .map(|h| h.join(".orbital").join("extensions"))
        .unwrap_or_else(|| PathBuf::from(".orbital/extensions"));
    let _ = fs::create_dir_all(&dir);
    dir
}

fn state_path() -> PathBuf {
    let dir = dirs::home_dir()
        .map(|h| h.join(".orbital"))
        .unwrap_or_else(|| PathBuf::from(".orbital"));
    let _ = fs::create_dir_all(&dir);
    dir.join("extensions_state.json")
}

fn load_state() -> serde_json::Map<String, Value> {
    if let Ok(bytes) = fs::read(state_path()) {
        if let Ok(Value::Object(map)) = serde_json::from_slice::<Value>(&bytes) {
            return map;
        }
    }
    serde_json::Map::new()
}

fn save_state(state: &serde_json::Map<String, Value>) {
    if let Ok(serialized) = serde_json::to_string_pretty(state) {
        let _ = fs::write(state_path(), serialized);
    }
}

fn is_enabled(manifest: &Value, state: &serde_json::Map<String, Value>) -> bool {
    let id = manifest.get("id").and_then(|v| v.as_str()).unwrap_or_default();
    match state.get(id) {
        Some(Value::Bool(b)) => *b,
        // Fresh installs follow the manifest's declared default
        _ => manifest.get("defaultEnabled").and_then(|v| v.as_bool()).unwrap_or(true),
    }
}

/// Validates a manifest object. Returns a normalized copy or an error that
/// explains exactly what is wrong/unsupported.
fn validate_manifest(manifest: &Value) -> Result<Value, String> {
    let obj = manifest
        .as_object()
        .ok_or("Manifest must be a JSON object")?;

    let id = obj.get("id").and_then(|v| v.as_str()).unwrap_or_default().trim().to_string();
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') {
        return Err("Manifest requires an 'id' (alphanumeric, dash, underscore, dot only)".into());
    }
    for field in ["name", "description"] {
        if obj.get(field).and_then(|v| v.as_str()).map(str::trim).unwrap_or_default().is_empty() {
            return Err(format!("Manifest requires a non-empty '{}'", field));
        }
    }
    let ext_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    if !SUPPORTED_TYPES.contains(&ext_type.as_str()) {
        return Err(format!(
            "Unsupported extension type '{}'. Orbital X supports declarative packs only: {} — VS Code .vsix / code-executing extensions are not supported.",
            ext_type,
            SUPPORTED_TYPES.join(", ")
        ));
    }
    // Type-specific required fields
    match ext_type.as_str() {
        "theme" => {
            let colors = obj.get("colors").and_then(|v| v.as_object())
                .ok_or("Theme packs require a 'colors' object of CSS variable overrides (e.g. {\"--accent-cyan\": \"#...\"})")?;
            if colors.is_empty() {
                return Err("Theme pack 'colors' must contain at least one variable".into());
            }
            for (k, v) in colors {
                if !k.starts_with("--") || !v.is_string() {
                    return Err("Theme 'colors' keys must be CSS variable names (--…) with string values".into());
                }
            }
        }
        "prompt-pack" => {
            let sp = obj.get("systemPromptAddition").and_then(|v| v.as_str()).unwrap_or_default();
            if sp.trim().len() < 10 {
                return Err("Prompt packs require a 'systemPromptAddition' string (the guidance appended to the agent system prompt)".into());
            }
            if sp.len() > 4000 {
                return Err("Prompt pack 'systemPromptAddition' exceeds 4000 characters".into());
            }
        }
        "command-pack" => {
            let cmds = obj.get("commands").and_then(|v| v.as_array())
                .ok_or("Command packs require a 'commands' array of {id, title, command}")?;
            if cmds.is_empty() {
                return Err("Command pack 'commands' must contain at least one entry".into());
            }
            for c in cmds {
                let has_all = ["title", "command"].iter().all(|f| c.get(f).and_then(|v| v.as_str()).map(|s| !s.trim().is_empty()).unwrap_or(false));
                if !has_all {
                    return Err("Each command needs non-empty 'title' and 'command' strings".into());
                }
            }
        }
        _ => unreachable!(),
    }

    let mut normalized = manifest.clone();
    if let Some(n) = normalized.as_object_mut() {
        n.insert("id".into(), Value::String(id));
    }
    Ok(normalized)
}

fn manifest_for(dir: &Path) -> Option<Value> {
    let bytes = fs::read(dir.join("manifest.json")).ok()?;
    let manifest: Value = serde_json::from_slice(&bytes).ok()?;
    Some(manifest)
}

impl ExtensionService {
    pub fn list_installed() -> Vec<Value> {
        let state = load_state();
        let mut out = Vec::new();
        if let Ok(entries) = fs::read_dir(extensions_dir()) {
            for entry in entries.filter_map(|e| e.ok()) {
                if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                if let Some(mut manifest) = manifest_for(&entry.path()) {
                    let enabled = is_enabled(&manifest, &state);
                    if let Some(obj) = manifest.as_object_mut() {
                        obj.insert("enabled".into(), Value::Bool(enabled));
                        obj.insert(
                            "installedAt".into(),
                            Value::String(
                                entry
                                    .metadata()
                                    .ok()
                                    .and_then(|m| m.modified().ok())
                                    .map(|t| {
                                        let dt: chrono::DateTime<chrono::Utc> = t.into();
                                        dt.to_rfc3339()
                                    })
                                    .unwrap_or_default(),
                            ),
                        );
                    }
                    out.push(manifest);
                }
            }
        }
        out.sort_by_key(|m| {
            m.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_lowercase()
        });
        out
    }

    /// Installs from a manifest object (used by the bundled registry).
    pub fn install_from_manifest(manifest: &Value) -> Result<Value, String> {
        let manifest = validate_manifest(manifest)?;
        let id = manifest.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let dir = extensions_dir().join(&id);
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create extension folder: {}", e))?;
        let serialized = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
        fs::write(dir.join("manifest.json"), serialized).map_err(|e| format!("Failed to write manifest: {}", e))?;
        Ok(serde_json::json!({ "success": true, "id": id }))
    }

    /// Installs from a folder containing manifest.json (local import).
    pub fn install_from_folder(folder: &str) -> Result<Value, String> {
        let folder = folder.trim();
        if folder.to_lowercase().ends_with(".vsix") || folder.to_lowercase().ends_with(".zip") {
            return Err(
                "Unsupported package: Orbital X does not install VS Code .vsix archives or zips. \
                 Export the extension as a folder containing manifest.json (declarative pack), or pick a supported pack folder."
                    .into(),
            );
        }
        let src = PathBuf::from(folder);
        if !src.is_dir() {
            return Err(format!("'{}' is not a folder. Import expects a directory containing manifest.json.", folder));
        }
        let manifest = manifest_for(&src)
            .ok_or("No valid manifest.json found in the selected folder.")?;
        let manifest = validate_manifest(&manifest)?;
        let id = manifest.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();

        let dest = extensions_dir().join(&id);
        if dest.exists() {
            let _ = fs::remove_dir_all(&dest);
        }
        fs::create_dir_all(&dest).map_err(|e| format!("Failed to create extension folder: {}", e))?;
        copy_dir(&src, &dest)?;
        Ok(serde_json::json!({ "success": true, "id": id }))
    }

    pub fn uninstall(id: &str) -> Result<Value, String> {
        let dir = extensions_dir().join(id.trim());
        if !dir.exists() {
            return Ok(serde_json::json!({ "success": false, "error": format!("Extension '{}' is not installed", id) }));
        }
        fs::remove_dir_all(&dir).map_err(|e| format!("Failed to remove extension: {}", e))?;
        let mut state = load_state();
        state.remove(id.trim());
        save_state(&state);
        Ok(serde_json::json!({ "success": true, "id": id }))
    }

    pub fn set_enabled(id: &str, enabled: bool) -> Result<Value, String> {
        let dir = extensions_dir().join(id.trim());
        if !dir.exists() {
            return Ok(serde_json::json!({ "success": false, "error": format!("Extension '{}' is not installed", id) }));
        }
        let mut state = load_state();
        state.insert(id.trim().to_string(), Value::Bool(enabled));
        save_state(&state);
        Ok(serde_json::json!({ "success": true, "id": id, "enabled": enabled }))
    }
}

fn copy_dir(src: &Path, dest: &Path) -> Result<(), String> {
    for entry in fs::read_dir(src).map_err(|e| e.to_string())?.filter_map(|e| e.ok()) {
        let target = dest.join(entry.file_name());
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            copy_dir(&entry.path(), &target)?;
        } else if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            // Skip anything that looks like executable content — packs are data only
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if name.ends_with(".exe") || name.ends_with(".dll") || name.ends_with(".ps1") || name.ends_with(".bat") || name.ends_with(".cmd") {
                continue;
            }
            fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
        }
        // Symlinks and other exotic types are skipped
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_theme() -> Value {
        json!({
            "id": "test-theme",
            "name": "Test Theme",
            "description": "A test theme pack",
            "type": "theme",
            "version": "1.0.0",
            "publisher": "tests",
            "colors": { "--accent-cyan": "#00ffee" }
        })
    }

    #[test]
    fn test_validate_supported_types() {
        assert!(validate_manifest(&valid_theme()).is_ok());

        let mut prompt_pack = json!({
            "id": "test-prompt", "name": "P", "description": "d",
            "type": "prompt-pack",
            "systemPromptAddition": "Always write Rust with clippy-clean code."
        });
        assert!(validate_manifest(&prompt_pack).is_ok());

        let cmd_pack = json!({
            "id": "test-cmds", "name": "C", "description": "d",
            "type": "command-pack",
            "commands": [{ "id": "run", "title": "Run dev server", "command": "npm run dev" }]
        });
        assert!(validate_manifest(&cmd_pack).is_ok());
    }

    #[test]
    fn test_rejects_unsupported_and_invalid() {
        // Code-executing VS Code-style extension → clear unsupported error
        let vsix_like = json!({
            "id": "rust-analyzer", "name": "Rust Analyzer", "description": "LSP server",
            "type": "language-server", "main": "./server.js"
        });
        let err = validate_manifest(&vsix_like).unwrap_err();
        assert!(err.contains("not supported"));

        // Missing required fields
        let no_desc = json!({ "id": "x", "name": "X", "type": "theme", "colors": { "--a": "#fff" } });
        assert!(validate_manifest(&no_desc).is_err());

        // Theme without colors
        let no_colors = json!({ "id": "x", "name": "X", "description": "d", "type": "theme" });
        assert!(validate_manifest(&no_colors).is_err());

        // Bad id characters
        let bad_id = json!({ "id": "../escape", "name": "X", "description": "d", "type": "theme", "colors": { "--a": "#fff" } });
        assert!(validate_manifest(&bad_id).is_err());
    }

    #[test]
    fn test_install_enable_uninstall_roundtrip() {
        let res = ExtensionService::install_from_manifest(&valid_theme()).unwrap();
        assert_eq!(res["id"], "test-theme");

        let installed = ExtensionService::list_installed();
        let found = installed.iter().find(|m| m["id"] == "test-theme").expect("installed");
        assert_eq!(found["enabled"], serde_json::Value::Bool(true)); // defaultEnabled absent → true

        ExtensionService::set_enabled("test-theme", false).unwrap();
        let installed = ExtensionService::list_installed();
        let found = installed.iter().find(|m| m["id"] == "test-theme").unwrap();
        assert_eq!(found["enabled"], serde_json::Value::Bool(false));

        ExtensionService::uninstall("test-theme").unwrap();
        let installed = ExtensionService::list_installed();
        assert!(installed.iter().all(|m| m["id"] != "test-theme"));
    }
}
