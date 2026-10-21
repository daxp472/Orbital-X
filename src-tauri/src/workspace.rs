use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub relative_path: String,
    pub is_directory: bool,
    pub size_bytes: Option<u64>,
    pub children: Option<Vec<FileTreeNode>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceMeta {
    pub root_path: String,
    pub name: String,
    pub total_files: usize,
    pub languages_detected: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileReadResult {
    pub path: String,
    pub relative_path: String,
    pub content: String,
    pub is_binary: bool,
    pub total_lines: usize,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiff {
    pub path: String,
    pub old_content: String,
    pub new_content: String,
    pub diff_unified: String,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentChangeEntry {
    pub id: String,
    pub timestamp: String,
    pub path: String,
    pub before_content: Option<String>,
    pub after_content: String,
    pub description: String,
}

pub struct WorkspaceService {
    root: Option<PathBuf>,
    change_journal: Vec<AgentChangeEntry>,
}

impl WorkspaceService {
    pub fn new() -> Self {
        Self {
            root: None,
            change_journal: Vec::new(),
        }
    }

    pub fn set_root(&mut self, path_str: &str) -> Result<WorkspaceMeta, String> {
        let p = PathBuf::from(path_str);
        let canonical = p.canonicalize().map_err(|e| format!("Invalid path: {}", e))?;
        if !canonical.is_dir() {
            return Err("Target path is not a directory".into());
        }

        let name = canonical
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Workspace".into());

        self.root = Some(canonical.clone());

        // Quick scan to detect languages and file count
        let meta = self.scan_metadata(&canonical, &name);
        Ok(meta)
    }

    pub fn get_root(&self) -> Option<PathBuf> {
        self.root.clone()
    }

    /// Validates that a target path is strictly within the permitted workspace root
    pub fn resolve_and_validate(&self, target_path: &str) -> Result<PathBuf, String> {
        let root = self.root.as_ref().ok_or("No workspace is currently open")?;

        let candidate = if Path::new(target_path).is_absolute() {
            PathBuf::from(target_path)
        } else {
            root.join(target_path)
        };

        // Normalize path by resolving components
        let mut normalized = PathBuf::new();
        for component in candidate.components() {
            match component {
                std::path::Component::Prefix(p) => normalized.push(p.as_os_str()),
                std::path::Component::RootDir => normalized.push(std::path::MAIN_SEPARATOR.to_string()),
                std::path::Component::CurDir => {}
                std::path::Component::ParentDir => {
                    if !normalized.pop() {
                        return Err("Security Violation: Path traversal outside workspace root is blocked.".into());
                    }
                }
                std::path::Component::Normal(c) => normalized.push(c),
            }
        }

        // Canonicalize if exists, otherwise compare normalized prefix
        let normalized_str = normalized.to_string_lossy().replace('\\', "/").to_lowercase();
        let root_str = root.to_string_lossy().replace('\\', "/").to_lowercase();

        if !normalized_str.starts_with(&root_str) {
            return Err("Security Violation: Path traversal outside workspace root is blocked.".into());
        }

        Ok(normalized)
    }

    pub fn get_file_tree(&self, max_depth: usize) -> Result<FileTreeNode, String> {
        let root = self.root.as_ref().ok_or("No workspace open")?;
        let _name = root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "Root".into());

        Ok(self.build_tree(root, root, 0, max_depth))
    }

    fn build_tree(&self, current: &Path, root: &Path, depth: usize, max_depth: usize) -> FileTreeNode {
        let name = current.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let path_str = current.to_string_lossy().replace('\\', "/");
        let rel_path = current.strip_prefix(root).unwrap_or(current).to_string_lossy().replace('\\', "/");

        if current.is_file() {
            let size = fs::metadata(current).map(|m| m.len()).ok();
            return FileTreeNode {
                name,
                path: path_str,
                relative_path: rel_path,
                is_directory: false,
                size_bytes: size,
                children: None,
            };
        }

        let mut children = Vec::new();
        if depth < max_depth {
            if let Ok(entries) = fs::read_dir(current) {
                let mut dir_entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
                dir_entries.sort_by_key(|e| {
                    let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                    (!is_dir, e.file_name())
                });

                for entry in dir_entries {
                    let fname = entry.file_name().to_string_lossy().to_string();
                    // Ignore common bulky/sensitive folders
                    if fname == ".git" || fname == "node_modules" || fname == "target" || fname == "dist" || fname == ".orbital" {
                        continue;
                    }
                    children.push(self.build_tree(&entry.path(), root, depth + 1, max_depth));
                }
            }
        }

        FileTreeNode {
            name,
            path: path_str,
            relative_path: rel_path,
            is_directory: true,
            size_bytes: None,
            children: Some(children),
        }
    }

    pub fn read_file(&self, path_str: &str) -> Result<FileReadResult, String> {
        let full_path = self.resolve_and_validate(path_str)?;
        let root = self.root.as_ref().unwrap();
        let rel_path = full_path.strip_prefix(root).unwrap_or(&full_path).to_string_lossy().replace('\\', "/");

        let meta = fs::metadata(&full_path).map_err(|e| e.to_string())?;
        if meta.len() > 3 * 1024 * 1024 {
            return Err("File size exceeds 3MB limit for editor viewing".into());
        }

        let bytes = fs::read(&full_path).map_err(|e| e.to_string())?;
        // Check for binary content
        let is_binary = bytes.iter().take(1024).any(|&b| b == 0);
        if is_binary {
            return Ok(FileReadResult {
                path: full_path.to_string_lossy().replace('\\', "/"),
                relative_path: rel_path,
                content: "[Binary File]".into(),
                is_binary: true,
                total_lines: 0,
                size_bytes: meta.len(),
            });
        }

        let content = String::from_utf8_lossy(&bytes).to_string();
        let line_count = content.lines().count();

        Ok(FileReadResult {
            path: full_path.to_string_lossy().replace('\\', "/"),
            relative_path: rel_path,
            content,
            is_binary: false,
            total_lines: line_count,
            size_bytes: meta.len(),
        })
    }

    pub fn write_file(&mut self, path_str: &str, content: &str, description: &str) -> Result<FileDiff, String> {
        let full_path = self.resolve_and_validate(path_str)?;

        // Ensure parent directory exists
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let old_content = if full_path.exists() {
            fs::read_to_string(&full_path).unwrap_or_default()
        } else {
            String::new()
        };

        let diff = self.compute_diff(&full_path.to_string_lossy(), &old_content, content);

        // Journal this change for undo capability
        let entry = AgentChangeEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            path: full_path.to_string_lossy().replace('\\', "/"),
            before_content: if full_path.exists() { Some(old_content.clone()) } else { None },
            after_content: content.to_string(),
            description: description.to_string(),
        };
        self.change_journal.push(entry);

        fs::write(&full_path, content).map_err(|e| e.to_string())?;

        Ok(diff)
    }

    pub fn create_directory(&self, path_str: &str) -> Result<(), String> {
        let full_path = self.resolve_and_validate(path_str)?;
        fs::create_dir_all(&full_path).map_err(|e| e.to_string())
    }

    /// Delete a file from the workspace. Journals the deletion for undo.
    pub fn delete_file(&mut self, path_str: &str) -> Result<String, String> {
        let full_path = self.resolve_and_validate(path_str)?;
        if !full_path.exists() {
            return Err(format!("File not found: {}", path_str));
        }
        if full_path.is_dir() {
            return Err("Use delete_file only for files, not directories.".into());
        }
        let old_content = fs::read_to_string(&full_path).unwrap_or_default();
        let entry = AgentChangeEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            path: full_path.to_string_lossy().replace('\\', "/"),
            before_content: Some(old_content),
            after_content: String::new(),
            description: format!("Deleted file: {}", path_str),
        };
        self.change_journal.push(entry);
        fs::remove_file(&full_path).map_err(|e| e.to_string())?;
        Ok(format!("Deleted {}", path_str))
    }

    /// Rename or move a file within the workspace.
    pub fn rename_file(&mut self, from_str: &str, to_str: &str) -> Result<String, String> {
        let from_path = self.resolve_and_validate(from_str)?;
        let to_path = self.resolve_and_validate(to_str)?;
        if !from_path.exists() {
            return Err(format!("Source not found: {}", from_str));
        }
        if let Some(parent) = to_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::rename(&from_path, &to_path).map_err(|e| e.to_string())?;
        Ok(format!("Renamed {} -> {}", from_str, to_str))
    }

    /// Read a specific line range from a file (1-indexed, inclusive).
    /// Returns lines with line numbers prepended — saves context when working on large files.
    pub fn read_file_lines(&self, path_str: &str, start_line: usize, end_line: usize) -> Result<serde_json::Value, String> {
        let full_path = self.resolve_and_validate(path_str)?;
        let root = self.root.as_ref().unwrap();
        let rel = full_path.strip_prefix(root).unwrap_or(&full_path).to_string_lossy().replace('\\', "/");

        let content = fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
        let total_lines = content.lines().count();
        let start = start_line.saturating_sub(1); // 0-indexed
        let end = end_line.min(total_lines);

        let numbered: String = content
            .lines()
            .enumerate()
            .skip(start)
            .take(end.saturating_sub(start))
            .map(|(i, line)| format!("{}: {}", i + 1, line))
            .collect::<Vec<_>>()
            .join("\n");

        Ok(serde_json::json!({
            "file": rel,
            "start_line": start + 1,
            "end_line": end,
            "total_lines": total_lines,
            "content": numbered
        }))
    }

    /// Apply a targeted patch: replace lines [start_line..end_line] with new_content.
    /// This avoids full-file rewrites on large files — critical for working on real codebases.
    pub fn patch_file(&mut self, path_str: &str, start_line: usize, end_line: usize, new_content: &str, description: &str) -> Result<FileDiff, String> {
        let full_path = self.resolve_and_validate(path_str)?;
        let old_content = if full_path.exists() {
            fs::read_to_string(&full_path).map_err(|e| e.to_string())?
        } else {
            return Err(format!("File not found for patching: {}", path_str));
        };

        let mut lines: Vec<&str> = old_content.lines().collect();
        let total = lines.len();
        let start_idx = start_line.saturating_sub(1).min(total);
        let end_idx = end_line.min(total);

        let new_lines: Vec<&str> = new_content.lines().collect();
        let _ = lines.drain(start_idx..end_idx);
        for (i, l) in new_lines.iter().enumerate() {
            lines.insert(start_idx + i, l);
        }

        // Preserve trailing newline
        let mut final_content = lines.join("\n");
        if old_content.ends_with('\n') {
            final_content.push('\n');
        }

        let diff = self.compute_diff(path_str, &old_content, &final_content);

        let entry = AgentChangeEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            path: full_path.to_string_lossy().replace('\\', "/"),
            before_content: Some(old_content),
            after_content: final_content.clone(),
            description: description.to_string(),
        };
        self.change_journal.push(entry);

        fs::write(&full_path, &final_content).map_err(|e| e.to_string())?;
        Ok(diff)
    }

    pub fn compute_diff(&self, path: &str, old_text: &str, new_text: &str) -> FileDiff {
        let diff = similar::TextDiff::from_lines(old_text, new_text);
        let mut unified = String::new();
        let mut additions = 0;
        let mut deletions = 0;

        for change in diff.iter_all_changes() {
            match change.tag() {
                similar::ChangeTag::Delete => {
                    deletions += 1;
                    unified.push_str(&format!("-{}", change.value()));
                }
                similar::ChangeTag::Insert => {
                    additions += 1;
                    unified.push_str(&format!("+{}", change.value()));
                }
                similar::ChangeTag::Equal => {
                    unified.push_str(&format!(" {}", change.value()));
                }
            }
        }

        FileDiff {
            path: path.replace('\\', "/"),
            old_content: old_text.to_string(),
            new_content: new_text.to_string(),
            diff_unified: unified,
            additions,
            deletions,
        }
    }

    pub fn undo_last_change(&mut self) -> Result<String, String> {
        let entry = self.change_journal.pop().ok_or("No agent changes to undo")?;
        let full_path = PathBuf::from(&entry.path);

        match entry.before_content {
            Some(prev_content) => {
                fs::write(&full_path, prev_content).map_err(|e| e.to_string())?;
                Ok(format!("Reverted {} to previous state", entry.path))
            }
            None => {
                // File was newly created by agent, so delete it on undo
                if full_path.exists() {
                    fs::remove_file(&full_path).map_err(|e| e.to_string())?;
                }
                Ok(format!("Deleted newly created file {}", entry.path))
            }
        }
    }

    pub fn search_files(&self, query: &str, max_results: usize) -> Result<Vec<serde_json::Value>, String> {
        let root = self.root.as_ref().ok_or("No workspace open")?;
        let query_lower = query.to_lowercase();
        let mut matches = Vec::new();

        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            if matches.len() >= max_results {
                break;
            }

            let path = entry.path();
            let fname = path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default();
            if fname == ".git" || fname == "node_modules" || fname == "target" || fname == "dist" {
                continue;
            }

            if path.is_file() {
                let rel = path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/");
                // Check filename match
                if fname.to_lowercase().contains(&query_lower) {
                    matches.push(serde_json::json!({
                        "file": rel,
                        "match_type": "filename",
                        "line": null,
                        "snippet": fname
                    }));
                }

                // Check text content if small
                if let Ok(meta) = path.metadata() {
                    if meta.len() < 500 * 1024 {
                        if let Ok(text) = fs::read_to_string(path) {
                            for (idx, line) in text.lines().enumerate() {
                                if line.to_lowercase().contains(&query_lower) {
                                    matches.push(serde_json::json!({
                                        "file": rel,
                                        "match_type": "content",
                                        "line": idx + 1,
                                        "snippet": line.trim()
                                    }));
                                    if matches.len() >= max_results {
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(matches)
    }

    fn scan_metadata(&self, root: &Path, name: &str) -> WorkspaceMeta {
        let mut count = 0;
        let mut languages = std::collections::HashSet::new();

        for entry in WalkDir::new(root).max_depth(3).into_iter().filter_map(|e| e.ok()) {
            if entry.path().is_file() {
                count += 1;
                if let Some(ext) = entry.path().extension() {
                    match ext.to_string_lossy().to_lowercase().as_str() {
                        "rs" => { languages.insert("Rust".into()); },
                        "js" | "mjs" | "cjs" => { languages.insert("JavaScript".into()); },
                        "ts" | "tsx" => { languages.insert("TypeScript".into()); },
                        "py" => { languages.insert("Python".into()); },
                        "html" | "htm" => { languages.insert("HTML".into()); },
                        "css" | "scss" => { languages.insert("CSS".into()); },
                        "json" => { languages.insert("JSON".into()); },
                        "md" => { languages.insert("Markdown".into()); },
                        "go" => { languages.insert("Go".into()); },
                        "cpp" | "c" | "h" => { languages.insert("C/C++".into()); },
                        _ => {}
                    }
                }
            }
        }

        let mut langs_vec: Vec<String> = languages.into_iter().collect();
        langs_vec.sort();

        WorkspaceMeta {
            root_path: root.to_string_lossy().replace('\\', "/"),
            name: name.to_string(),
            total_files: count,
            languages_detected: langs_vec,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_diff() {
        let ws = WorkspaceService::new();
        let old_text = "fn main() {\n    println!(\"hello\");\n}\n";
        let new_text = "fn main() {\n    println!(\"hello, world!\");\n}\n";

        let diff = ws.compute_diff("main.rs", old_text, new_text);
        assert_eq!(diff.additions, 1);
        assert_eq!(diff.deletions, 1);
        assert!(diff.diff_unified.contains("+    println!(\"hello, world!\");"));
    }

    #[test]
    fn test_path_security_boundary() {
        let mut ws = WorkspaceService::new();
        let cur = std::env::current_dir().unwrap();
        ws.set_root(&cur.to_string_lossy()).unwrap();

        // Legitimate relative path inside workspace
        let ok_path = ws.resolve_and_validate("src/lib.rs");
        assert!(ok_path.is_ok());

        // Path traversal attack outside workspace
        let attack = ws.resolve_and_validate("../../Windows/System32/cmd.exe");
        assert!(attack.is_err());
        assert!(attack.unwrap_err().contains("Security Violation"));
    }
}
