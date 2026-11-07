use std::collections::HashMap;
use std::path::{Path, PathBuf};
use crate::vfs::types::VfsFileEntry;
use crate::workspace::strip_verbatim_prefix;

/// An in-memory shadow directory overlay mirroring the workspace filesystem.
/// Provides Copy-on-Write modifications so agent file edits never mutate disk
/// until explicitly committed.
#[derive(Debug, Clone)]
pub struct VfsOverlay {
    root_path: PathBuf,
    entries: HashMap<String, VfsFileEntry>,
}

impl VfsOverlay {
    pub fn new(root_path: PathBuf) -> Self {
        Self {
            root_path: strip_verbatim_prefix(&root_path),
            entries: HashMap::new(),
        }
    }

    /// Normalizes path relative to root, preventing workspace escape attempts.
    pub fn normalize_rel_path(&self, candidate: &Path) -> Result<String, String> {
        let abs = if candidate.is_absolute() {
            strip_verbatim_prefix(candidate)
        } else {
            let mut norm = self.root_path.clone();
            for comp in candidate.components() {
                match comp {
                    std::path::Component::ParentDir => {
                        norm.pop();
                    }
                    std::path::Component::CurDir => {}
                    std::path::Component::Normal(c) => norm.push(c),
                    _ => {}
                }
            }
            norm
        };

        let clean_abs = strip_verbatim_prefix(&abs);
        if !clean_abs.starts_with(&self.root_path) {
            return Err(format!("VFS path escape violation: '{}' outside root", candidate.display()));
        }

        let rel = match clean_abs.strip_prefix(&self.root_path) {
            Ok(p) => p.to_string_lossy().replace('\\', "/"),
            Err(_) => return Err("Failed to strip prefix from VFS path".to_string()),
        };

        let trimmed = rel.trim_start_matches('/').to_string();
        if trimmed.is_empty() {
            return Err("Cannot target workspace root itself as a file entry".to_string());
        }

        Ok(trimmed)
    }

    /// Reads file content from in-memory overlay if dirty/cached, or loads baseline from disk.
    pub fn read(&mut self, candidate: &Path) -> Result<Vec<u8>, String> {
        let rel_key = self.normalize_rel_path(candidate)?;

        if let Some(entry) = self.entries.get(&rel_key) {
            if entry.is_deleted {
                return Err(format!("File '{}' has been marked deleted in shadow VFS", rel_key));
            }
            return Ok(entry.content.clone());
        }

        // Lazy load baseline from physical disk
        let disk_path = self.root_path.join(&rel_key);
        if disk_path.is_file() {
            let bytes = std::fs::read(&disk_path)
                .map_err(|e| format!("Failed to read baseline file from disk '{}': {}", rel_key, e))?;
            self.entries.insert(
                rel_key.clone(),
                VfsFileEntry {
                    content: bytes.clone(),
                    is_dirty: false,
                    is_deleted: false,
                    baseline_content: Some(bytes.clone()),
                },
            );
            Ok(bytes)
        } else {
            Err(format!("File '{}' not found in workspace", rel_key))
        }
    }

    /// Writes content to shadow memory, marking entry as dirty without touching physical disk.
    pub fn write(&mut self, candidate: &Path, content: Vec<u8>) -> Result<(), String> {
        let rel_key = self.normalize_rel_path(candidate)?;

        let baseline = if let Some(existing) = self.entries.get(&rel_key) {
            existing.baseline_content.clone()
        } else {
            let disk_path = self.root_path.join(&rel_key);
            if disk_path.is_file() {
                std::fs::read(&disk_path).ok()
            } else {
                None
            }
        };

        let is_dirty = match &baseline {
            Some(base_bytes) => base_bytes != &content,
            None => true,
        };

        self.entries.insert(
            rel_key,
            VfsFileEntry {
                content,
                is_dirty,
                is_deleted: false,
                baseline_content: baseline,
            },
        );

        Ok(())
    }

    /// Marks a file as deleted in the shadow layer.
    pub fn delete(&mut self, candidate: &Path) -> Result<(), String> {
        let rel_key = self.normalize_rel_path(candidate)?;

        let baseline = if let Some(existing) = self.entries.get(&rel_key) {
            existing.baseline_content.clone()
        } else {
            let disk_path = self.root_path.join(&rel_key);
            if disk_path.is_file() {
                std::fs::read(&disk_path).ok()
            } else {
                None
            }
        };

        if baseline.is_none() && !self.entries.contains_key(&rel_key) {
            return Err(format!("Cannot delete non-existent file '{}'", rel_key));
        }

        self.entries.insert(
            rel_key,
            VfsFileEntry {
                content: Vec::new(),
                is_dirty: true,
                is_deleted: true,
                baseline_content: baseline,
            },
        );

        Ok(())
    }

    /// Returns all paths currently dirty or deleted in the shadow overlay.
    pub fn get_dirty_entries(&self) -> Vec<(String, &VfsFileEntry)> {
        self.entries
            .iter()
            .filter(|(_, entry)| entry.is_dirty)
            .map(|(k, v)| (k.clone(), v))
            .collect()
    }

    /// Discards all uncommitted in-memory shadow edits.
    pub fn discard_all(&mut self) {
        self.entries.clear();
    }

    /// Returns internal entries map reference for snapshots.
    pub fn raw_entries(&self) -> &HashMap<String, VfsFileEntry> {
        &self.entries
    }

    /// Restores entries map from a snapshot.
    pub fn restore_entries(&mut self, snapshot: HashMap<String, VfsFileEntry>) {
        self.entries = snapshot;
    }

    pub fn root_path(&self) -> &Path {
        &self.root_path
    }
}
