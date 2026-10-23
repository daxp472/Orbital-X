use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentMode {
    AgentPro,
    Dev,
    User,
}

impl Default for AgentMode {
    fn default() -> Self {
        AgentMode::Dev
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolRisk {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyDecision {
    pub allowed: bool,
    pub requires_approval: bool,
    pub risk: ToolRisk,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandClassification {
    Safe,
    ApprovalRequired(String),
    Prohibited(String),
}

pub struct CommandClassifier;

impl CommandClassifier {
    /// Inspects and classifies shell commands based on security risk.
    /// Blocks dangerous operations, requires approval for destructive actions, and permits safe tools.
    pub fn classify(cmd: &str) -> CommandClassification {
        let trimmed = cmd.trim();
        let lower = trimmed.to_lowercase();

        // 1. Prohibited: system destruction, formatting, partition manipulation, administrative elevation
        let prohibited_patterns = [
            "format ",
            "diskpart",
            "bcdedit",
            "bootrec",
            "vssadmin",
            "rmdir /s /q c:",
            "del /f /s /q c:",
            "del /s /q c:",
            "rd /s /q c:",
            "rm -rf /",
            "rm -rf /*",
            "rm -rf ~",
            "rm -rf c:",
            "rm -rf d:",
            "del *.*",
            "del /s /q *",
            "del /f /q /s *",
            "remove-item * -recurse -force",
            "remove-item -recurse -force c:",
            "remove-item -recurse -force /",
            "rd /s /q \\",
            "runas ",
            "takeown ",
            "icacls ",
            "net user ",
            "net localgroup ",
            "sudo ",
            "doas ",
            "reg delete ",
            "reg add ",
            "reg restore ",
            "shutdown ",
            "stop-computer",
            "restart-computer",
            "-enc ",
            "-encodedcommand ",
            "frombase64string",
            "set-executionpolicy bypass",
            "set-executionpolicy unrestricted",
        ];

        for pattern in &prohibited_patterns {
            if lower.contains(pattern) {
                return CommandClassification::Prohibited(format!("Command contains prohibited pattern '{}'", pattern));
            }
        }

        // Piped remote executions
        if (lower.contains("curl") || lower.contains("wget") || lower.contains("iwr"))
            && (lower.contains("| sh") || lower.contains("| bash") || lower.contains("| iex")) {
            return CommandClassification::Prohibited("Remote script download and memory execution is strictly prohibited".into());
        }

        // 2. Destructive deletions require approval across all modes
        let destructive_delete_keywords = ["rm ", "del ", "rmdir ", "rd ", "remove-item "];
        for d in &destructive_delete_keywords {
            if lower.starts_with(d) || lower.contains(&format!("; {}", d)) || lower.contains(&format!("&& {}", d)) || lower.contains(&format!("| {}", d)) {
                return CommandClassification::ApprovalRequired("Command performs file or directory deletion".into());
            }
        }

        // Git destructive operations
        if lower.starts_with("git push") || lower.starts_with("git reset") || lower.starts_with("git clean") || lower.starts_with("git checkout --") {
            return CommandClassification::ApprovalRequired("Git repository mutation requires confirmation".into());
        }

        // 3. Check for Safe developer tools
        let sub_commands: Vec<&str> = trimmed.split(&[';', '&', '|'][..]).map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
        if sub_commands.is_empty() {
            return CommandClassification::Safe;
        }

        let is_subcmd_safe = |sub: &str| -> bool {
            let s = sub.to_lowercase();
            s.starts_with("cargo ")
                || s == "cargo"
                || s.starts_with("npm ")
                || s == "npm"
                || s.starts_with("npx ")
                || s == "npx"
                || s.starts_with("node ")
                || s == "node"
                || s.starts_with("deno ")
                || s.starts_with("bun ")
                || s.starts_with("pnpm ")
                || s.starts_with("yarn ")
                || s.starts_with("python ")
                || s.starts_with("python3 ")
                || s.starts_with("py ")
                || s.starts_with("pytest")
                || s.starts_with("pip ")
                || s.starts_with("git status")
                || s.starts_with("git diff")
                || s.starts_with("git log")
                || s.starts_with("git branch")
                || s.starts_with("git show")
                || s.starts_with("git rev-parse")
                || s.starts_with("dir")
                || s.starts_with("ls")
                || s.starts_with("pwd")
                || s.starts_with("echo ")
                || s.starts_with("cat ")
                || s.starts_with("type ")
                || s.starts_with("mkdir ")
                || s.starts_with("cd ")
                || s.starts_with("tsc")
                || s.starts_with("eslint")
                || s.starts_with("go ")
        };

        if sub_commands.iter().all(|sub| is_subcmd_safe(sub)) {
            CommandClassification::Safe
        } else {
            CommandClassification::ApprovalRequired("Unclassified shell command requires approval".into())
        }
    }
}

pub struct PolicyEngine;

impl PolicyEngine {
    /// Evaluates whether a tool execution requires explicit user approval under the current mode.
    pub fn evaluate(
        mode: AgentMode,
        tool_name: &str,
        target: &str,
        is_elevated_or_destructive: bool,
    ) -> PolicyDecision {
        // Critical safety boundary: elevated/destructive operations outside workspace or destructive commands
        if is_elevated_or_destructive {
            return PolicyDecision {
                allowed: false,
                requires_approval: false,
                risk: ToolRisk::Critical,
                reason: "Operation blocked: Destructive or elevated action violates safety constraints.".into(),
            };
        }

        match mode {
            AgentMode::AgentPro => {
                match tool_name {
                    // Reads and searches are fully autonomous in Pro Mode
                    "workspace_info" | "list_files" | "search_files" | "read_file"
                    | "read_file_lines" | "read_multiple_files" | "find_symbol"
                    | "get_project_structure" | "get_project_map" | "search_context"
                    | "search_project_memory" | "git_status" | "git_diff"
                    | "update_task_status" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: false,
                            risk: ToolRisk::Low,
                            reason: "Autonomous read/search/task update in Agent Pro Mode".into(),
                        }
                    }
                    // File writes, patches, directory creation are autonomous in Pro Mode
                    "write_file" | "patch_file" | "create_file" | "apply_patch"
                    | "undo_agent_change" | "save_project_memory" | "delete_project_memory"
                    | "create_directory" | "rename_file" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: false,
                            risk: ToolRisk::Medium,
                            reason: "Autonomous workspace edit in Agent Pro Mode".into(),
                        }
                    }
                    // Diagnostics and safe validation tools
                    "get_diagnostics" | "validate_changes" | "run_tests" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: false,
                            risk: ToolRisk::Low,
                            reason: "Diagnostic/test command autonomous in Pro Mode".into(),
                        }
                    }
                    // Command execution: classified by CommandClassifier
                    "run_command" | "run_build" | "run_linter" => {
                        let class = CommandClassifier::classify(target);
                        match class {
                            CommandClassification::Safe => PolicyDecision {
                                allowed: true,
                                requires_approval: false,
                                risk: ToolRisk::Low,
                                reason: "Allowed build/dev command in Agent Pro Mode".into(),
                            },
                            CommandClassification::ApprovalRequired(reason) => PolicyDecision {
                                allowed: true,
                                requires_approval: true,
                                risk: ToolRisk::Medium,
                                reason: format!("Command requires approval in Agent Pro Mode: {}", reason),
                            },
                            CommandClassification::Prohibited(reason) => PolicyDecision {
                                allowed: false,
                                requires_approval: false,
                                risk: ToolRisk::Critical,
                                reason: format!("Execution Blocked: {}", reason),
                            },
                        }
                    }
                    // Destructive file/directory deletions ALWAYS require explicit approval, even in Pro Mode!
                    "delete_file" | "delete_directory" | "delete_folder" | "batch_delete_files"
                    | "git_commit" | "git_push" | "delete_path" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: true,
                            risk: ToolRisk::High,
                            reason: "High impact destructive deletion or git change requires explicit user approval".into(),
                        }
                    }
                    _ => PolicyDecision {
                        allowed: true,
                        requires_approval: false,
                        risk: ToolRisk::Low,
                        reason: "Allowed in Pro Mode".into(),
                    },
                }
            }

            AgentMode::Dev => {
                match tool_name {
                    // Reads, searches, and task status updates are automatic in Dev Mode
                    "workspace_info" | "list_files" | "search_files" | "read_file"
                    | "read_file_lines" | "read_multiple_files" | "find_symbol"
                    | "get_project_structure" | "get_project_map" | "search_context"
                    | "search_project_memory" | "git_status" | "git_diff" | "git_log"
                    | "get_diagnostics" | "validate_changes" | "update_task_status" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: false,
                            risk: ToolRisk::Low,
                            reason: "Read-only inspection permitted in Dev Mode".into(),
                        }
                    }
                    // File edits require approval card in Dev Mode
                    "write_file" | "patch_file" | "create_file" | "apply_patch"
                    | "undo_agent_change" | "rename_file" | "create_directory" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: true,
                            risk: ToolRisk::Medium,
                            reason: "File modifications require user approval in Dev Mode".into(),
                        }
                    }
                    // Commands, deletions, and git commits require approval
                    "run_command" | "run_tests" | "run_build" | "run_linter" => {
                        let class = CommandClassifier::classify(target);
                        match class {
                            CommandClassification::Prohibited(reason) => PolicyDecision {
                                allowed: false,
                                requires_approval: false,
                                risk: ToolRisk::Critical,
                                reason: format!("Execution Blocked: {}", reason),
                            },
                            _ => PolicyDecision {
                                allowed: true,
                                requires_approval: true,
                                risk: ToolRisk::High,
                                reason: "Command execution requires user approval in Dev Mode".into(),
                            },
                        }
                    }
                    "delete_file" | "delete_directory" | "delete_folder" | "batch_delete_files"
                    | "git_commit" | "git_push" | "delete_path" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: true,
                            risk: ToolRisk::High,
                            reason: "Destructive deletion or git action requires user approval in Dev Mode".into(),
                        }
                    }
                    _ => PolicyDecision {
                        allowed: true,
                        requires_approval: true,
                        risk: ToolRisk::Medium,
                        reason: "Action requires confirmation in Dev Mode".into(),
                    },
                }
            }

            AgentMode::User => {
                match tool_name {
                    // In User Mode: workspace_info and update_task_status are readable
                    "workspace_info" | "update_task_status" => PolicyDecision {
                        allowed: true,
                        requires_approval: false,
                        risk: ToolRisk::Low,
                        reason: "Workspace info and task tracking are readable".into(),
                    },
                    // Reads need confirmation
                    "list_files" | "search_files" | "read_file" | "read_file_lines"
                    | "read_multiple_files" | "find_symbol" | "get_project_structure"
                    | "search_project_memory" | "git_status" | "git_diff"
                    | "get_diagnostics" | "validate_changes" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: true,
                            risk: ToolRisk::Low,
                            reason: "User Mode requires approval before reading workspace files".into(),
                        }
                    }
                    // File edits and deletions require confirmation
                    "write_file" | "patch_file" | "create_file" | "apply_patch"
                    | "create_directory" | "rename_file" | "delete_file" | "delete_directory"
                    | "delete_folder" | "batch_delete_files" | "delete_path" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: true,
                            risk: ToolRisk::Medium,
                            reason: "User Mode requires approval before modifying or deleting files".into(),
                        }
                    }
                    // Commands
                    "run_command" | "run_tests" | "run_build" | "run_linter" => {
                        let class = CommandClassifier::classify(target);
                        match class {
                            CommandClassification::Prohibited(reason) => PolicyDecision {
                                allowed: false,
                                requires_approval: false,
                                risk: ToolRisk::Critical,
                                reason: format!("Execution Blocked: {}", reason),
                            },
                            _ => PolicyDecision {
                                allowed: true,
                                requires_approval: true,
                                risk: ToolRisk::High,
                                reason: "User Mode requires approval before executing any tool".into(),
                            },
                        }
                    }
                    _ => PolicyDecision {
                        allowed: true,
                        requires_approval: true,
                        risk: ToolRisk::High,
                        reason: "User Mode requires approval before executing any tool".into(),
                    },
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pro_mode_permissions() {
        let dec_read = PolicyEngine::evaluate(AgentMode::AgentPro, "read_file", "src/main.rs", false);
        assert!(dec_read.allowed);
        assert!(!dec_read.requires_approval);

        let dec_write = PolicyEngine::evaluate(AgentMode::AgentPro, "write_file", "src/main.rs", false);
        assert!(dec_write.allowed);
        assert!(!dec_write.requires_approval);

        let dec_safe_cmd = PolicyEngine::evaluate(AgentMode::AgentPro, "run_command", "cargo test", false);
        assert!(dec_safe_cmd.allowed);
        assert!(!dec_safe_cmd.requires_approval);

        let dec_npm_install = PolicyEngine::evaluate(AgentMode::AgentPro, "run_command", "npm install react", false);
        assert!(dec_npm_install.allowed);
        assert!(!dec_npm_install.requires_approval);

        // Deletion must ALWAYS require approval even in Pro Mode!
        let dec_del_dir = PolicyEngine::evaluate(AgentMode::AgentPro, "delete_directory", "src/legacy", false);
        assert!(dec_del_dir.allowed);
        assert!(dec_del_dir.requires_approval);

        let dec_batch_del = PolicyEngine::evaluate(AgentMode::AgentPro, "batch_delete_files", "src/legacy", false);
        assert!(dec_batch_del.allowed);
        assert!(dec_batch_del.requires_approval);

        // Prohibited commands blocked in Pro Mode!
        let dec_format = PolicyEngine::evaluate(AgentMode::AgentPro, "run_command", "format C:", false);
        assert!(!dec_format.allowed);
        assert_eq!(dec_format.risk, ToolRisk::Critical);
    }

    #[test]
    fn test_dev_mode_permissions() {
        let dec_read = PolicyEngine::evaluate(AgentMode::Dev, "read_file", "src/main.rs", false);
        assert!(dec_read.allowed);
        assert!(!dec_read.requires_approval);

        let dec_write = PolicyEngine::evaluate(AgentMode::Dev, "write_file", "src/main.rs", false);
        assert!(dec_write.allowed);
        assert!(dec_write.requires_approval);

        let dec_cmd = PolicyEngine::evaluate(AgentMode::Dev, "run_command", "npm install", false);
        assert!(dec_cmd.allowed);
        assert!(dec_cmd.requires_approval);
    }

    #[test]
    fn test_user_mode_permissions() {
        let dec_read = PolicyEngine::evaluate(AgentMode::User, "read_file", "src/main.rs", false);
        assert!(dec_read.allowed);
        assert!(dec_read.requires_approval);

        let dec_write = PolicyEngine::evaluate(AgentMode::User, "write_file", "src/main.rs", false);
        assert!(dec_write.allowed);
        assert!(dec_write.requires_approval);
    }

    #[test]
    fn test_destructive_action_blocked() {
        let dec = PolicyEngine::evaluate(AgentMode::AgentPro, "delete_path", "C:/Windows", true);
        assert!(!dec.allowed);
        assert_eq!(dec.risk, ToolRisk::Critical);

        let dec_wipe = PolicyEngine::evaluate(AgentMode::AgentPro, "run_command", "rm -rf /", false);
        assert!(!dec_wipe.allowed);
        assert_eq!(dec_wipe.risk, ToolRisk::Critical);
    }
}
