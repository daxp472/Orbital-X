use std::collections::HashMap;
use std::path::{Path, PathBuf};
use crate::vfs::diff_bridge::VfsDiffBridge;
use crate::vfs::overlay::VfsOverlay;
use crate::vfs::types::{VfsCheckpoint, VfsCommitSummary, VfsFileDiff, VfsFileEntry};

pub struct VfsTransactionManager {
    checkpoints: Vec<(VfsCheckpoint, HashMap<String, VfsFileEntry>)>,
}

impl VfsTransactionManager {
    pub fn new() -> Self {
        Self {
            checkpoints: Vec::new(),
        }
    }

    /// Creates a named checkpoint snapshot of current dirty overlay state.
    pub fn create_checkpoint(&mut self, overlay: &VfsOverlay, description: &str) -> VfsCheckpoint {
        let id = format!("ckpt_{}", uuid::Uuid::new_v4().simple());
        let now = chrono::Utc::now().timestamp_millis();
        let dirty = overlay.get_dirty_entries();
        let dirty_files: Vec<String> = dirty.into_iter().map(|(p, _)| p).collect();

        let snapshot = overlay.raw_entries().clone();
        let checkpoint = VfsCheckpoint {
            id: id.clone(),
            timestamp: now,
            description: description.to_string(),
            dirty_files,
        };

        self.checkpoints.push((checkpoint.clone(), snapshot));
        checkpoint
    }

    /// Rolls back the overlay to the specified checkpoint ID, discarding later changes.
    pub fn rollback_to_checkpoint(&mut self, overlay: &mut VfsOverlay, checkpoint_id: &str) -> Result<(), String> {
        let pos = self
            .checkpoints
            .iter()
            .position(|(ckpt, _)| ckpt.id == checkpoint_id)
            .ok_or_else(|| format!("Checkpoint '{}' not found", checkpoint_id))?;

        let (_, snapshot) = &self.checkpoints[pos];
        overlay.restore_entries(snapshot.clone());
        self.checkpoints.truncate(pos + 1);
        Ok(())
    }

    /// Lists all active checkpoint snapshots.
    pub fn list_checkpoints(&self) -> Vec<VfsCheckpoint> {
        self.checkpoints.iter().map(|(ckpt, _)| ckpt.clone()).collect()
    }

    /// Discards all shadow changes and rolls back to clean disk baseline.
    pub fn rollback_all(&mut self, overlay: &mut VfsOverlay) {
        overlay.discard_all();
        self.checkpoints.clear();
    }

    /// Alias for commit_atomic.
    pub fn commit_all(&mut self, overlay: &mut VfsOverlay) -> Result<VfsCommitSummary, String> {
        self.commit_atomic(overlay)
    }

    /// Gathers diffs for all current dirty or deleted files against their disk baselines.
    pub fn compute_all_diffs(&self, overlay: &VfsOverlay) -> Vec<VfsFileDiff> {
        let dirty = overlay.get_dirty_entries();
        dirty
            .iter()
            .map(|(path, entry)| VfsDiffBridge::compute_file_diff(path, entry))
            .collect()
    }

    /// Atomically commits all dirty files to physical disk with automatic backup.
    pub fn commit_atomic(&mut self, overlay: &mut VfsOverlay) -> Result<VfsCommitSummary, String> {
        let dirty_entries = overlay.get_dirty_entries();
        if dirty_entries.is_empty() {
            return Ok(VfsCommitSummary {
                committed_files: Vec::new(),
                created_files: Vec::new(),
                deleted_files: Vec::new(),
                total_additions: 0,
                total_deletions: 0,
                backup_dir: None,
            });
        }

        let root = overlay.root_path().to_path_buf();
        let ts = chrono::Local::now().format("%Y%m%d_%H%M%S");
        let backup_dir = root.join(".orbital").join("vfs_backups").join(format!("backup_{}", ts));
        let mut backup_created = false;

        let mut committed = Vec::new();
        let mut created = Vec::new();
        let mut deleted = Vec::new();
        let mut total_add = 0;
        let mut total_del = 0;

        for (rel_path, entry) in dirty_entries {
            let target_disk_path = root.join(&rel_path);

            // Compute diff metrics for summary
            let diff = VfsDiffBridge::compute_file_diff(&rel_path, entry);
            total_add += diff.additions;
            total_del += diff.deletions;

            // Step 1: Backup existing file before overwriting/deleting
            if target_disk_path.is_file() {
                if !backup_created {
                    std::fs::create_dir_all(&backup_dir).map_err(|e| {
                        format!("Failed to create VFS backup directory: {}", e)
                    })?;
                    backup_created = true;
                }
                let backup_file = backup_dir.join(&rel_path);
                if let Some(parent) = backup_file.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let _ = std::fs::copy(&target_disk_path, &backup_file);
            }

            // Step 2: Write or Delete
            if entry.is_deleted {
                if target_disk_path.exists() {
                    std::fs::remove_file(&target_disk_path)
                        .map_err(|e| format!("Failed to delete file '{}': {}", rel_path, e))?;
                }
                deleted.push(rel_path.clone());
            } else {
                let is_new = !target_disk_path.exists();
                if let Some(parent) = target_disk_path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| {
                        format!("Failed to create parent directory for '{}': {}", rel_path, e)
                    })?;
                }

                // Write atomically via temporary file
                let tmp_file = parent_dir(&target_disk_path).join(format!(
                    ".orbital_tmp_{}_{}.tmp",
                    std::process::id(),
                    uuid::Uuid::new_v4().simple()
                ));

                std::fs::write(&tmp_file, &entry.content)
                    .map_err(|e| format!("Failed to write tmp file for '{}': {}", rel_path, e))?;

                // Atomic rename/replace
                if let Err(_err) = std::fs::rename(&tmp_file, &target_disk_path) {
                    // Windows fallback if target exists and atomic rename fails
                    #[cfg(windows)]
                    {
                        let _ = std::fs::remove_file(&target_disk_path);
                        if let Err(e2) = std::fs::rename(&tmp_file, &target_disk_path) {
                            let _ = std::fs::remove_file(&tmp_file);
                            return Err(format!("Atomic commit rename failed for '{}': {}", rel_path, e2));
                        }
                    }
                    #[cfg(not(windows))]
                    {
                        let _ = std::fs::remove_file(&tmp_file);
                        return Err(format!("Atomic commit rename failed for '{}': {}", rel_path, _err));
                    }
                }

                if is_new {
                    created.push(rel_path.clone());
                } else {
                    committed.push(rel_path.clone());
                }
            }
        }

        // Clear overlay after successful commit
        overlay.discard_all();
        self.checkpoints.clear();

        Ok(VfsCommitSummary {
            committed_files: committed,
            created_files: created,
            deleted_files: deleted,
            total_additions: total_add,
            total_deletions: total_del,
            backup_dir: if backup_created {
                Some(backup_dir.to_string_lossy().to_string())
            } else {
                None
            },
        })
    }
}

fn parent_dir(p: &Path) -> PathBuf {
    p.parent().unwrap_or_else(|| Path::new(".")).to_path_buf()
}
