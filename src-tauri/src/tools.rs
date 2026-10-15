pub fn get_available_tool_schemas() -> serde_json::Value {
    serde_json::json!([
        {
            "type": "function",
            "function": {
                "name": "workspace_info",
                "description": "Get metadata about the current workspace, including root path, total files, and detected programming languages.",
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
                "description": "List files and subdirectories under the workspace root, respecting ignore boundaries.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "max_depth": {
                            "type": "integer",
                            "description": "Maximum tree depth to traverse (default 3)"
                        }
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read the contents of a file in the workspace.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative or workspace-bounded path of the file to read"
                        }
                    },
                    "required": ["path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "write_file",
                "description": "Create or overwrite a file with new content. Shows a unified diff before applying according to active mode policy.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative path of the file to write"
                        },
                        "content": {
                            "type": "string",
                            "description": "Complete new content for the file"
                        },
                        "description": {
                            "type": "string",
                            "description": "Concise summary of why this edit is being made"
                        }
                    },
                    "required": ["path", "content", "description"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_files",
                "description": "Search workspace files for a text string or symbol name across filenames and file contents.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query or symbol name"
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum number of matches to return (default 20)"
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
                "description": "Execute a terminal command inside the workspace directory with timeout and output capture.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "Terminal command to run"
                        },
                        "timeout_seconds": {
                            "type": "integer",
                            "description": "Maximum execution time in seconds (default 30)"
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
                "description": "Automatically detect and run tests (e.g., cargo test, npm test, pytest) and capture output.",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "save_project_memory",
                "description": "Persist or update key architectural decisions, tech stack details, conventions, or rules in project memory. Automatically updates existing entries if the category and title match. Call this whenever you discover or establish key workspace knowledge.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "category": {
                            "type": "string",
                            "description": "Category (architecture, convention, rule, toolchain)"
                        },
                        "title": {
                            "type": "string",
                            "description": "Short concise title (e.g. 'Project Structure Overview', 'Build Command')"
                        },
                        "content": {
                            "type": "string",
                            "description": "Concise summary of the architectural fact or rule"
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
                "description": "Search persistent project memory for rules, architectural decisions, and saved instructions.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search keyword"
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
                "description": "Undo the most recent agent file modification, reverting the file to its previous state.",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            }
        }
    ])
}
