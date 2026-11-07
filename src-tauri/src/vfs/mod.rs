pub mod diff_bridge;
pub mod overlay;
pub mod service;
pub mod transaction;
pub mod types;

pub use diff_bridge::VfsDiffBridge;
pub use overlay::VfsOverlay;
pub use service::VfsEngine;
pub use transaction::VfsTransactionManager;
pub use types::{
    VfsCheckpoint, VfsCommitSummary, VfsDiffHunk, VfsDiffStatus, VfsFileDiff, VfsFileEntry,
};

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!("orbital_vfs_test_{}_{}", name, uuid::Uuid::new_v4().simple()));
            let _ = fs::create_dir_all(&path);
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[tokio::test]
    async fn test_vfs_overlay_cow_isolation() {
        let test_dir = TestDir::new("cow");
        let initial_file = test_dir.path.join("hello.rs");
        fs::write(&initial_file, "fn main() { println!(\"original\"); }").unwrap();

        let engine = VfsEngine::new(test_dir.path.clone());

        // Read baseline
        let read1 = engine.read_file(&PathBuf::from("hello.rs")).await.unwrap();
        assert!(read1.contains("original"));

        // Write shadow update
        engine
            .write_file(&PathBuf::from("hello.rs"), "fn main() { println!(\"modified\"); }")
            .await
            .unwrap();

        // Reading via VFS returns modified content
        let read2 = engine.read_file(&PathBuf::from("hello.rs")).await.unwrap();
        assert!(read2.contains("modified"));

        // Physical disk is untouched!
        let disk_content = fs::read_to_string(&initial_file).unwrap();
        assert!(disk_content.contains("original"));
        assert!(!disk_content.contains("modified"));
    }

    #[tokio::test]
    async fn test_vfs_unified_diff_generation() {
        let test_dir = TestDir::new("diff");
        let file = test_dir.path.join("app.js");
        fs::write(&file, "const a = 1;\nconst b = 2;\n").unwrap();

        let engine = VfsEngine::new(test_dir.path.clone());
        engine
            .write_file(&PathBuf::from("app.js"), "const a = 1;\nconst b = 99;\nconst c = 3;\n")
            .await
            .unwrap();

        let diffs = engine.get_all_diffs().await;
        assert_eq!(diffs.len(), 1);
        let diff = &diffs[0];
        assert_eq!(diff.status, VfsDiffStatus::Modified);
        assert!(diff.unified_patch.contains("--- a/app.js"));
        assert!(diff.unified_patch.contains("+++ b/app.js"));
        assert!(diff.unified_patch.contains("-const b = 2;"));
        assert!(diff.unified_patch.contains("+const b = 99;"));
        assert!(diff.unified_patch.contains("+const c = 3;"));
    }

    #[tokio::test]
    async fn test_vfs_checkpoint_and_rollback() {
        let test_dir = TestDir::new("checkpoint");
        let file = test_dir.path.join("state.txt");
        fs::write(&file, "version 1").unwrap();

        let engine = VfsEngine::new(test_dir.path.clone());

        // Update to v2
        engine.write_file(&PathBuf::from("state.txt"), "version 2").await.unwrap();
        let ckpt = engine.create_checkpoint("Saved version 2").await;

        // Update to broken v3
        engine.write_file(&PathBuf::from("state.txt"), "broken v3").await.unwrap();
        assert_eq!(engine.read_file(&PathBuf::from("state.txt")).await.unwrap(), "broken v3");

        // Roll back to checkpoint
        engine.rollback_checkpoint(&ckpt.id).await.unwrap();
        assert_eq!(engine.read_file(&PathBuf::from("state.txt")).await.unwrap(), "version 2");
    }

    #[tokio::test]
    async fn test_vfs_atomic_commit_with_backup() {
        let test_dir = TestDir::new("commit");
        let file = test_dir.path.join("deploy.sh");
        fs::write(&file, "#!/bin/bash\necho v1\n").unwrap();

        let engine = VfsEngine::new(test_dir.path.clone());

        engine.write_file(&PathBuf::from("deploy.sh"), "#!/bin/bash\necho v2\n").await.unwrap();
        engine.write_file(&PathBuf::from("new_file.txt"), "brand new!").await.unwrap();

        let summary = engine.commit_transaction().await.unwrap();
        assert_eq!(summary.committed_files, vec!["deploy.sh"]);
        assert_eq!(summary.created_files, vec!["new_file.txt"]);
        assert!(summary.backup_dir.is_some());

        // Verify disk files were updated
        assert_eq!(fs::read_to_string(&file).unwrap(), "#!/bin/bash\necho v2\n");
        assert_eq!(
            fs::read_to_string(test_dir.path.join("new_file.txt")).unwrap(),
            "brand new!"
        );

        // Verify backup preserved v1
        let backup_dir = PathBuf::from(summary.backup_dir.unwrap());
        let backup_file = backup_dir.join("deploy.sh");
        assert!(backup_file.is_file());
        assert_eq!(fs::read_to_string(backup_file).unwrap(), "#!/bin/bash\necho v1\n");
    }

    #[tokio::test]
    async fn test_vfs_path_escape_blocked() {
        let test_dir = TestDir::new("escape");
        let engine = VfsEngine::new(test_dir.path.clone());

        let res = engine.write_file(&PathBuf::from("../../evil.txt"), "bad").await;
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("escape violation"));
    }
}

