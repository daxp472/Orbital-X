use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum VfsDiffStatus {
    Modified,
    Created,
    Deleted,
    Unchanged,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VfsDiffHunk {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub header: String,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VfsFileDiff {
    pub path: String,
    pub status: VfsDiffStatus,
    pub additions: usize,
    pub deletions: usize,
    pub hunks: Vec<VfsDiffHunk>,
    pub unified_patch: String,
    pub original_content: Option<String>,
    pub shadow_content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VfsStatus {
    pub is_active: bool,
    pub dirty_count: usize,
    pub checkpoint_count: usize,
    pub dirty_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VfsCheckpoint {
    pub id: String,
    pub timestamp: i64,
    pub description: String,
    pub dirty_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VfsCommitSummary {
    pub committed_files: Vec<String>,
    pub created_files: Vec<String>,
    pub deleted_files: Vec<String>,
    pub total_additions: usize,
    pub total_deletions: usize,
    pub backup_dir: Option<String>,
}

#[derive(Debug, Clone)]
pub struct VfsFileEntry {
    pub content: Vec<u8>,
    pub is_dirty: bool,
    pub is_deleted: bool,
    pub baseline_content: Option<Vec<u8>>,
}
