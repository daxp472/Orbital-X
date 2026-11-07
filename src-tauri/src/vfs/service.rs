use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::vfs::overlay::VfsOverlay;
use crate::vfs::transaction::VfsTransactionManager;
use crate::vfs::types::{VfsCheckpoint, VfsCommitSummary, VfsFileDiff};

/// Thread-safe Virtual File System Engine managing agent shadow mutations,
/// real-time diff calculations, and transactional atomic disk commits.
#[derive(Clone)]
pub struct VfsEngine {
    overlay: Arc<RwLock<VfsOverlay>>,
    tx_mgr: Arc<RwLock<VfsTransactionManager>>,
}

impl VfsEngine {
    pub fn new(root_path: PathBuf) -> Self {
        Self {
            overlay: Arc::new(RwLock::new(VfsOverlay::new(root_path))),
            tx_mgr: Arc::new(RwLock::new(VfsTransactionManager::new())),
        }
    }

    /// Reads file content (UTF-8) through the VFS shadow layer.
    pub async fn read_file(&self, path: &Path) -> Result<String, String> {
        let mut overlay = self.overlay.write().await;
        let bytes = overlay.read(path)?;
        String::from_utf8(bytes).map_err(|e| format!("VFS file is not valid UTF-8: {}", e))
    }

    /// Writes file content into shadow memory without mutating physical disk.
    pub async fn write_file(&self, path: &Path, content: &str) -> Result<(), String> {
        let mut overlay = self.overlay.write().await;
        overlay.write(path, content.as_bytes().to_vec())
    }

    /// Marks a file deleted in shadow memory.
    pub async fn delete_file(&self, path: &Path) -> Result<(), String> {
        let mut overlay = self.overlay.write().await;
        overlay.delete(path)
    }

    /// Computes unified diffs for all currently dirty shadow files against their disk baselines.
    pub async fn get_all_diffs(&self) -> Vec<VfsFileDiff> {
        let overlay = self.overlay.read().await;
        let tx = self.tx_mgr.read().await;
        tx.compute_all_diffs(&overlay)
    }

    /// Creates an in-memory checkpoint snapshot.
    pub async fn create_checkpoint(&self, description: &str) -> VfsCheckpoint {
        let overlay = self.overlay.read().await;
        let mut tx = self.tx_mgr.write().await;
        tx.create_checkpoint(&overlay, description)
    }

    /// Rolls back uncommitted changes to a previously saved checkpoint.
    pub async fn rollback_checkpoint(&self, checkpoint_id: &str) -> Result<(), String> {
        let mut overlay = self.overlay.write().await;
        let mut tx = self.tx_mgr.write().await;
        tx.rollback_to_checkpoint(&mut overlay, checkpoint_id)
    }

    /// Atomically commits all staged in-memory mutations to physical disk.
    pub async fn commit_transaction(&self) -> Result<VfsCommitSummary, String> {
        let mut overlay = self.overlay.write().await;
        let mut tx = self.tx_mgr.write().await;
        tx.commit_atomic(&mut overlay)
    }

    /// Discards all uncommitted changes in the shadow layer.
    pub async fn discard_changes(&self) {
        let mut overlay = self.overlay.write().await;
        overlay.discard_all();
    }

    /// Returns the number of files currently modified in the shadow layer.
    pub async fn dirty_count(&self) -> usize {
        let overlay = self.overlay.read().await;
        overlay.get_dirty_entries().len()
    }
}

