use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// Strips Windows verbatim prefix (\\?\) so paths can be safely compared
pub fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchDeleteManifestItem {
    pub path: String,
    pub relative_path: String,
    pub size_bytes: u64,
    pub exists: bool,
    pub is_file: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchDeleteManifest {
    pub manifest_id: String,
    pub created_at: String,
    pub items: Vec<BatchDeleteManifestItem>,
    pub total_files: usize,
    pub total_bytes: u64,
}

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
    pending_manifests: HashMap<String, BatchDeleteManifest>,
}

impl WorkspaceService {
    pub fn new() -> Self {
        Self {
            root: None,
            change_journal: Vec::new(),
            pending_manifests: HashMap::new(),
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

    /// Validates that a target path is strictly within the permitted workspace root.
    /// Defeats symlink/junction escapes, Windows \\?\ prefix disparities, and prefix-collision bypasses.
    pub fn resolve_and_validate(&self, target_path: &str) -> Result<PathBuf, String> {
        let root = self.root.as_ref().ok_or("No workspace is currently open")?;
        let clean_root = strip_verbatim_prefix(root);

        let trimmed = target_path.trim();
        if trimmed.is_empty() {
            return Err("Security Violation: Target path cannot be empty.".into());
        }

        let candidate = if Path::new(trimmed).is_absolute() {
            strip_verbatim_prefix(Path::new(trimmed))
        } else {
            clean_root.join(trimmed)
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

        let norm_str = normalized.to_string_lossy().replace('\\', "/").to_lowercase();
        let root_str = clean_root.to_string_lossy().replace('\\', "/").to_lowercase();

        // Exact match or subpath check (must have trailing slash boundary to prevent prefix spoofing)
        let is_inside = if norm_str == root_str {
            true
        } else if norm_str.starts_with(&root_str) {
            let next_char = norm_str[root_str.len()..].chars().next();
            next_char == Some('/')
        } else {
            false
        };

        if !is_inside {
            return Err(format!("Security Violation: Path '{}' is outside workspace boundary.", target_path));
        }

        // If the path already exists, verify real canonical path to defeat symlink/junction redirection
        if normalized.exists() {
            if let Ok(canonical_target) = normalized.canonicalize() {
                let clean_target = strip_verbatim_prefix(&canonical_target);
                let target_str = clean_target.to_string_lossy().replace('\\', "/").to_lowercase();
                let target_inside = if target_str == root_str {
                    true
                } else if target_str.starts_with(&root_str) {
                    let next_char = target_str[root_str.len()..].chars().next();
                    next_char == Some('/')
                } else {
                    false
                };
                if !target_inside {
                    return Err("Security Violation: Symlink or filesystem redirection escapes workspace root.".into());
                }
            }
        }

        Ok(normalized)
    }

    /// Explicitly guards the workspace root against deletion
    pub fn ensure_not_workspace_root(&self, path: &Path) -> Result<(), String> {
        let root = self.root.as_ref().ok_or("No workspace is currently open")?;
        let clean_root = strip_verbatim_prefix(root);
        let clean_path = strip_verbatim_prefix(path);

        let p_str = clean_path.to_string_lossy().replace('\\', "/").to_lowercase();
        let r_str = clean_root.to_string_lossy().replace('\\', "/").to_lowercase();

        if p_str == r_str || p_str == format!("{}/", r_str) {
            return Err("Security Violation: Deleting the workspace root directory is strictly prohibited.".into());
        }
        Ok(())
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

    /// Delete a file from the workspace. Strictly prevents deleting the workspace root and journals deletion.
    pub fn delete_file(&mut self, path_str: &str) -> Result<String, String> {
        let full_path = self.resolve_and_validate(path_str)?;
        self.ensure_not_workspace_root(&full_path)?;
        if !full_path.exists() {
            return Err(format!("File not found: {}", path_str));
        }
        if full_path.is_dir() {
            return Err("Target is a directory, not a file. Use delete_directory instead.".into());
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

    /// Delete a directory within the workspace. Strictly prevents deleting the workspace root.
    pub fn delete_directory(&mut self, path_str: &str, recursive: bool) -> Result<serde_json::Value, String> {
        let full_path = self.resolve_and_validate(path_str)?;
        self.ensure_not_workspace_root(&full_path)?;

        if !full_path.exists() {
            return Err(format!("Directory not found: {}", path_str));
        }
        if !full_path.is_dir() {
            return Err(format!("Target is a file, not a directory: {}. Use delete_file instead.", path_str));
        }

        // Preview count and size before removal
        let mut file_count: usize = 0;
        let mut total_bytes: u64 = 0;
        for entry in WalkDir::new(&full_path).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                file_count += 1;
                total_bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }

        if !recursive && file_count > 0 {
            return Err(format!("Directory '{}' is not empty (contains {} files). Set recursive: true to delete.", path_str, file_count));
        }

        let entry = AgentChangeEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            path: full_path.to_string_lossy().replace('\\', "/"),
            before_content: Some(format!("Directory with {} files ({} bytes)", file_count, total_bytes)),
            after_content: String::new(),
            description: format!("Deleted directory: {} ({} files, {} bytes)", path_str, file_count, total_bytes),
        };
        self.change_journal.push(entry);

        fs::remove_dir_all(&full_path).map_err(|e| format!("Failed to delete directory: {}", e))?;

        Ok(serde_json::json!({
            "success": true,
            "path": path_str,
            "files_removed": file_count,
            "bytes_freed": total_bytes,
            "message": format!("Successfully removed directory '{}' ({} files, {} bytes)", path_str, file_count, total_bytes)
        }))
    }

    /// Stage 1 of Verified Batch File Deletion: Validate paths and generate verified deletion manifest.
    pub fn prepare_batch_delete(&mut self, paths: &[String]) -> Result<BatchDeleteManifest, String> {
        if paths.is_empty() {
            return Err("Batch delete requires at least one file path.".into());
        }

        let root = self.root.as_ref().ok_or("No workspace open")?;
        let clean_root = strip_verbatim_prefix(root);

        let mut items = Vec::new();
        let mut total_bytes: u64 = 0;

        for p_str in paths {
            let full_path = self.resolve_and_validate(p_str)?;
            self.ensure_not_workspace_root(&full_path)?;

            if !full_path.exists() {
                return Err(format!("File does not exist: {}", p_str));
            }
            if full_path.is_dir() {
                return Err(format!("Target '{}' is a directory. Batch file deletion only permits files.", p_str));
            }

            let meta = fs::metadata(&full_path).map_err(|e| format!("Cannot read metadata for {}: {}", p_str, e))?;
            let size = meta.len();
            total_bytes += size;

            let clean_full = strip_verbatim_prefix(&full_path);
            let rel = clean_full.strip_prefix(&clean_root).unwrap_or(&clean_full).to_string_lossy().replace('\\', "/");

            items.push(BatchDeleteManifestItem {
                path: p_str.clone(),
                relative_path: rel,
                size_bytes: size,
                exists: true,
                is_file: true,
            });
        }

        let manifest_id = format!("manifest_{}_{}", chrono::Utc::now().timestamp_millis(), &uuid::Uuid::new_v4().to_string()[..8]);
        let manifest = BatchDeleteManifest {
            manifest_id: manifest_id.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
            total_files: items.len(),
            total_bytes,
            items,
        };

        self.pending_manifests.insert(manifest_id, manifest.clone());
        Ok(manifest)
    }

    /// Stage 2 of Verified Batch File Deletion: Re-validate manifest targets against filesystem and execute deletion.
    pub fn execute_batch_delete(&mut self, manifest_id: &str) -> Result<serde_json::Value, String> {
        let manifest = self.pending_manifests.remove(manifest_id)
            .ok_or_else(|| format!("Deletion manifest '{}' not found, expired, or already executed.", manifest_id))?;

        let mut succeeded = Vec::new();
        let mut failed = Vec::new();
        let mut freed_bytes: u64 = 0;

        for item in &manifest.items {
            match self.resolve_and_validate(&item.path) {
                Ok(full_path) => {
                    if let Err(e) = self.ensure_not_workspace_root(&full_path) {
                        failed.push(serde_json::json!({ "path": item.path, "error": e }));
                        continue;
                    }

                    if !full_path.exists() || full_path.is_dir() {
                        failed.push(serde_json::json!({ "path": item.path, "error": "Target no longer exists or is a directory" }));
                        continue;
                    }

                    let old_content = fs::read_to_string(&full_path).unwrap_or_default();
                    let entry = AgentChangeEntry {
                        id: uuid::Uuid::new_v4().to_string(),
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        path: full_path.to_string_lossy().replace('\\', "/"),
                        before_content: Some(old_content),
                        after_content: String::new(),
                        description: format!("Batch deleted file (manifest {}): {}", manifest_id, item.path),
                    };
                    self.change_journal.push(entry);

                    match fs::remove_file(&full_path) {
                        Ok(_) => {
                            freed_bytes += item.size_bytes;
                            succeeded.push(item.path.clone());
                        }
                        Err(e) => {
                            failed.push(serde_json::json!({ "path": item.path, "error": e.to_string() }));
                        }
                    }
                }
                Err(e) => {
                    failed.push(serde_json::json!({ "path": item.path, "error": e }));
                }
            }
        }

        Ok(serde_json::json!({
            "success": failed.is_empty(),
            "manifest_id": manifest_id,
            "total_requested": manifest.total_files,
            "total_deleted": succeeded.len(),
            "bytes_freed": freed_bytes,
            "succeeded": succeeded,
            "failed": failed
        }))
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

    pub fn read_multiple_files(&self, paths: &[String], max_lines_per_file: usize) -> Result<Vec<serde_json::Value>, String> {
        let max_paths = 10;
        let limit = if max_lines_per_file == 0 { 300 } else { max_lines_per_file.min(500) };
        let mut results = Vec::new();

        for path_str in paths.iter().take(max_paths) {
            match self.resolve_and_validate(path_str) {
                Err(e) => {
                    results.push(serde_json::json!({
                        "path": path_str,
                        "error": e,
                        "success": false
                    }));
                }
                Ok(full_path) => {
                    if !full_path.exists() || !full_path.is_file() {
                        results.push(serde_json::json!({
                            "path": path_str,
                            "error": "File does not exist or is a directory",
                            "success": false
                        }));
                        continue;
                    }

                    match fs::read(&full_path) {
                        Err(e) => {
                            results.push(serde_json::json!({
                                "path": path_str,
                                "error": e.to_string(),
                                "success": false
                            }));
                        }
                        Ok(bytes) => {
                            let is_binary = bytes.iter().take(1024).any(|&b| b == 0);
                            if is_binary {
                                results.push(serde_json::json!({
                                    "path": path_str,
                                    "is_binary": true,
                                    "total_lines": 0,
                                    "content": "[Binary File]",
                                    "truncated": false,
                                    "success": true
                                }));
                                continue;
                            }

                            let content_full = String::from_utf8_lossy(&bytes).to_string();
                            let lines: Vec<&str> = content_full.lines().collect();
                            let total_lines = lines.len();

                            let (content, truncated) = if total_lines > limit {
                                let truncated_content = lines.iter().take(limit).cloned().collect::<Vec<_>>().join("\n");
                                (truncated_content, true)
                            } else {
                                (content_full, false)
                            };

                            results.push(serde_json::json!({
                                "path": path_str,
                                "total_lines": total_lines,
                                "lines_returned": if truncated { limit } else { total_lines },
                                "truncated": truncated,
                                "content": content,
                                "success": true
                            }));
                        }
                    }
                }
            }
        }

        Ok(results)
    }

    pub fn find_symbols(&self, symbol: &str, symbol_type: &str, max_results: usize) -> Result<Vec<serde_json::Value>, String> {
        let root = self.root.as_ref().ok_or("No workspace open")?;
        let symbol_clean = symbol.trim();
        if symbol_clean.is_empty() {
            return Err("Symbol cannot be empty".to_string());
        }

        let max_res = max_results.clamp(1, 50);
        let mut results = Vec::new();

        let escaped_sym = regex::escape(symbol_clean);
        let def_pattern = format!(
            r"(?i)\b(?:fn|function|class|struct|enum|trait|type|const|let|var|interface|def|pub\s+fn|async\s+fn|export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type))\s+{}\b",
            escaped_sym
        );
        let def_regex = regex::Regex::new(&def_pattern).map_err(|e| e.to_string())?;

        let word_pattern = format!(r"\b{}\b", escaped_sym);
        let word_regex = regex::Regex::new(&word_pattern).map_err(|e| e.to_string())?;

        let want_defs = symbol_type == "definition" || symbol_type == "all" || symbol_type.is_empty();
        let want_refs = symbol_type == "reference" || symbol_type == "all";

        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            if results.len() >= max_res {
                break;
            }
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            let fname = path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default();
            if fname.starts_with('.') || fname == "node_modules" || fname == "target" || fname == "dist" || fname == "package-lock.json" || fname == "Cargo.lock" {
                continue;
            }

            if let Some(ext) = path.extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                let is_code = matches!(ext_str.as_str(), "rs" | "js" | "ts" | "jsx" | "tsx" | "py" | "go" | "c" | "cpp" | "h" | "html" | "css");
                if !is_code {
                    continue;
                }
            } else {
                continue;
            }

            if let Ok(meta) = path.metadata() {
                if meta.len() > 300 * 1024 {
                    continue;
                }
            }

            if let Ok(text) = fs::read_to_string(path) {
                let rel = path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/");
                for (idx, line) in text.lines().enumerate() {
                    if results.len() >= max_res {
                        break;
                    }
                    let line_trimmed = line.trim();
                    if line_trimmed.is_empty() {
                        continue;
                    }

                    let is_def = def_regex.is_match(line_trimmed);
                    let is_ref = !is_def && word_regex.is_match(line_trimmed);

                    if want_defs && is_def {
                        results.push(serde_json::json!({
                            "file": rel,
                            "line": idx + 1,
                            "kind": "definition",
                            "snippet": line_trimmed,
                            "symbol": symbol_clean
                        }));
                    } else if want_refs && is_ref {
                        results.push(serde_json::json!({
                            "file": rel,
                            "line": idx + 1,
                            "kind": "reference",
                            "snippet": line_trimmed,
                            "symbol": symbol_clean
                        }));
                    }
                }
            }
        }

        Ok(results)
    }

    fn build_compact_tree(
        &self,
        current: &Path,
        root: &Path,
        depth: usize,
        max_depth: usize,
        include_files: bool,
        total_files: &mut usize,
        total_dirs: &mut usize,
    ) -> Result<serde_json::Value, String> {
        let name = current.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let rel_path = current.strip_prefix(root).unwrap_or(current).to_string_lossy().replace('\\', "/");

        if current.is_file() {
            *total_files += 1;
            let size = fs::metadata(current).map(|m| m.len()).unwrap_or(0);
            return Ok(serde_json::json!({
                "name": name,
                "path": rel_path,
                "type": "file",
                "size_bytes": size
            }));
        }

        *total_dirs += 1;
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
                    if fname.starts_with('.') || fname == "node_modules" || fname == "target" || fname == "dist" || fname == ".orbital" {
                        continue;
                    }
                    let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                    if !is_dir && !include_files {
                        *total_files += 1;
                        continue;
                    }

                    if let Ok(child) = self.build_compact_tree(&entry.path(), root, depth + 1, max_depth, include_files, total_files, total_dirs) {
                        children.push(child);
                    }
                }
            }
        }

        Ok(serde_json::json!({
            "name": if rel_path.is_empty() { "root".to_string() } else { name },
            "path": if rel_path.is_empty() { ".".to_string() } else { rel_path },
            "type": "directory",
            "children": children
        }))
    }

    pub fn get_project_structure(&self, max_depth: usize, include_files: bool) -> Result<serde_json::Value, String> {
        let root = self.root.as_ref().ok_or("No workspace open")?;
        let depth = max_depth.clamp(1, 5);

        let mut configs = Vec::new();
        let mut entry_points = Vec::new();
        let mut total_files = 0;
        let mut total_dirs = 0;

        let known_configs = [
            "package.json", "Cargo.toml", "tsconfig.json", "tauri.conf.json",
            "vite.config.js", "vite.config.ts", "webpack.config.js", "requirements.txt",
            "pyproject.toml", "Dockerfile", "docker-compose.yml", ".gitignore",
            "README.md", "ARCHITECTURE.md"
        ];

        let known_entry_points = [
            "src/main.rs", "src/lib.rs", "src/index.js", "src/index.ts",
            "src/app.js", "src/main.js", "index.html", "main.py", "app.py"
        ];

        let tree = self.build_compact_tree(root, root, 0, depth, include_files, &mut total_files, &mut total_dirs)?;

        for cfg in known_configs {
            if root.join(cfg).exists() {
                configs.push(cfg.to_string());
            }
        }
        for ep in known_entry_points {
            if root.join(ep).exists() {
                entry_points.push(ep.to_string());
            }
        }

        Ok(serde_json::json!({
            "root_name": root.file_name().map(|n| n.to_string_lossy()).unwrap_or_default(),
            "max_depth": depth,
            "total_files": total_files,
            "total_directories": total_dirs,
            "config_files": configs,
            "entry_points": entry_points,
            "tree": tree
        }))
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

        // Empty path rejected
        assert!(ws.resolve_and_validate("").is_err());

        // Workspace root deletion strictly rejected
        let root = ws.get_root().unwrap();
        let root_del_attempt = ws.ensure_not_workspace_root(&root);
        assert!(root_del_attempt.is_err());
        assert!(root_del_attempt.unwrap_err().contains("Deleting the workspace root directory is strictly prohibited"));
    }
}
