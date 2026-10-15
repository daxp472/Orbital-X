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
                    // In Pro Mode, reading, searching, and workspace file editing/patching are autonomous
                    "workspace_info" | "list_files" | "search_files" | "read_file" | "read_file_range"
                    | "get_project_map" | "search_context" | "search_project_memory" | "get_diff" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: false,
                            risk: ToolRisk::Low,
                            reason: "Autonomous read/search in Agent Pro Mode".into(),
                        }
                    }
                    "create_file" | "write_file" | "apply_patch" | "undo_agent_change"
                    | "save_project_memory" | "delete_project_memory" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: false,
                            risk: ToolRisk::Medium,
                            reason: "Autonomous workspace edit in Agent Pro Mode".into(),
                        }
                    }
                    "run_command" | "run_tests" | "run_build" | "run_linter" => {
                        // Low risk commands like test/build/lint can run automatically if inside workspace
                        let is_safe_script = target.starts_with("cargo test")
                            || target.starts_with("cargo check")
                            || target.starts_with("npm test")
                            || target.starts_with("npm run build")
                            || target.starts_with("node ")
                            || target.starts_with("pytest")
                            || target.starts_with("git status")
                            || target.starts_with("git diff");
                        if is_safe_script {
                            PolicyDecision {
                                allowed: true,
                                requires_approval: false,
                                risk: ToolRisk::Low,
                                reason: "Allowed validation command in Agent Pro Mode".into(),
                            }
                        } else {
                            PolicyDecision {
                                allowed: true,
                                requires_approval: true,
                                risk: ToolRisk::Medium,
                                reason: "Unrecognized command in Agent Pro Mode requires verification".into(),
                            }
                        }
                    }
                    "git_push" | "git_commit" | "delete_path" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: true,
                            risk: ToolRisk::High,
                            reason: "High impact operations require approval even in Pro Mode".into(),
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
                    // In Dev Mode: reads and searches are automatic
                    "workspace_info" | "list_files" | "search_files" | "read_file" | "read_file_range"
                    | "get_project_map" | "search_context" | "search_project_memory" | "get_diff"
                    | "git_status" | "git_diff" | "git_log" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: false,
                            risk: ToolRisk::Low,
                            reason: "Read-only inspection permitted in Dev Mode".into(),
                        }
                    }
                    // File creation and edits show diff and require approval card unless pre-approved
                    "create_file" | "write_file" | "apply_patch" | "undo_agent_change" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: true,
                            risk: ToolRisk::Medium,
                            reason: "File modifications require user approval in Dev Mode".into(),
                        }
                    }
                    // Commands, deletions and commits require approval
                    "run_command" | "run_tests" | "run_build" | "run_linter" | "git_commit" | "git_push" | "delete_path" => {
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
                    // In User Mode: EVERY action requires explicit confirmation
                    "workspace_info" => PolicyDecision {
                        allowed: true,
                        requires_approval: false,
                        risk: ToolRisk::Low,
                        reason: "Workspace info inspectable".into(),
                    },
                    "list_files" | "search_files" | "read_file" | "read_file_range" => {
                        PolicyDecision {
                            allowed: true,
                            requires_approval: true,
                            risk: ToolRisk::Low,
                            reason: "User Mode requires approval before reading workspace files".into(),
                        }
                    }
                    "create_file" | "write_file" | "apply_patch" | "delete_path" => {
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
