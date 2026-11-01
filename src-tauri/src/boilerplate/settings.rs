use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoilerplateSettings {
    /// Global toggle for the file boilerplate feature.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// List of language keys or extensions for which boilerplate is disabled.
    #[serde(default)]
    pub disabled_languages: Vec<String>,
}

impl Default for BoilerplateSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            disabled_languages: Vec::new(),
        }
    }
}

impl BoilerplateSettings {
    /// Checks whether boilerplate is enabled for a given file name or language key.
    pub fn is_enabled_for(&self, file_or_lang: &str) -> bool {
        if !self.enabled {
            return false;
        }

        let clean = file_or_lang.trim().trim_start_matches('.').to_lowercase();
        // Check if any disabled language matches the extension or key
        !self
            .disabled_languages
            .iter()
            .any(|d| d.trim().trim_start_matches('.').to_lowercase() == clean)
    }

    /// Disables boilerplate for a language/extension.
    pub fn disable_language(&mut self, lang: &str) {
        let clean = lang.trim().trim_start_matches('.').to_lowercase();
        if !self.disabled_languages.iter().any(|d| d.to_lowercase() == clean) {
            self.disabled_languages.push(clean);
        }
    }

    /// Enables boilerplate for a language/extension.
    pub fn enable_language(&mut self, lang: &str) {
        let clean = lang.trim().trim_start_matches('.').to_lowercase();
        self.disabled_languages.retain(|d| d.to_lowercase() != clean);
    }
}

/// Returns the configuration path for boilerplate settings under `~/.orbital/boilerplate.json`.
pub fn settings_file_path() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".orbital"))
        .unwrap_or_else(|| PathBuf::from(".orbital"))
        .join("boilerplate.json")
}

/// Loads boilerplate settings from disk, falling back to default if file is absent or invalid.
pub fn load_settings_from_disk() -> BoilerplateSettings {
    let path = settings_file_path();
    if let Ok(bytes) = fs::read(&path)
        && let Ok(parsed) = serde_json::from_slice::<BoilerplateSettings>(&bytes)
    {
        return parsed;
    }
    BoilerplateSettings::default()
}

/// Saves boilerplate settings to disk.
pub fn save_settings_to_disk(settings: &BoilerplateSettings) -> Result<(), String> {
    let path = settings_file_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let serialized = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize boilerplate settings: {}", e))?;
    fs::write(&path, serialized)
        .map_err(|e| format!("Failed to write boilerplate settings to {:?}: {}", path, e))
}

/// Returns the user templates directory under `<config_dir>/templates/` (or `~/.orbital/templates/`).
pub fn user_templates_dir() -> PathBuf {
    if let Some(cfg) = dirs::config_dir() {
        let dir = cfg.join("orbital").join("templates");
        if dir.exists() {
            return dir;
        }
    }
    dirs::home_dir()
        .map(|h| h.join(".orbital").join("templates"))
        .unwrap_or_else(|| PathBuf::from(".orbital/templates"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_boilerplate_settings() {
        let mut settings = BoilerplateSettings::default();
        assert!(settings.is_enabled_for("rs"));
        assert!(settings.is_enabled_for("jsx"));
        assert!(settings.is_enabled_for(".jsx"));

        settings.disable_language("jsx");
        assert!(!settings.is_enabled_for("jsx"));
        assert!(!settings.is_enabled_for(".jsx"));
        assert!(settings.is_enabled_for("rs"));

        settings.enable_language("jsx");
        assert!(settings.is_enabled_for("jsx"));

        settings.enabled = false;
        assert!(!settings.is_enabled_for("rs"));
        assert!(!settings.is_enabled_for("jsx"));
    }
}
