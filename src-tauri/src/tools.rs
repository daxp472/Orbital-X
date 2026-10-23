pub fn get_available_tool_schemas() -> serde_json::Value {
    serde_json::json!([
        {
            "type": "function",
            "function": {
                "name": "workspace_info",
                "description": "Get metadata about the current workspace: root path, total files, detected programming languages. Call this first when starting a new task to orient yourself.",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "list_files",
                "description": "List files and subdirectories as a tree from the workspace root. Use max_depth=2 for a quick overview, max_depth=4 for detailed exploration. Skips node_modules, target, .git.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "max_depth": {
                            "type": "integer",
                            "description": "Maximum tree depth to traverse (default 3, max 5)"
                        }
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read the FULL contents of a file. Use for small files (<300 lines). For larger files, prefer read_file_lines to read only the relevant section and save context.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative path from workspace root (e.g. src/main.rs)"
                        }
                    },
                    "required": ["path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "read_file_lines",
                "description": "Read a specific range of lines from a file (1-indexed, inclusive). Returns lines with line numbers. PREFER this over read_file for files >200 lines to avoid wasting context. Use search_files first to find the relevant line numbers.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative path from workspace root"
                        },
                        "start_line": {
                            "type": "integer",
                            "description": "First line to read (1-indexed)"
                        },
                        "end_line": {
                            "type": "integer",
                            "description": "Last line to read (1-indexed, inclusive)"
                        }
                    },
                    "required": ["path", "start_line", "end_line"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "write_file",
                "description": "Create a new file or completely overwrite an existing file with new content. Use for new files or when rewriting most of the content. For targeted edits to existing files, prefer patch_file instead.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative path from workspace root (creates parent dirs automatically)"
                        },
                        "content": {
                            "type": "string",
                            "description": "Complete new content for the file (full file, not a diff)"
                        },
                        "description": {
                            "type": "string",
                            "description": "Concise summary of why this file is being written (for the change journal)"
                        }
                    },
                    "required": ["path", "content", "description"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "patch_file",
                "description": "Edit a specific line range in an existing file WITHOUT rewriting the whole file. This is the preferred tool for modifying functions, fixing bugs, or updating specific sections in large files. Replaces lines [start_line..end_line] with new_content.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative path from workspace root"
                        },
                        "start_line": {
                            "type": "integer",
                            "description": "First line to replace (1-indexed)"
                        },
                        "end_line": {
                            "type": "integer",
                            "description": "Last line to replace (1-indexed, inclusive)"
                        },
                        "new_content": {
                            "type": "string",
                            "description": "Replacement content for the specified line range"
                        },
                        "description": {
                            "type": "string",
                            "description": "Brief explanation of what this patch does"
                        }
                    },
                    "required": ["path", "start_line", "end_line", "new_content", "description"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "delete_file",
                "description": "Permanently delete a file from the workspace. The deletion is journaled so it can be undone with undo_agent_change.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative path of the file to delete"
                        }
                    },
                    "required": ["path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "rename_file",
                "description": "Rename or move a file within the workspace. Creates destination parent directories as needed.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "from": {
                            "type": "string",
                            "description": "Current relative path of the file"
                        },
                        "to": {
                            "type": "string",
                            "description": "New relative path for the file"
                        }
                    },
                    "required": ["from", "to"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "create_directory",
                "description": "Create a directory (and all parent directories) in the workspace.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative path of the directory to create"
                        }
                    },
                    "required": ["path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_files",
                "description": "Search across all workspace files for a text pattern (symbol name, function, string, etc). Returns matches with file path, line number, and snippet. Use this to find where a function is defined, locate usages, or discover relevant files before editing.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Text or symbol name to search for"
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum number of results (default 20, max 50)"
                        }
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "run_command",
                "description": "Execute a shell command in the workspace directory. Use for: npm install, cargo build, git commands, mkdir, running scripts, starting dev servers, etc. Captures stdout and stderr. Increase timeout_seconds for long-running commands like npm install (use 120) or builds (use 90).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "Shell command to execute"
                        },
                        "timeout_seconds": {
                            "type": "integer",
                            "description": "Max execution time in seconds (default 60, use 120 for npm install, 90 for builds)"
                        }
                    },
                    "required": ["command"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "run_tests",
                "description": "Automatically detect and run the project test suite (cargo test, npm test, pytest) and capture output. Use to verify changes don't break existing functionality.",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_diagnostics",
                "description": "Run a quick diagnostic/lint check on the project to detect errors, warnings, and type issues. Detects the toolchain automatically (cargo check, tsc --noEmit, eslint, pylint). Use after making code changes to verify correctness before finishing.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "tool": {
                            "type": "string",
                            "description": "Optional: force a specific diagnostic tool (cargo_check, tsc, eslint, pylint). Leave empty to auto-detect."
                        }
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "git_status",
                "description": "Get the current git repository status: current branch, staged/unstaged changes, untracked files. Use to understand what has changed before committing.",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "git_commit",
                "description": "Stage ALL changed files and create a git commit with the provided message. Use after completing a feature or set of related changes.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "string",
                            "description": "Commit message following conventional commits format (e.g. 'feat: add user authentication')"
                        }
                    },
                    "required": ["message"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "git_diff",
                "description": "Get the unified diff of changes in the git working tree. Allows targeted inspection by file path, staged/unstaged changes, or stat summary, avoiding dumping massive diffs into context.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Optional: relative file path to diff a specific file only"
                        },
                        "staged": {
                            "type": "boolean",
                            "description": "If true, show staged changes (--cached); if false, show unstaged"
                        },
                        "stat_only": {
                            "type": "boolean",
                            "description": "If true, show only the diffstat summary instead of full line-by-line diff"
                        }
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "save_project_memory",
                "description": "Persist key project knowledge to long-term memory: architectural decisions, tech stack details, important conventions, build commands, important file locations. This persists across sessions. Call whenever you discover or establish important workspace knowledge.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "category": {
                            "type": "string",
                            "description": "Category: architecture, convention, rule, toolchain, or dependency"
                        },
                        "title": {
                            "type": "string",
                            "description": "Short descriptive title (e.g. 'Build Command', 'Database Schema Location')"
                        },
                        "content": {
                            "type": "string",
                            "description": "Concise content of the memory entry (keep under 200 chars)"
                        }
                    },
                    "required": ["category", "title", "content"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_project_memory",
                "description": "Search persistent project memory for saved rules, conventions, and architectural decisions.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Keyword to search memory entries"
                        }
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "undo_agent_change",
                "description": "Undo the most recent agent file modification (write, patch, or delete), restoring the previous state.",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "read_multiple_files",
                "description": "Read multiple workspace files in a single tool call (up to 10 files). Enforces workspace boundaries, provides line counts, and reports truncated files clearly. Use when you need context from several related modules at once.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "paths": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "List of relative file paths to read (max 10)"
                        },
                        "max_lines_per_file": {
                            "type": "integer",
                            "description": "Max lines to return per file (default 300, max 500)"
                        }
                    },
                    "required": ["paths"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "find_symbol",
                "description": "Code-aware navigation to locate definitions and references of a symbol (function, class, struct, type, const, or variable) across the workspace. Returns file path, line number, match kind ('definition' vs 'reference'), and surrounding context. Never fabricates symbols.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "symbol": {
                            "type": "string",
                            "description": "The exact symbol name to find"
                        },
                        "symbol_type": {
                            "type": "string",
                            "enum": ["definition", "reference", "all"],
                            "description": "Whether to search for definitions, references/usages, or both (default 'all')"
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum number of results to return (default 25, max 50)"
                        }
                    },
                    "required": ["symbol"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_project_structure",
                "description": "Return a compact, configurable workspace structural overview. Respects exclusions (.git, node_modules, target, dist), identifies key configuration files (package.json, Cargo.toml, tsconfig.json, etc.) and entry points, with bounded depth. Use for architecture recon.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "max_depth": {
                            "type": "integer",
                            "description": "Maximum directory depth to traverse (default 3, max 5)"
                        },
                        "include_files": {
                            "type": "boolean",
                            "description": "Whether to list individual files or only directory layout (default true)"
                        }
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "validate_changes",
                "description": "Focused validation of recent code changes using real toolchain checks (cargo check, node --check, tsc, eslint, etc.). Returns actual exit codes, compiler diagnostics, and errors without inventing results. Satisfies completion evidence requirements.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "files": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Optional: specific modified files to validate. If omitted, validates all recently changed files or project diagnostics."
                        },
                        "run_tests": {
                            "type": "boolean",
                            "description": "Optional: also execute the project's test suite to verify no regressions (default false)"
                        }
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_task_status",
                "description": "Update the execution state of a task in the active orchestration plan. Enforces that marking a task complete requires real completion evidence (test/diagnostic output or verified file state). Synchronizes task progress with the IDE UI.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "task_id": {
                            "type": "string",
                            "description": "The unique task identifier (e.g. 'task-1', 'phase-2')"
                        },
                        "status": {
                            "type": "string",
                            "enum": ["in_progress", "completed", "blocked", "failed", "skipped"],
                            "description": "The new status of the task"
                        },
                        "evidence": {
                            "type": "string",
                            "description": "MANDATORY when status='completed': the verifiable evidence that this task succeeded (diagnostic result, test output, or verified diff)."
                        },
                        "notes": {
                            "type": "string",
                            "description": "Optional: brief note on what was accomplished or why the task is blocked/failed."
                        }
                    },
                    "required": ["task_id", "status"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "delete_file",
                "description": "Delete a single regular file from the workspace. Strictly prevents deleting the workspace root or directories. Journals the deletion for safety.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Workspace-relative file path to delete"
                        }
                    },
                    "required": ["path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "delete_directory",
                "description": "Safely delete a directory and its contents within the workspace. Strictly prohibits deleting the workspace root or parent directories. Requires explicit user approval.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Workspace-relative directory path to delete"
                        },
                        "recursive": {
                            "type": "boolean",
                            "description": "Set to true to delete non-empty directory and its contents"
                        }
                    },
                    "required": ["path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "batch_delete_files",
                "description": "Propose and execute deletion of multiple files within the workspace in a verified two-stage workflow. Generates a preview manifest for user confirmation, then re-validates targets immediately before deletion. Does not accept directories.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "paths": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "List of workspace-relative file paths to delete"
                        }
                    },
                    "required": ["paths"]
                }
            }
        }
    ])
}
