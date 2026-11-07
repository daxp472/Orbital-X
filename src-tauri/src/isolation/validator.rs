use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ViolationSeverity {
    Warning,
    Blocked,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationViolation {
    pub file_path: String,
    pub rule_id: String,
    pub message: String,
    pub severity: ViolationSeverity,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationReport {
    pub is_valid: bool,
    pub total_staged_files: usize,
    pub total_bytes_changed: u64,
    pub violations: Vec<ValidationViolation>,
}

#[derive(Debug, Clone)]
pub struct ChangeValidator {
    max_file_size_bytes: u64,
    max_batch_size_bytes: u64,
    max_files_in_batch: usize,
    blocked_extensions: HashSet<String>,
    blocked_subpaths: Vec<String>,
}

impl Default for ChangeValidator {
    fn default() -> Self {
        let mut blocked_extensions = HashSet::new();
        for ext in [
            "exe", "dll", "sys", "scr", "pif", "vbs", "com", "msi", "bat", "cmd", "ps1",
        ] {
            blocked_extensions.insert(ext.to_string());
        }

        let blocked_subpaths = vec![
            ".git/hooks".into(),
            ".git/config".into(),
            ".ssh".into(),
            ".aws".into(),
            ".azure".into(),
            ".kube".into(),
            ".docker".into(),
            "/etc/".into(),
            "/usr/".into(),
            "/var/".into(),
            "windows/system32".into(),
            "c:/windows".into(),
            "c:\\windows".into(),
        ];

        Self {
            max_file_size_bytes: 50 * 1024 * 1024, // 50 MB
            max_batch_size_bytes: 250 * 1024 * 1024, // 250 MB
            max_files_in_batch: 500,
            blocked_extensions,
            blocked_subpaths,
        }
    }
}

#[derive(Debug, Clone)]
pub struct StagedMutation {
    pub relative_path: PathBuf,
    pub content: Option<Vec<u8>>,
    pub is_deletion: bool,
}

impl ChangeValidator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Allows custom scripting extensions if explicitly requested by project mode.
    pub fn allow_script_extensions(&mut self) {
        self.blocked_extensions.remove("bat");
        self.blocked_extensions.remove("cmd");
        self.blocked_extensions.remove("ps1");
    }

    /// Validates a batch of staged mutations before they are synced into the host workspace.
    pub fn validate_mutations(
        &self,
        workspace_root: &Path,
        mutations: &[StagedMutation],
    ) -> ValidationReport {
        let mut violations = Vec::new();
        let mut total_bytes: u64 = 0;

        if mutations.len() > self.max_files_in_batch {
            violations.push(ValidationViolation {
                file_path: "(batch)".into(),
                rule_id: "BATCH_FILE_COUNT_EXCEEDED".into(),
                message: format!(
                    "Batch contains {} files, exceeding safe threshold of {}",
                    mutations.len(),
                    self.max_files_in_batch
                ),
                severity: ViolationSeverity::Critical,
            });
        }

        let canonical_root = crate::workspace::strip_verbatim_prefix(
            &workspace_root.canonicalize().unwrap_or_else(|_| workspace_root.to_path_buf())
        );

        for mut_entry in mutations {
            let rel = &mut_entry.relative_path;
            let rel_str = rel.to_string_lossy().replace('\\', "/");

            // 1. Path traversal check (prevent escape above workspace root)
            let joined = workspace_root.join(rel);
            let raw_normalized = match joined.canonicalize() {
                Ok(p) => p,
                Err(_) => {
                    // Path may not exist yet if it is a new file; normalize syntactically relative to canonical_root
                    let mut norm = canonical_root.clone();
                    for comp in rel.components() {
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
                }
            };

            let normalized_path = crate::workspace::strip_verbatim_prefix(&raw_normalized);

            if !normalized_path.starts_with(&canonical_root) {
                violations.push(ValidationViolation {
                    file_path: rel_str.clone(),
                    rule_id: "WORKSPACE_ESCAPE_ATTEMPT".into(),
                    message: format!("Target path '{}' escapes workspace root boundary", rel_str),
                    severity: ViolationSeverity::Critical,
                });
            }

            // 2. Sensitive directory/file subpath protection
            let lower_str = rel_str.to_ascii_lowercase();
            for blocked in &self.blocked_subpaths {
                if lower_str.contains(blocked) {
                    violations.push(ValidationViolation {
                        file_path: rel_str.clone(),
                        rule_id: "PROTECTED_SYSTEM_PATH".into(),
                        message: format!("Modification to protected target '{}' is strictly denied", blocked),
                        severity: ViolationSeverity::Critical,
                    });
                }
            }

            // 3. Dangerous executable extensions
            if let Some(ext) = rel.extension().and_then(|s| s.to_str()) {
                let ext_lower = ext.to_ascii_lowercase();
                if self.blocked_extensions.contains(&ext_lower) {
                    violations.push(ValidationViolation {
                        file_path: rel_str.clone(),
                        rule_id: "FORBIDDEN_EXECUTABLE_EXTENSION".into(),
                        message: format!("Writing executable binaries (.{}) is prohibited inside the sandbox", ext),
                        severity: ViolationSeverity::Blocked,
                    });
                }
            }

            // 4. File size limit
            if let Some(bytes) = &mut_entry.content {
                let sz = bytes.len() as u64;
                total_bytes += sz;

                if sz > self.max_file_size_bytes {
                    violations.push(ValidationViolation {
                        file_path: rel_str.clone(),
                        rule_id: "MAX_FILE_SIZE_EXCEEDED".into(),
                        message: format!("File size ({} MB) exceeds single file safety limit ({} MB)", sz / 1024 / 1024, self.max_file_size_bytes / 1024 / 1024),
                        severity: ViolationSeverity::Blocked,
                    });
                }
            }
        }

        if total_bytes > self.max_batch_size_bytes {
            violations.push(ValidationViolation {
                file_path: "(batch)".into(),
                rule_id: "MAX_BATCH_SIZE_EXCEEDED".into(),
                message: format!("Total changed size ({} MB) exceeds safety threshold", total_bytes / 1024 / 1024),
                severity: ViolationSeverity::Critical,
            });
        }

        let is_valid = !violations.iter().any(|v| v.severity != ViolationSeverity::Warning);

        ValidationReport {
            is_valid,
            total_staged_files: mutations.len(),
            total_bytes_changed: total_bytes,
            violations,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validator_blocks_git_hooks_and_ssh() {
        let validator = ChangeValidator::new();
        let ws = Path::new("D:/fake/workspace");

        let mutations = vec![
            StagedMutation {
                relative_path: PathBuf::from(".git/hooks/pre-commit"),
                content: Some(b"#!/bin/sh\nrm -rf /".to_vec()),
                is_deletion: false,
            },
            StagedMutation {
                relative_path: PathBuf::from(".ssh/authorized_keys"),
                content: Some(b"ssh-rsa AAAA...".to_vec()),
                is_deletion: false,
            },
        ];

        let report = validator.validate_mutations(ws, &mutations);
        assert!(!report.is_valid);
        assert_eq!(report.violations.len(), 2);
    }

    #[test]
    fn test_validator_blocks_binary_payloads() {
        let validator = ChangeValidator::new();
        let ws = Path::new("D:/fake/workspace");

        let mutations = vec![StagedMutation {
            relative_path: PathBuf::from("bin/backdoor.exe"),
            content: Some(b"MZ...".to_vec()),
            is_deletion: false,
        }];

        let report = validator.validate_mutations(ws, &mutations);
        assert!(!report.is_valid);
        assert!(report.violations.iter().any(|v| v.rule_id == "FORBIDDEN_EXECUTABLE_EXTENSION"));
    }

    #[test]
    fn test_validator_permits_standard_code_mutations() {
        let validator = ChangeValidator::new();
        let ws = Path::new("D:/fake/workspace");

        let mutations = vec![
            StagedMutation {
                relative_path: PathBuf::from("src/main.rs"),
                content: Some(b"fn main() { println!(\"Safe!\"); }".to_vec()),
                is_deletion: false,
            },
            StagedMutation {
                relative_path: PathBuf::from("package.json"),
                content: Some(b"{\"name\": \"safe-pkg\"}".to_vec()),
                is_deletion: false,
            },
        ];

        let report = validator.validate_mutations(ws, &mutations);
        assert!(report.is_valid);
        assert!(report.violations.is_empty());
    }
}

