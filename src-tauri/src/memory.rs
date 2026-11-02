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

    /// Information Directory Query (Librarian Indexer).
    /// Retrieves historical work, changelogs, and persistent knowledge without
    /// flooding the LLM context window.
    pub fn query_information_directory(
        workspace_root: &Path,
        query: &str,
        category_filter: Option<&str>,
    ) -> serde_json::Value {
        let q_lower = query.trim().to_lowercase();
        let cat_filter = category_filter.map(|c| c.trim().to_lowercase());

        // 1. Search memory entries
        let memories = Self::load_memories(workspace_root);
        let mut matching_records = Vec::new();

        for m in &memories {
            if let Some(ref cf) = cat_filter {
                if !m.category.to_lowercase().contains(cf) {
                    continue;
                }
            }
            if q_lower.is_empty()
                || m.title.to_lowercase().contains(&q_lower)
                || m.content.to_lowercase().contains(&q_lower)
                || m.category.to_lowercase().contains(&q_lower)
            {
                matching_records.push(serde_json::json!({
                    "source": "project_memory",
                    "id": m.id,
                    "category": m.category,
                    "title": m.title,
                    "content": m.content,
                    "timestamp": m.timestamp,
                }));
            }
        }

        // 2. Search changelogs/ directory (past iteration changes and library records)
        let changelog_dir = workspace_root.join("changelogs");
        if changelog_dir.exists() {
            if let Ok(entries) = fs::read_dir(&changelog_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().map_or(false, |ext| ext == "md") {
                        if let Ok(content) = fs::read_to_string(&path) {
                            let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                            if q_lower.is_empty()
                                || filename.to_lowercase().contains(&q_lower)
                                || content.to_lowercase().contains(&q_lower)
                            {
                                let preview = if content.len() > 600 {
                                    format!("{}...", &content[..600])
                                } else {
                                    content
                                };
                                matching_records.push(serde_json::json!({
                                    "source": "changelog_library",
                                    "id": filename.clone(),
                                    "category": "iteration_history",
                                    "title": format!("Changelog: {}", filename),
                                    "content": preview,
                                    "timestamp": chrono::Utc::now().to_rfc3339(),
                                }));
                            }
                        }
                    }
                }
            }
        }

        let total_matches = matching_records.len();
        let summary = if total_matches == 0 {
            format!("Information Directory Indexer: No records matched '{}'. Available categories in library: architecture, convention, iteration_history, rule, progress.", query)
        } else {
            format!("Information Directory Indexer: Retrieved {} records from the library matching '{}'.", total_matches, query)
        };

        serde_json::json!({
            "status": "success",
            "query": query,
            "total_matches": total_matches,
            "indexer_note": summary,
            "records": matching_records.into_iter().take(5).collect::<Vec<_>>()
        })
    }
}
