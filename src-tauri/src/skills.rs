// ==========================================================================
// Orbital X — Skill Service (skills.rs)
//
// Skills are Claude Code-style instruction packs: a folder under
// ~/.orbital/skills/<id>/SKILL.md with YAML-ish frontmatter (name,
// description, whenToUse) and a markdown body of instructions. Skills never
// execute code — they are guidance the agent reads on demand (list_skills /
// read_skill tools), gated by the existing permission system like any read.
// ==========================================================================

use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

pub struct SkillService;

fn skills_dir() -> PathBuf {
    let dir = dirs::home_dir()
        .map(|h| h.join(".orbital").join("skills"))
        .unwrap_or_else(|| PathBuf::from(".orbital/skills"));
    let _ = fs::create_dir_all(&dir);
    dir
}

fn state_path() -> PathBuf {
    let dir = dirs::home_dir()
        .map(|h| h.join(".orbital"))
        .unwrap_or_else(|| PathBuf::from(".orbital"));
    let _ = fs::create_dir_all(&dir);
    dir.join("skills_state.json")
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

/// Parses simple `key: value` frontmatter lines between two `---` markers.
fn parse_skill_md(content: &str) -> Option<(Vec<(String, String)>, String)> {
    let trimmed = content.trim_start();
    let rest = trimmed.strip_prefix("---")?;
    let end = rest.find("\n---")?;
    let frontmatter = &rest[..end];
    let body = rest[end + 4..].trim_start_matches('-').trim_start().to_string();

    let mut fields = Vec::new();
    for line in frontmatter.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(idx) = line.find(':') {
            let key = line[..idx].trim().to_string();
            let value = line[idx + 1..].trim().trim_matches('"').trim_matches('\'').to_string();
            if !key.is_empty() {
                fields.push((key, value));
            }
        }
    }
    Some((fields, body))
}

fn load_skill_entry(dir: &std::path::Path) -> Option<Value> {
    let content = fs::read_to_string(dir.join("SKILL.md")).ok()?;
    let (fields, _body) = parse_skill_md(&content)?;
    let get = |key: &str| -> Option<String> {
        fields
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v.clone())
            .filter(|v| !v.is_empty())
    };

    let name = get("name")?;
    let description = get("description").unwrap_or_default();

    let id = dir.file_name()?.to_string_lossy().to_string();
    let state = load_state();
    let enabled = match state.get(&id) {
        Some(Value::Bool(b)) => *b,
        _ => true,
    };

    Some(json!({
        "id": id,
        "name": name,
        "description": description,
        "whenToUse": get("whenToUse"),
        "enabled": enabled,
        "bodyChars": content.len(),
    }))
}

impl SkillService {
    pub fn list() -> Vec<Value> {
        let mut out = Vec::new();
        if let Ok(entries) = fs::read_dir(skills_dir()) {
            for entry in entries.filter_map(|e| e.ok()) {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    if let Some(skill) = load_skill_entry(&entry.path()) {
                        out.push(skill);
                    }
                }
            }
        }
        out.sort_by_key(|s| s.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_lowercase());
        out
    }

    /// Returns the full SKILL.md body for the agent to read.
    /// Lookup by folder id or skill name; reads are confined to the skills dir.
    pub fn read(identifier: &str) -> Result<Value, String> {
        let ident = identifier.trim();
        if ident.is_empty() {
            return Err("read_skill requires a skill name or id".into());
        }
        if let Some(skill) = load_skill_entry(&skills_dir().join(ident)) {
            let content = fs::read_to_string(skills_dir().join(ident).join("SKILL.md"))
                .map_err(|e| e.to_string())?;
            return Ok(json!({ "skill": skill["name"], "content": content, "chars": content.len() }));
        }
        // Name-based lookup (id and display name often differ)
        for skill in Self::list() {
            if skill.get("name").and_then(|v| v.as_str()).map(|n| n.eq_ignore_ascii_case(ident)).unwrap_or(false) {
                let content = fs::read_to_string(skills_dir().join(skill["id"].as_str().unwrap_or_default()).join("SKILL.md"))
                    .map_err(|e| e.to_string())?;
                return Ok(json!({ "skill": skill["name"], "content": content, "chars": content.len() }));
            }
        }
        Err(format!("Skill '{}' not found. Call list_skills to see installed skills.", ident))
    }

    /// Installs a skill from a folder containing SKILL.md.
    pub fn install_from_folder(folder: &str) -> Result<Value, String> {
        let src = PathBuf::from(folder.trim());
        if !src.is_dir() {
            return Err(format!("'{}' is not a folder. Import expects a directory containing SKILL.md.", folder));
        }
        let content = fs::read_to_string(src.join("SKILL.md"))
            .map_err(|_| "No SKILL.md found in the selected folder.".to_string())?;
        let (fields, _) = parse_skill_md(&content)
            .ok_or("SKILL.md is missing frontmatter: start the file with a '---' block containing at least 'name:' and 'description:'")?;
        let has_name = fields.iter().any(|(k, v)| k.eq_ignore_ascii_case("name") && !v.is_empty());
        let has_desc = fields.iter().any(|(k, v)| k.eq_ignore_ascii_case("description") && !v.is_empty());
        if !has_name || !has_desc {
            return Err("SKILL.md frontmatter requires non-empty 'name:' and 'description:'".into());
        }
        if content.len() > 200_000 {
            return Err("SKILL.md exceeds the 200 KB limit".into());
        }

        let id = src.file_name().map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "imported-skill".into());
        let safe_id: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.').collect();
        if safe_id.is_empty() {
            return Err("Folder name cannot be converted to a valid skill id".into());
        }

        let dest = skills_dir().join(&safe_id);
        if dest.exists() {
            let _ = fs::remove_dir_all(&dest);
        }
        fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        // Only the SKILL.md (and small .md resource files) are copied — no executables
        fs::copy(src.join("SKILL.md"), dest.join("SKILL.md")).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(&src).map_err(|e| e.to_string())?.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if entry.file_type().map(|t| t.is_file()).unwrap_or(false)
                && (name.ends_with(".md") || name.ends_with(".txt") || name.ends_with(".json"))
                && entry.metadata().map(|m| m.len() < 500_000).unwrap_or(false)
            {
                let _ = fs::copy(entry.path(), dest.join(entry.file_name()));
            }
        }
        Ok(json!({ "success": true, "id": safe_id }))
    }

    pub fn delete(id: &str) -> Result<Value, String> {
        let dir = skills_dir().join(id.trim());
        if !dir.exists() {
            return Ok(json!({ "success": false, "error": format!("Skill '{}' is not installed", id) }));
        }
        fs::remove_dir_all(&dir).map_err(|e| format!("Failed to delete skill: {}", e))?;
        let mut state = load_state();
        state.remove(id.trim());
        save_state(&state);
        Ok(json!({ "success": true, "id": id }))
    }

    pub fn set_enabled(id: &str, enabled: bool) -> Result<Value, String> {
        let dir = skills_dir().join(id.trim());
        if !dir.exists() {
            return Ok(json!({ "success": false, "error": format!("Skill '{}' is not installed", id) }));
        }
        let mut state = load_state();
        state.insert(id.trim().to_string(), Value::Bool(enabled));
        save_state(&state);
        Ok(json!({ "success": true, "id": id, "enabled": enabled }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_frontmatter() {
        let md = "---\nname: Rust Expert\ndescription: \"Rust best practices\"\nwhenToUse: writing Rust\n---\n\nAlways run clippy.";
        let (fields, body) = parse_skill_md(md).unwrap();
        assert!(fields.iter().any(|(k, v)| k == "name" && v == "Rust Expert"));
        assert!(fields.iter().any(|(k, v)| k == "description" && v == "Rust best practices"));
        assert!(body.contains("Always run clippy."));
    }

    #[test]
    fn test_missing_frontmatter_rejected_by_install() {
        let tmp = std::env::temp_dir().join(format!("orbital_skill_bad_{}", std::process::id()));
        let _ = fs::create_dir_all(&tmp);
        let _ = fs::write(tmp.join("SKILL.md"), "no frontmatter here");
        let err = SkillService::install_from_folder(tmp.to_string_lossy().as_ref()).unwrap_err();
        assert!(err.contains("frontmatter"));
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_install_list_read_toggle_delete_roundtrip() {
        let tmp = std::env::temp_dir().join(format!("orbital_skill_ok_{}", std::process::id()));
        let _ = fs::create_dir_all(&tmp);
        let _ = fs::write(
            tmp.join("SKILL.md"),
            "---\nname: Test Skill\ndescription: roundtrip test\n---\nBody instructions here.",
        );

        let res = SkillService::install_from_folder(tmp.to_string_lossy().as_ref()).unwrap();
        let id = res["id"].as_str().unwrap().to_string();

        let listed = SkillService::list();
        assert!(listed.iter().any(|s| s["id"] == id.as_str() && s["name"] == "Test Skill"));

        let read = SkillService::read(&id).unwrap();
        assert!(read["content"].as_str().unwrap().contains("Body instructions here."));

        SkillService::set_enabled(&id, false).unwrap();
        let listed = SkillService::list();
        assert_eq!(
            listed.iter().find(|s| s["id"] == id.as_str()).unwrap()["enabled"],
            serde_json::Value::Bool(false)
        );

        SkillService::delete(&id).unwrap();
        assert!(!SkillService::list().iter().any(|s| s["id"] == id.as_str()));

        let _ = fs::remove_dir_all(&tmp);
    }
}
