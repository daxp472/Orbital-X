use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// Strips Windows verbatim prefix (\\?\, \\?\UNC\, or //?/) so paths can be safely compared
pub fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    let norm = s.replace('/', "\\");
    if let Some(stripped) = norm.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{}", stripped))
    } else if let Some(stripped) = norm.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else if let Some(stripped) = s.strip_prefix("//?/") {
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
    /// Metadata scanned once at set_root; served to get_workspace_meta without
    /// re-walking the tree on every IPC call.
    cached_meta: Option<WorkspaceMeta>,
}

impl WorkspaceService {
    pub fn new() -> Self {
        Self {
            root: None,
            change_journal: Vec::new(),
            pending_manifests: HashMap::new(),
            cached_meta: None,
        }
    }

    pub fn set_root(&mut self, path_str: &str) -> Result<WorkspaceMeta, String> {
        let p = PathBuf::from(path_str);
        let canonical = p.canonicalize().map_err(|e| format!("Invalid path: {}", e))?;
        if !canonical.is_dir() {
            return Err("Target path is not a directory".into());
        }

        let clean_canonical = strip_verbatim_prefix(&canonical);
        let name = clean_canonical
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Workspace".into());

        self.root = Some(clean_canonical.clone());

        // Quick scan to detect languages and file count
        let meta = self.scan_metadata(&clean_canonical, &name);
        self.cached_meta = Some(meta.clone());
        Ok(meta)
    }

    pub fn get_root(&self) -> Option<PathBuf> {
        self.root.clone()
    }

    pub fn cached_meta(&self) -> Option<&WorkspaceMeta> {
        self.cached_meta.as_ref()
    }

    /// Validates that a target path is strictly within the permitted workspace root.
    /// Defeats symlink/junction escapes, Windows \\?\ prefix disparities, and prefix-collision bypasses.
    pub fn resolve_and_validate(&self, target_path: &str) -> Result<PathBuf, String> {
        let root = self.root.as_ref().ok_or("No workspace is currently open")?;
        let clean_root = strip_verbatim_prefix(root);
        let root_str = clean_root.to_string_lossy().replace('\\', "/").to_lowercase();

        let trimmed = target_path.trim();
        if trimmed.is_empty() {
            return Err("Security Violation: Target path cannot be empty.".into());
        }

        let target_path_buf = PathBuf::from(trimmed);
        let clean_target = strip_verbatim_prefix(&target_path_buf);

        let candidate = if clean_target.is_absolute() {
            clean_target
        } else {
            clean_root.join(clean_target)
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

        let clean_norm = strip_verbatim_prefix(&normalized);
        if !Self::is_inside(&clean_norm, &root_str) {
            return Err(format!("Security Violation: Path '{}' is outside workspace boundary.", target_path));
        }

        // Revalidate against the REAL filesystem to defeat redirection:
        // - for existing paths, canonicalize and re-check
        // - for new paths, canonicalize the deepest EXISTING ancestor — a
        //   not-yet-existing target under a symlinked parent directory would
        //   otherwise pass the string check and write outside the workspace
        let probe = if clean_norm.exists() {
            clean_norm.clone()
        } else {
            let mut p = clean_norm.clone();
            while !p.exists() {
                match p.parent() {
                    Some(parent) if parent != p => p = parent.to_path_buf(),
                    _ => break,
                }
            }
            p
        };

        if probe.exists() {
            if let Ok(canonical_probe) = probe.canonicalize() {
                let clean_canonical = strip_verbatim_prefix(&canonical_probe);
                if !Self::is_inside(&clean_canonical, &root_str) {
                    return Err("Security Violation: Symlink or filesystem redirection escapes workspace root.".into());
                }
            }
        }

        Ok(clean_norm)
    }

    /// Case-insensitive (Windows-aware) containment check with a path-separator
    /// boundary so `C:\work` does not contain `C:\workspace`.
    fn is_inside(path: &Path, root_str: &str) -> bool {
        let p_str = path.to_string_lossy().replace('\\', "/").to_lowercase();
        if p_str == root_str {
            return true;
        }
        if p_str.starts_with(root_str) {
            return p_str[root_str.len()..].chars().next() == Some('/');
        }
        false
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
        let clean_cur = strip_verbatim_prefix(current);
        let clean_rt = strip_verbatim_prefix(root);
        let name = clean_cur.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let path_str = clean_cur.to_string_lossy().replace('\\', "/");
        let rel_path = clean_cur.strip_prefix(&clean_rt).unwrap_or(&clean_cur).to_string_lossy().replace('\\', "/");

        // Never descend into or display through symlinks/junctions — the link
        // target may live outside the workspace.
        let is_symlink = fs::symlink_metadata(&clean_cur).map(|m| m.file_type().is_symlink()).unwrap_or(false);
        if is_symlink {
            return FileTreeNode {
                name,
                path: path_str,
                relative_path: rel_path,
                is_directory: false,
                size_bytes: None,
                children: Some(vec![]),
            };
        }

        if clean_cur.is_file() {
            let size = fs::metadata(&clean_cur).map(|m| m.len()).ok();
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
            if let Ok(entries) = fs::read_dir(&clean_cur) {
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

        // Guard against reading huge files fully into memory just to slice them
        if let Ok(meta) = fs::metadata(&full_path) {
            if meta.len() > 3 * 1024 * 1024 {
                return Err(format!(
                    "File '{}' is {}MB — exceeds the 3MB read limit. Use search_files or find_symbol to locate the relevant section first.",
                    path_str, meta.len() / (1024 * 1024)
                ));
            }
        }

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

        // Models sometimes emit inverted or zero ranges. Validate instead of
        // panicking inside drain(..): a panic here would poison the workspace
        // Mutex and break every subsequent file operation until restart.
        let start_line = start_line.max(1);
        if end_line < start_line {
            return Err(format!(
                "Invalid patch range: end_line ({}) must be greater than or equal to start_line ({}).",
                end_line, start_line
            ));
        }

        let mut lines: Vec<&str> = old_content.lines().collect();
        let total = lines.len();
        let start_idx = (start_line - 1).min(total);
        let end_idx = end_line.min(total);

        let new_lines: Vec<&str> = new_content.lines().collect();
        let _ = lines.drain(start_idx..end_idx);
        for (i, l) in new_lines.iter().enumerate() {
            lines.insert(start_idx + i, l);
        }

        let mut final_content = lines.join("\n");
        // Preserve the original trailing newline if there was one
        if old_content.ends_with('\n') {
            final_content.push('\n');
        }
        // Preserve Windows CRLF line endings: joining with \n would otherwise
        // rewrite every line of the file and flood the git diff.
        let had_crlf = old_content.contains("\r\n") && !old_content.contains("\n\r");
        if had_crlf && !final_content.contains('\r') {
            final_content = final_content.replace('\n', "\r\n");
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

    /// Checkpoint support (agent UI): the recent change journal, newest last.
    /// Entries include only metadata (path, description, timestamp) — full
    /// before/after content stays in memory for restore operations.
    pub fn list_journal_summary(&self) -> Vec<serde_json::Value> {
        let start = self.change_journal.len().saturating_sub(20);
        self.change_journal[start..]
            .iter()
            .map(|e| {
                serde_json::json!({
                    "index": self.change_journal.iter().position(|x| x.id == e.id).unwrap_or(0),
                    "id": e.id,
                    "timestamp": e.timestamp,
                    "path": e.path,
                    "description": e.description,
                    "kind": if e.before_content.is_some() { "edit" } else { "create" },
                })
            })
            .collect()
    }

    /// Restores the workspace to the state just AFTER checkpoint `index`
    /// by reverting every journal entry newer than it (newest first).
    pub fn restore_to_checkpoint(&mut self, index: usize) -> Result<serde_json::Value, String> {
        if index >= self.change_journal.len() {
            return Err(format!("Checkpoint {} not found (journal has {} entries)", index, self.change_journal.len()));
        }
        let mut reverted = 0usize;
        let mut failed: Vec<String> = Vec::new();
        // Iterate newest → index+1, undoing each in place
        let mut i = self.change_journal.len();
        while i > index + 1 {
            i -= 1;
            let entry = &self.change_journal[i];
            match &entry.before_content {
                Some(prev) => {
                    if let Err(e) = fs::write(&entry.path, prev) {
                        failed.push(format!("{}: {}", entry.path, e));
                        continue;
                    }
                }
                None => {
                    let p = PathBuf::from(&entry.path);
                    if p.exists() {
                        if let Err(e) = fs::remove_file(&p) {
                            failed.push(format!("{}: {}", entry.path, e));
                            continue;
                        }
                    }
                }
            }
            reverted += 1;
        }
        // Truncate the journal to the checkpoint (it is restored state now)
        self.change_journal.truncate(index + 1);

        Ok(serde_json::json!({
            "success": failed.is_empty(),
            "reverted": reverted,
            "failed": failed,
        }))
    }

    pub fn undo_last_change(&mut self) -> Result<String, String> {
        let entry = self.change_journal.pop().ok_or("No agent changes to undo")?;
        let full_path = PathBuf::from(&entry.path);

        // Revalidate the journaled path against the CURRENT workspace root —
        // the journal survives workspace switches, and undoing into a
        // different (or unbounded) location must not be possible.
        if let Err(e) = self.resolve_and_validate(&entry.path) {
            return Err(format!(
                "Cannot undo change to {}: it is outside the current workspace boundary ({}). The journal entry was preserved.",
                entry.path, e
            ));
        }

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

        let mut it = WalkDir::new(root).into_iter();
        while let Some(entry) = it.next().map(|e| e.ok()).flatten() {
            if matches.len() >= max_results {
                break;
            }

            // Skip symlinks entirely (file or directory) — following them could
            // read content outside the workspace boundary.
            if entry.file_type().is_symlink() {
                it.skip_current_dir();
                continue;
            }

            let path = entry.path();
            let fname = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();

            // Skip the whole subtree of bulky/generated directories — checking
            // only the entry name still descended into node_modules children.
            if entry.file_type().is_dir() {
                if fname == ".git" || fname == "node_modules" || fname == "target" || fname == "dist" || fname == ".orbital" {
                    it.skip_current_dir();
                    continue;
                }
                if fname.starts_with('.') && entry.depth() > 0 {
                    it.skip_current_dir();
                    continue;
                }
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

    /// Glob pattern (comma-separated list, `*` within a segment, `**` across
    /// segments, `?` single char) → matcher closure for include/exclude sets.
    fn glob_matcher(patterns: &str) -> Option<Vec<regex::Regex>> {
        let mut out = Vec::new();
        for pat in patterns.split(',').map(|p| p.trim()).filter(|p| !p.is_empty()) {
            let mut re = String::from("^");
            let mut chars = pat.chars().peekable();
            while let Some(c) = chars.next() {
                match c {
                    '*' => {
                        if chars.peek() == Some(&'*') {
                            chars.next();
                            let _ = chars.next_if(|&x| x == '/'); // tolerate **/
                            re.push_str(".*");
                        } else {
                            re.push_str("[^/]*");
                        }
                    }
                    '?' => re.push_str("[^/]"),
                    other => {
                        re.push_str(&regex::escape(&other.to_string()));
                    }
                }
            }
            re.push('$');
            match regex::RegexBuilder::new(&re).case_insensitive(true).build() {
                Ok(r) => out.push(r),
                Err(_) => return None,
            }
        }
        if out.is_empty() { None } else { Some(out) }
    }

    /// Find & Replace backend: regex or literal search with case/whole-word
    /// flags and include/exclude globs. Returns per-line matches.
    pub fn search_files_advanced(
        &self,
        query: &str,
        is_regex: bool,
        case_sensitive: bool,
        whole_word: bool,
        include: Option<&str>,
        exclude: Option<&str>,
        max_results: usize,
    ) -> Result<Vec<serde_json::Value>, String> {
        let root = self.root.as_ref().ok_or("No workspace open")?;

        // Build the line matcher
        let pattern = if is_regex {
            query.to_string()
        } else {
            regex::escape(query)
        };
        let pattern = if whole_word {
            format!(r"(?:{})", pattern)
        } else {
            pattern
        };
        let matcher = regex::RegexBuilder::new(&pattern)
            .case_insensitive(!case_sensitive)
            .build()
            .map_err(|e| format!("Invalid search pattern: {}", e))?;

        let include_res = include.and_then(Self::glob_matcher);
        let exclude_res = exclude.and_then(Self::glob_matcher);
        let path_allowed = |rel: &str| -> bool {
            if let Some(exs) = &exclude_res {
                if exs.iter().any(|re| re.is_match(rel)) { return false; }
            }
            if let Some(incs) = &include_res {
                return incs.iter().any(|re| re.is_match(rel));
            }
            true
        };

        let mut matches_out: Vec<serde_json::Value> = Vec::new();
        let mut it = WalkDir::new(root).into_iter();
        while let Some(entry) = it.next().map(|e| e.ok()).flatten() {
            if matches_out.len() >= max_results { break; }
            let path = entry.path();
            if !path.is_file() {
                let dname = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                if dname == ".git" || dname == "node_modules" || dname == "target" || dname == "dist" || dname == ".orbital" {
                    it.skip_current_dir();
                }
                continue;
            }
            if entry.file_type().is_symlink() { continue; }
            if let Ok(meta) = entry.metadata() {
                if meta.len() > 500 * 1024 { continue; }
            }
            let rel = path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/");
            if !path_allowed(&rel) { continue; }
            if let Ok(bytes) = fs::read(path) {
                if bytes.iter().take(1024).any(|&b| b == 0) { continue; }
                let text = String::from_utf8_lossy(&bytes);
                for (idx, line) in text.lines().enumerate() {
                    if matcher.is_match(line) {
                        matches_out.push(serde_json::json!({
                            "file": rel,
                            "line": idx + 1,
                            "snippet": line.trim().chars().take(400).collect::<String>(),
                            "match_text": matcher.find(line).map(|m| m.as_str().to_string()).unwrap_or_default(),
                        }));
                        if matches_out.len() >= max_results { break; }
                    }
                }
            }
        }
        Ok(matches_out)
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

                    if let Ok(meta) = full_path.metadata() {
                        if meta.len() > 3 * 1024 * 1024 {
                            results.push(serde_json::json!({
                                "path": path_str,
                                "error": format!("File is {}MB — exceeds the 3MB read limit", meta.len() / (1024 * 1024)),
                                "success": false
                            }));
                            continue;
                        }
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

        let mut it = WalkDir::new(root).into_iter();
        while let Some(entry) = it.next().map(|e| e.ok()).flatten() {
            if results.len() >= max_res {
                break;
            }
            let path = entry.path();
            if !path.is_file() {
                let dname = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                if dname == "node_modules" || dname == "target" || dname == "dist" || dname == ".git" || dname == ".orbital" {
                    it.skip_current_dir();
                }
                continue;
            }
            // Skip symlinked files — targets may live outside the workspace
            if entry.file_type().is_symlink() {
                continue;
            }

            let fname = path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default();
            if fname.starts_with('.') || fname == "package-lock.json" || fname == "Cargo.lock" {
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
                    // Skip symlinks — targets may escape the workspace
                    if entry.file_type().map(|t| t.is_symlink()).unwrap_or(false) {
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

    /// Workspace statistics for the Overview panel: language breakdown,
    /// file counts by type, total size, and the largest files.
    pub fn get_workspace_stats(&self) -> Result<serde_json::Value, String> {
        let root = self.root.as_ref().ok_or("No workspace open")?;
        let mut by_ext: std::collections::HashMap<String, (u64, u64)> = std::collections::HashMap::new(); // ext -> (count, bytes)
        let mut total_files = 0u64;
        let mut total_bytes = 0u64;
        let mut largest: Vec<(String, u64)> = Vec::new();
        let mut git_remote = String::new();

        let mut it = WalkDir::new(root).into_iter();
        while let Some(entry) = it.next().map(|e| e.ok()).flatten() {
            let path = entry.path();
            if !path.is_file() {
                let dname = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                if dname == ".git" || dname == "node_modules" || dname == "target" || dname == "dist" {
                    it.skip_current_dir();
                }
                continue;
            }
            if entry.file_type().is_symlink() { continue; }
            total_files += 1;
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            total_bytes += size;

            let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "(none)".into());
            let slot = by_ext.entry(ext.clone()).or_insert((0, 0));
            slot.0 += 1;
            slot.1 += size;
            if size > 200 * 1024 {
                largest.push((path.to_string_lossy().replace('\\', "/"), size));
            }
        }

        largest.sort_by_key(|(_, b)| std::cmp::Reverse(*b));
        let largest_top: Vec<serde_json::Value> = largest.into_iter().take(5)
            .map(|(p, b)| serde_json::json!({ "path": p, "bytes": b })).collect();

        let mut by_language: Vec<serde_json::Value> = by_ext.iter()
            .map(|(ext, (count, bytes))| serde_json::json!({ "ext": ext, "files": count, "bytes": bytes }))
            .collect();
        by_language.sort_by_key(|v| std::cmp::Reverse(v.get("bytes").and_then(|b| b.as_u64()).unwrap_or(0)));

        // Git remote URL (best effort)
        if let Ok(cfg) = std::fs::read_to_string(root.join(".git").join("config")) {
            for line in cfg.lines() {
                let t = line.trim();
                if t.starts_with("url = ") {
                    git_remote = t.trim_start_matches("url = ").to_string();
                    break;
                }
            }
        }

        Ok(serde_json::json!({
            "root": root.to_string_lossy().replace('\\', "/"),
            "total_files": total_files,
            "total_bytes": total_bytes,
            "by_extension": by_language.into_iter().take(12).collect::<Vec<_>>(),
            "largest_files": largest_top,
            "git_remote": git_remote,
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

        // Legitimate absolute path with forward slashes
        let abs_fwd = format!("{}/src/lib.rs", cur.to_string_lossy().replace('\\', "/"));
        assert!(ws.resolve_and_validate(&abs_fwd).is_ok());

        // Verbatim prefix with forward slashes
        let verbatim_fwd = format!("//?/{}/src/lib.rs", cur.to_string_lossy().replace('\\', "/"));
        assert!(ws.resolve_and_validate(&verbatim_fwd).is_ok());

        // Verbatim prefix with backslashes
        let verbatim_back = format!(r"\\?\{}\src\lib.rs", cur.to_string_lossy());
        assert!(ws.resolve_and_validate(&verbatim_back).is_ok());

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

    #[test]
    fn test_new_file_under_symlinked_parent_blocked() {
        // A not-yet-existing target under a symlinked directory must be
        // rejected: the string form stays inside the root, but the write
        // would land outside via the link.
        let tmp = std::env::temp_dir().join(format!("orbital_ws_test_{}", std::process::id()));
        let ws_dir = tmp.join("workspace");
        let outside_dir = tmp.join("outside");
        let _ = fs::create_dir_all(&ws_dir);
        let _ = fs::create_dir_all(&outside_dir);
        // Marker file proving an escape would reach outside content
        let _ = fs::write(outside_dir.join("secret.txt"), "secret");

        let link = ws_dir.join("link");
        let link_created = create_dir_link(&link, &outside_dir);
        if !link_created {
            // Junction/symlink creation requires privileges in some
            // environments — skip honestly rather than fake a pass.
            let _ = fs::remove_dir_all(&tmp);
            eprintln!("SKIPPED: could not create directory link (insufficient privileges)");
            return;
        }

        let mut ws = WorkspaceService::new();
        ws.set_root(&ws_dir.to_string_lossy()).unwrap();

        // Existing path through the link must be blocked
        let existing = ws.resolve_and_validate("link/secret.txt");
        assert!(existing.is_err(), "existing file through symlink must be blocked");

        // NEW path under the symlinked parent must also be blocked
        let new_file = ws.resolve_and_validate("link/escaped.txt");
        assert!(new_file.is_err(), "new file under symlinked parent must be blocked");
        assert!(new_file.unwrap_err().contains("Symlink or filesystem redirection"));

        // Sibling new file (no symlink involved) still works
        assert!(ws.resolve_and_validate("normal/new.txt").is_ok());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_undo_rejected_outside_current_workspace() {
        let tmp = std::env::temp_dir().join(format!("orbital_undo_test_{}", std::process::id()));
        let ws_a = tmp.join("ws_a");
        let ws_b = tmp.join("ws_b");
        let _ = fs::create_dir_all(&ws_a);
        let _ = fs::create_dir_all(&ws_b);

        let mut ws = WorkspaceService::new();
        ws.set_root(&ws_a.to_string_lossy()).unwrap();
        ws.write_file("tracked.txt", "v1", "test").unwrap();
        assert!(ws.undo_last_change().is_ok());
        ws.write_file("tracked.txt", "v2", "test").unwrap();

        // Switch workspace: the journaled path now points outside ws_b
        ws.set_root(&ws_b.to_string_lossy()).unwrap();
        let undo_result = ws.undo_last_change();
        assert!(undo_result.is_err());
        assert!(undo_result.unwrap_err().contains("outside the current workspace boundary"));

        let _ = fs::remove_dir_all(&tmp);
    }

    fn create_dir_link(link: &Path, target: &Path) -> bool {
        #[cfg(target_os = "windows")]
        {
            // Junctions (mklink /J) do not require administrator privileges
            let out = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .output();
            matches!(out, Ok(o) if o.status.success())
        }
        #[cfg(not(target_os = "windows"))]
        {
            std::os::unix::fs::symlink(target, link).is_ok()
        }
    }
}
