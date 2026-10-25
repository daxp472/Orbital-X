use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMemory {
    pub id: String,
    pub timestamp: String,
    pub category: String, // "architecture", "convention", "rule", "instruction"
    pub title: String,
    pub content: String,
    /// Importance 1-5 (5 = always inject first). Older entries default to 3.
    #[serde(default = "default_importance")]
    pub importance: u32,
}

fn default_importance() -> u32 {
    3
}

pub struct MemoryService;

impl MemoryService {
    fn get_memory_file(workspace_root: &Path) -> PathBuf {
        let dir = workspace_root.join(".orbital");
        if !dir.exists() {
            let _ = fs::create_dir_all(&dir);
        }
        dir.join("memory.json")
    }

    pub fn load_memories(workspace_root: &Path) -> Vec<ProjectMemory> {
        let file = Self::get_memory_file(workspace_root);
        if let Ok(bytes) = fs::read(&file) {
            if let Ok(mut memories) = serde_json::from_slice::<Vec<ProjectMemory>>(&bytes) {
                // Deduplicate any repeated entries by normalized category and title
                let mut unique: Vec<ProjectMemory> = Vec::new();
                let initial_len = memories.len();
                for m in memories.drain(..) {
                    let norm_title = m.title.trim().to_lowercase();
                    let norm_cat = m.category.trim().to_lowercase();
                    if let Some(existing) = unique.iter_mut().find(|e| {
                        e.title.trim().to_lowercase() == norm_title
                            && e.category.trim().to_lowercase() == norm_cat
                    }) {
                        existing.content = m.content;
                        existing.timestamp = m.timestamp;
                    } else {
                        unique.push(m);
                    }
                }

                // If duplicates were purged, persist the cleaned list back to disk
                if unique.len() != initial_len {
                    if let Ok(serialized) = serde_json::to_string_pretty(&unique) {
                        let _ = fs::write(&file, serialized);
                    }
                }
                return unique;
            }
        }
        Vec::new()
    }

    pub fn save_memory(
        workspace_root: &Path,
        category: &str,
        title: &str,
        content: &str,
    ) -> Result<ProjectMemory, String> {
        let mut memories = Self::load_memories(workspace_root);
        let norm_title = title.trim().to_lowercase();
        let norm_cat = category.trim().to_lowercase();

        // If an entry with the same category and title already exists, upsert it in place!
        if let Some(existing) = memories.iter_mut().find(|m| {
            m.title.trim().to_lowercase() == norm_title
                && m.category.trim().to_lowercase() == norm_cat
        }) {
            existing.content = content.to_string();
            existing.timestamp = chrono::Utc::now().to_rfc3339();
            let updated = existing.clone();
            let file = Self::get_memory_file(workspace_root);
            let serialized = serde_json::to_string_pretty(&memories).map_err(|e| e.to_string())?;
            fs::write(&file, serialized).map_err(|e| e.to_string())?;
            return Ok(updated);
        }

        let memory = ProjectMemory {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            category: category.to_string(),
            title: title.to_string(),
            content: content.to_string(),
            importance: 3,
        };

        memories.push(memory.clone());

        let file = Self::get_memory_file(workspace_root);
        let serialized = serde_json::to_string_pretty(&memories).map_err(|e| e.to_string())?;
        fs::write(&file, serialized).map_err(|e| e.to_string())?;

        Ok(memory)
    }

    pub fn delete_memory(workspace_root: &Path, id: &str) -> Result<bool, String> {
        let mut memories = Self::load_memories(workspace_root);
        let len_before = memories.len();
        memories.retain(|m| m.id != id);

        if memories.len() == len_before {
            return Ok(false);
        }

        let file = Self::get_memory_file(workspace_root);
        let serialized = serde_json::to_string_pretty(&memories).map_err(|e| e.to_string())?;
        fs::write(&file, serialized).map_err(|e| e.to_string())?;

        Ok(true)
    }

    pub fn search_memories(workspace_root: &Path, query: &str) -> Vec<ProjectMemory> {
        let memories = Self::load_memories(workspace_root);
        let q_lower = query.to_lowercase();

        memories
            .into_iter()
            .filter(|m| {
                m.title.to_lowercase().contains(&q_lower)
                    || m.content.to_lowercase().contains(&q_lower)
                    || m.category.to_lowercase().contains(&q_lower)
            })
            .collect()
    }
}
