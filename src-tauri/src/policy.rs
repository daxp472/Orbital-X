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
                    | "read_file_lines" | "get_project_map" | "search_context"
                    | "search_project_memory" | "git_status" | "git_diff" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: false,
                            risk: ToolRisk::Low,
                            reason: "Autonomous read/search in Agent Pro Mode".into(),
                        }
                    }
                    // File writes, patches, directory ops are autonomous
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
                    // Diagnostics and safe commands are autonomous
                    "get_diagnostics" | "run_tests" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: false,
                            risk: ToolRisk::Low,
                            reason: "Diagnostic/test command autonomous in Pro Mode".into(),
                        }
                    }
                    "run_command" | "run_build" | "run_linter" => {
                        // Low risk commands like test/build/lint can run automatically
                        let is_safe_script = target.starts_with("cargo")
                            || target.starts_with("npm test")
                            || target.starts_with("npm run")
                            || target.starts_with("npx")
                            || target.starts_with("node ")
                            || target.starts_with("pytest")
                            || target.starts_with("git status")
                            || target.starts_with("git diff")
                            || target.starts_with("git log")
                            || target.starts_with("mkdir")
                            || target.starts_with("echo");
                        if is_safe_script {
                            PolicyDecision {
                                allowed: true,
                                requires_approval: false,
                                risk: ToolRisk::Low,
                                reason: "Allowed build/test command in Agent Pro Mode".into(),
                            }
                        } else {
                            PolicyDecision {
                                allowed: true,
                                requires_approval: true,
                                risk: ToolRisk::Medium,
                                reason: "Unknown command requires verification in Agent Pro Mode".into(),
                            }
                        }
                    }
                    // Destructive / high-impact ops require approval even in Pro Mode
                    "delete_file" | "git_commit" | "git_push" | "delete_path" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: true,
                            risk: ToolRisk::High,
                            reason: "High impact operation requires approval even in Pro Mode".into(),
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
                    // Reads and searches are automatic in Dev Mode
                    "workspace_info" | "list_files" | "search_files" | "read_file"
                    | "read_file_lines" | "get_project_map" | "search_context"
                    | "search_project_memory" | "git_status" | "git_diff" | "git_log"
                    | "get_diagnostics" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: false,
                            risk: ToolRisk::Low,
                            reason: "Read-only inspection permitted in Dev Mode".into(),
                        }
                    }
                    // File edits require approval card
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
                    "run_command" | "run_tests" | "run_build" | "run_linter"
                    | "git_commit" | "git_push" | "delete_file" | "delete_path" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: true,
                            risk: ToolRisk::High,
                            reason: "Command execution and state-changing actions require approval in Dev Mode".into(),
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
                    // In User Mode: workspace_info is always free
                    "workspace_info" => PolicyDecision {
                        allowed: true,
                        requires_approval: false,
                        risk: ToolRisk::Low,
                        reason: "Workspace info is always readable".into(),
                    },
                    // Reads need confirmation
                    "list_files" | "search_files" | "read_file" | "read_file_lines"
                    | "search_project_memory" | "git_status" | "git_diff" | "get_diagnostics" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: true,
                            risk: ToolRisk::Low,
                            reason: "User Mode requires approval before reading workspace files".into(),
                        }
                    }
                    // File edits require confirmation
                    "write_file" | "patch_file" | "create_file" | "apply_patch"
                    | "create_directory" | "rename_file" | "delete_file" | "delete_path" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: true,
                            risk: ToolRisk::Medium,
                            reason: "User Mode requires approval before modifying files".into(),
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

        let dec_commit = PolicyEngine::evaluate(AgentMode::AgentPro, "git_commit", "commit", false);
        assert!(dec_commit.allowed);
        assert!(dec_commit.requires_approval);
    }

    #[test]
    fn test_dev_mode_permissions() {
        let dec_read = PolicyEngine::evaluate(AgentMode::Dev, "read_file", "src/main.rs", false);
        assert!(dec_read.allowed);
        assert!(!dec_read.requires_approval);

        let dec_write = PolicyEngine::evaluate(AgentMode::Dev, "write_file", "src/main.rs", false);
        assert!(dec_write.allowed);
        assert!(dec_write.requires_approval); // Dev mode asks approval for edits!

        let dec_cmd = PolicyEngine::evaluate(AgentMode::Dev, "run_command", "npm install", false);
        assert!(dec_cmd.allowed);
        assert!(dec_cmd.requires_approval); // Dev mode asks approval for commands!
    }

    #[test]
    fn test_user_mode_permissions() {
        let dec_read = PolicyEngine::evaluate(AgentMode::User, "read_file", "src/main.rs", false);
        assert!(dec_read.allowed);
        assert!(dec_read.requires_approval); // User mode asks approval even for reads!

        let dec_write = PolicyEngine::evaluate(AgentMode::User, "write_file", "src/main.rs", false);
        assert!(dec_write.allowed);
        assert!(dec_write.requires_approval);
    }

    #[test]
    fn test_destructive_action_blocked() {
        let dec = PolicyEngine::evaluate(AgentMode::AgentPro, "delete_path", "C:/Windows", true);
        assert!(!dec.allowed);
        assert_eq!(dec.risk, ToolRisk::Critical);
    }
}
