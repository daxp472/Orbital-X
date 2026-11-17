use super::graph::SemanticCodeGraph;
use super::parser::SourceParserDispatcher;
use super::types::{EdgeKind, GraphEdge};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

pub struct GraphIndexer;

impl GraphIndexer {
    /// Performs a fast, zero-freeze scan of `workspace_root`, parsing source files while enforcing
    /// hardcoded large repo guardrails (.gitignore, common huge dirs, 500KB per-file cap, max 2500 files).
    pub fn build_workspace_graph(workspace_root: &Path) -> SemanticCodeGraph {
        let mut graph = SemanticCodeGraph::new();
        let mut pending_calls: Vec<(String, Vec<(String, String)>)> = Vec::new();

        // 1. Load patterns from .gitignore if present in workspace root
        let mut gitignore_patterns: Vec<String> = Vec::new();
        let gitignore_path = workspace_root.join(".gitignore");
        if let Ok(content) = fs::read_to_string(&gitignore_path) {
            for line in content.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() && !trimmed.starts_with('#') {
                    gitignore_patterns.push(trimmed.trim_start_matches('/').to_string());
                }
            }
        }

        let max_files = 2500;
        let mut indexed_count = 0;

        let walker = WalkDir::new(workspace_root)
            .follow_links(false)
            .max_depth(14)
            .into_iter()
            .filter_entry(|entry| {
                let name = entry.file_name().to_string_lossy();
                if name.starts_with('.') && name != ".github" {
                    return false;
                }
                let name_lower = name.to_ascii_lowercase();
                // Fast prune of common massive directories
                if matches!(
                    name_lower.as_str(),
                    "node_modules"
                        | "target"
                        | "dist"
                        | "build"
                        | "out"
                        | ".git"
                        | ".orbital"
                        | ".next"
                        | ".nuxt"
                        | "vendor"
                        | "__pycache__"
                        | ".venv"
                        | "venv"
                        | "env"
                        | ".cache"
                        | "coverage"
                        | "bin"
                        | "obj"
                        | "pkg"
                        | ".turbo"
                        | ".husky"
                ) {
                    return false;
                }
                true
            });

        for entry in walker.filter_map(|e| e.ok()) {
            if indexed_count >= max_files {
                break;
            }

            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            // Guardrail: Cap AST indexing at files under 500 KB to guarantee zero freeze on large repos
            if let Ok(meta) = entry.metadata() {
                if meta.len() > 500 * 1024 {
                    continue;
                }
            } else {
                continue;
            }

            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
            if !matches!(ext.as_str(), "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "c" | "cpp" | "h" | "hpp" | "java" | "cs") {
                continue;
            }

            // Relative path for canonical symbol keys
            let rel_path = path.strip_prefix(workspace_root).unwrap_or(path).to_string_lossy().replace('\\', "/");

            // Filter out custom gitignore patterns
            let is_ignored = gitignore_patterns.iter().any(|pattern| {
                let p = pattern.trim_end_matches('/');
                rel_path == p || rel_path.starts_with(&format!("{}/", p)) || rel_path.contains(&format!("/{}/", p)) || rel_path.ends_with(&format!("/{}", p))
            });
            if is_ignored {
                continue;
            }

            if let Ok(content) = fs::read_to_string(path) {
                let (symbols, calls) = SourceParserDispatcher::parse_source(&rel_path, &content);
                for sym in symbols {
                    graph.add_node(sym);
                }
                if !calls.is_empty() {
                    pending_calls.push((rel_path, calls));
                }
                indexed_count += 1;
            }
        }

        // Second pass: Cross-reference and link caller -> callee edges
        for (file, calls) in pending_calls {
            for (caller_qual_or_name, callee_name) in calls {
                // Find caller node
                let caller_id = graph
                    .find_symbols_by_name(&caller_qual_or_name)
                    .into_iter()
                    .find(|c| c.file_path == file)
                    .map(|c| c.id.clone());

                if let Some(cid) = caller_id {
                    let callee_ids: Vec<String> = graph
                        .find_symbols_by_name(&callee_name)
                        .into_iter()
                        .map(|c| c.id.clone())
                        .collect();

                    for tid in callee_ids {
                        graph.add_edge(GraphEdge {
                            source_id: cid.clone(),
                            target_id: tid,
                            kind: EdgeKind::Calls,
                            weight: 1.0,
                        });
                    }
                }
            }
        }

        graph
    }

    /// Incrementally updates a single file in the graph without re-scanning the entire workspace.
    pub fn update_file(graph: &mut SemanticCodeGraph, workspace_root: &Path, rel_path: &str) {
        graph.remove_file(rel_path);

        let full_path = workspace_root.join(rel_path);
        if !full_path.exists() || !full_path.is_file() {
            return;
        }

        // Cap AST indexing at files under 500 KB
        if let Ok(meta) = full_path.metadata() {
            if meta.len() > 500 * 1024 {
                return;
            }
        }

        if let Ok(content) = fs::read_to_string(&full_path) {
            let (symbols, calls) = SourceParserDispatcher::parse_source(rel_path, &content);
            for sym in symbols {
                graph.add_node(sym);
            }

            // Link calls
            for (caller_qual_or_name, callee_name) in calls {
                let caller_id = graph
                    .find_symbols_by_name(&caller_qual_or_name)
                    .into_iter()
                    .find(|c| c.file_path == rel_path)
                    .map(|c| c.id.clone());

                if let Some(cid) = caller_id {
                    let callee_ids: Vec<String> = graph
                        .find_symbols_by_name(&callee_name)
                        .into_iter()
                        .map(|c| c.id.clone())
                        .collect();

                    for tid in callee_ids {
                        graph.add_edge(GraphEdge {
                            source_id: cid.clone(),
                            target_id: tid,
                            kind: EdgeKind::Calls,
                            weight: 1.0,
                        });
                    }
                }
            }
        }
    }
}
