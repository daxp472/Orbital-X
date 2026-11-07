use crate::vfs::types::{VfsDiffHunk, VfsDiffStatus, VfsFileDiff, VfsFileEntry};

/// Computes high-speed unified diffs and Monaco-friendly hunk ranges.
pub struct VfsDiffBridge;

impl VfsDiffBridge {
    /// Generates structured diff for a single file entry in the shadow layer.
    pub fn compute_file_diff(rel_path: &str, entry: &VfsFileEntry) -> VfsFileDiff {
        if !entry.is_dirty {
            return VfsFileDiff {
                path: rel_path.to_string(),
                status: VfsDiffStatus::Unchanged,
                additions: 0,
                deletions: 0,
                hunks: Vec::new(),
                unified_patch: String::new(),
            };
        }

        if entry.is_deleted {
            let old_str = entry
                .baseline_content
                .as_ref()
                .map(|b| String::from_utf8_lossy(b).to_string())
                .unwrap_or_default();
            let old_lines: Vec<&str> = old_str.lines().collect();
            let count = old_lines.len();

            let mut patch_lines = vec![
                format!("--- a/{}", rel_path),
                "+++ /dev/null".to_string(),
                format!("@@ -1,{} +0,0 @@", count),
            ];
            for l in &old_lines {
                patch_lines.push(format!("-{}", l));
            }

            return VfsFileDiff {
                path: rel_path.to_string(),
                status: VfsDiffStatus::Deleted,
                additions: 0,
                deletions: count,
                hunks: vec![VfsDiffHunk {
                    old_start: 1,
                    old_lines: count,
                    new_start: 0,
                    new_lines: 0,
                    header: format!("@@ -1,{} +0,0 @@", count),
                    lines: patch_lines.iter().skip(2).cloned().collect(),
                }],
                unified_patch: patch_lines.join("\n"),
            };
        }

        if entry.baseline_content.is_none() {
            // Newly created file
            let new_str = String::from_utf8_lossy(&entry.content).to_string();
            let new_lines: Vec<&str> = new_str.lines().collect();
            let count = new_lines.len();

            let mut patch_lines = vec![
                "--- /dev/null".to_string(),
                format!("+++ b/{}", rel_path),
                format!("@@ -0,0 +1,{} @@", count),
            ];
            for l in &new_lines {
                patch_lines.push(format!("+{}", l));
            }

            return VfsFileDiff {
                path: rel_path.to_string(),
                status: VfsDiffStatus::Created,
                additions: count,
                deletions: 0,
                hunks: vec![VfsDiffHunk {
                    old_start: 0,
                    old_lines: 0,
                    new_start: 1,
                    new_lines: count,
                    header: format!("@@ -0,0 +1,{} @@", count),
                    lines: patch_lines.iter().skip(2).cloned().collect(),
                }],
                unified_patch: patch_lines.join("\n"),
            };
        }

        // Modified file: line-by-line diff
        let old_text = String::from_utf8_lossy(entry.baseline_content.as_ref().unwrap()).to_string();
        let new_text = String::from_utf8_lossy(&entry.content).to_string();

        let old_lines: Vec<&str> = old_text.lines().collect();
        let new_lines: Vec<&str> = new_text.lines().collect();

        Self::compute_line_diff(rel_path, &old_lines, &new_lines)
    }

    fn compute_line_diff(path: &str, old_lines: &[&str], new_lines: &[&str]) -> VfsFileDiff {
        let mut hunks = Vec::new();
        let mut additions = 0;
        let mut deletions = 0;

        let mut old_idx = 0;
        let mut new_idx = 0;

        let mut hunk_lines = Vec::new();
        let mut hunk_old_start = 1;
        let mut hunk_new_start = 1;
        let mut hunk_old_count = 0;
        let mut hunk_new_count = 0;

        while old_idx < old_lines.len() || new_idx < new_lines.len() {
            if old_idx < old_lines.len() && new_idx < new_lines.len() && old_lines[old_idx] == new_lines[new_idx] {
                // Line matches
                if !hunk_lines.is_empty() {
                    // Include trailing context (up to 3 lines)
                    hunk_lines.push(format!(" {}", old_lines[old_idx]));
                    hunk_old_count += 1;
                    hunk_new_count += 1;

                    let header = format!(
                        "@@ -{},{} +{},{} @@",
                        hunk_old_start, hunk_old_count, hunk_new_start, hunk_new_count
                    );
                    hunks.push(VfsDiffHunk {
                        old_start: hunk_old_start,
                        old_lines: hunk_old_count,
                        new_start: hunk_new_start,
                        new_lines: hunk_new_count,
                        header,
                        lines: hunk_lines.clone(),
                    });
                    hunk_lines.clear();
                    hunk_old_count = 0;
                    hunk_new_count = 0;
                }
                old_idx += 1;
                new_idx += 1;
            } else {
                if hunk_lines.is_empty() {
                    hunk_old_start = old_idx + 1;
                    hunk_new_start = new_idx + 1;
                    // Prepend up to 3 lines of leading context if available
                    let lead = if old_idx >= 3 { old_idx - 3 } else { 0 };
                    for k in lead..old_idx {
                        hunk_lines.push(format!(" {}", old_lines[k]));
                        hunk_old_count += 1;
                        hunk_new_count += 1;
                    }
                    if lead < old_idx {
                        hunk_old_start = lead + 1;
                        hunk_new_start = lead + 1;
                    }
                }

                if old_idx < old_lines.len() && (new_idx >= new_lines.len() || old_lines[old_idx] != new_lines[new_idx]) {
                    hunk_lines.push(format!("-{}", old_lines[old_idx]));
                    old_idx += 1;
                    hunk_old_count += 1;
                    deletions += 1;
                }
                if new_idx < new_lines.len() && (old_idx >= old_lines.len() || old_lines.get(old_idx) != new_lines.get(new_idx)) {
                    hunk_lines.push(format!("+{}", new_lines[new_idx]));
                    new_idx += 1;
                    hunk_new_count += 1;
                    additions += 1;
                }
            }
        }

        if !hunk_lines.is_empty() {
            let header = format!(
                "@@ -{},{} +{},{} @@",
                hunk_old_start, hunk_old_count, hunk_new_start, hunk_new_count
            );
            hunks.push(VfsDiffHunk {
                old_start: hunk_old_start,
                old_lines: hunk_old_count,
                new_start: hunk_new_start,
                new_lines: hunk_new_count,
                header,
                lines: hunk_lines,
            });
        }

        let mut unified = vec![
            format!("--- a/{}", path),
            format!("+++ b/{}", path),
        ];
        for h in &hunks {
            unified.push(h.header.clone());
            for l in &h.lines {
                unified.push(l.clone());
            }
        }

        VfsFileDiff {
            path: path.to_string(),
            status: VfsDiffStatus::Modified,
            additions,
            deletions,
            hunks,
            unified_patch: unified.join("\n"),
        }
    }
}
