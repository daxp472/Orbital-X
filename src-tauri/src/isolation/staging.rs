use super::validator::{ChangeValidator, StagedMutation, ValidationReport};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug)]
pub struct EphemeralStagingManager {
    session_id: String,
    staging_root: PathBuf,
    host_workspace: PathBuf,
    staged_mutations: HashMap<PathBuf, StagedMutation>,
    deleted_paths: HashSet<PathBuf>,
}

impl EphemeralStagingManager {
    /// Creates a new ephemeral staging workspace backed by an OS temp directory.
    pub fn new(host_workspace: PathBuf) -> Result<Self, String> {
        let session_id = format!("stage_{}", Uuid::new_v4());
        let staging_root = std::env::temp_dir().join("orbital_x_staging").join(&session_id);

        fs::create_dir_all(&staging_root).map_err(|e| {
            format!(
                "Failed to initialize staging directory at '{}': {}",
                staging_root.display(),
                e
            )
        })?;

        Ok(Self {
            session_id,
            staging_root,
            host_workspace,
            staged_mutations: HashMap::new(),
            deleted_paths: HashSet::new(),
        })
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn staging_root(&self) -> &Path {
        &self.staging_root
    }

    pub fn staged_count(&self) -> usize {
        self.staged_mutations.len()
    }

    pub fn staged_mutations(&self) -> &HashMap<PathBuf, StagedMutation> {
        &self.staged_mutations
    }

    /// Stages a file write operation without touching host disk blocks.
    pub fn stage_write(&mut self, rel_path: &Path, content: &[u8]) -> Result<(), String> {
        let norm_rel = normalize_relative_path(rel_path);
        let target_staged_path = self.staging_root.join(&norm_rel);

        if let Some(parent) = target_staged_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create staging parent directory: {}", e))?;
        }

        fs::write(&target_staged_path, content)
            .map_err(|e| format!("Failed to write to staging file '{}': {}", target_staged_path.display(), e))?;

        self.deleted_paths.remove(&norm_rel);
        self.staged_mutations.insert(
            norm_rel.clone(),
            StagedMutation {
                relative_path: norm_rel,
                content: Some(content.to_vec()),
                is_deletion: false,
            },
        );

        Ok(())
    }

    /// Stages a file deletion operation.
    pub fn stage_deletion(&mut self, rel_path: &Path) -> Result<(), String> {
        let norm_rel = normalize_relative_path(rel_path);
        let target_staged_path = self.staging_root.join(&norm_rel);

        if target_staged_path.exists() {
            let _ = fs::remove_file(&target_staged_path);
        }

        self.deleted_paths.insert(norm_rel.clone());
        self.staged_mutations.insert(
            norm_rel.clone(),
            StagedMutation {
                relative_path: norm_rel,
                content: None,
                is_deletion: true,
            },
        );

        Ok(())
    }

    /// Reads a file, querying the staging layer first, then falling back to host workspace.
    pub fn read_file(&self, rel_path: &Path) -> Result<Vec<u8>, String> {
        let norm_rel = normalize_relative_path(rel_path);

        if self.deleted_paths.contains(&norm_rel) {
            return Err(format!("File '{}' is marked as deleted in this isolated staging session", norm_rel.display()));
        }

        let staged = self.staging_root.join(&norm_rel);
        if staged.exists() && staged.is_file() {
            return fs::read(&staged).map_err(|e| format!("Failed reading staged file: {}", e));
        }

        let host = self.host_workspace.join(&norm_rel);
        if host.exists() && host.is_file() {
            return fs::read(&host).map_err(|e| format!("Failed reading host file: {}", e));
        }

        Err(format!("File not found in staging or host workspace: '{}'", norm_rel.display()))
    }

    /// Collects all pending mutations currently staged.
    pub fn collect_mutations(&self) -> Vec<StagedMutation> {
        self.staged_mutations.values().cloned().collect()
    }

    /// Validates all staged mutations using the safety validator.
    pub fn validate(&self, validator: &ChangeValidator) -> ValidationReport {
        let mutations = self.collect_mutations();
        validator.validate_mutations(&self.host_workspace, &mutations)
    }

    /// Synchronizes all verified staged mutations back to the physical host workspace.
    pub fn sync_to_host(&mut self, validator: &ChangeValidator) -> Result<ValidationReport, String> {
        let report = self.validate(validator);
        if !report.is_valid {
            return Err(format!(
                "Validation check failed with {} violation(s): {:?}",
                report.violations.len(),
                report.violations
            ));
        }

        for mutation in self.staged_mutations.values() {
            let host_target = self.host_workspace.join(&mutation.relative_path);

            if mutation.is_deletion {
                if host_target.exists() {
                    fs::remove_file(&host_target)
                        .map_err(|e| format!("Failed to delete host file '{}': {}", host_target.display(), e))?;
                }
            } else if let Some(bytes) = &mutation.content {
                if let Some(parent) = host_target.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed creating host parent directory: {}", e))?;
                }
                fs::write(&host_target, bytes)
                    .map_err(|e| format!("Failed writing host file '{}': {}", host_target.display(), e))?;
            }
        }

        // Clear mutations upon successful sync
        self.staged_mutations.clear();
        self.deleted_paths.clear();

        Ok(report)
    }

    /// Discards all staged changes and recursively deletes the temporary staging directory.
    pub fn cleanup(&mut self) -> Result<(), String> {
        self.staged_mutations.clear();
        self.deleted_paths.clear();

        if self.staging_root.exists() {
            fs::remove_dir_all(&self.staging_root)
                .map_err(|e| format!("Failed cleaning up staging directory: {}", e))?;
        }

        Ok(())
    }
}

impl Drop for EphemeralStagingManager {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

fn normalize_relative_path(path: &Path) -> PathBuf {
    let mut norm = PathBuf::new();
    for comp in path.components() {
        match comp {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                norm.pop();
            }
            std::path::Component::Normal(c) => norm.push(c),
            _ => {}
        }
    }
    norm
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ephemeral_staging_write_read_and_sync() {
        let temp_dir = std::env::temp_dir().join(format!("orbital_test_host_{}", Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).unwrap();

        let mut manager = EphemeralStagingManager::new(temp_dir.clone()).unwrap();

        let rel_file = Path::new("src/test.txt");
        manager.stage_write(rel_file, b"Hello sandboxed world!").unwrap();

        // Staged read
        let content = manager.read_file(rel_file).unwrap();
        assert_eq!(content, b"Hello sandboxed world!");

        // Host not yet modified before sync
        assert!(!temp_dir.join(rel_file).exists());

        // Validate and sync
        let validator = ChangeValidator::new();
        let report = manager.sync_to_host(&validator).unwrap();
        assert!(report.is_valid);

        // Host now modified
        assert!(temp_dir.join(rel_file).exists());
        let host_content = fs::read(temp_dir.join(rel_file)).unwrap();
        assert_eq!(host_content, b"Hello sandboxed world!");

        let _ = fs::remove_dir_all(&temp_dir);
    }
}

