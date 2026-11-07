use super::graph::SemanticCodeGraph;
use super::parser::SourceParserDispatcher;
use super::types::{EdgeKind, GraphEdge};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

pub struct GraphIndexer;

impl GraphIndexer {
    /// Performs a full scan of `workspace_root`, parsing all source files and building the semantic graph.
    pub fn build_workspace_graph(workspace_root: &Path) -> SemanticCodeGraph {
        let mut graph = SemanticCodeGraph::new();
        let mut pending_calls: Vec<(String, Vec<(String, String)>)> = Vec::new();

        let walker = WalkDir::new(workspace_root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                let name = entry.file_name().to_string_lossy();
                !name.starts_with('.') || name == ".github" // skip hidden files except configs
            });

        for entry in walker.filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            let path_str = path.to_string_lossy().replace('\\', "/");
            // Skip non-source directories
            if path_str.contains("/node_modules/")
                || path_str.contains("/target/")
                || path_str.contains("/dist/")
                || path_str.contains("/build/")
                || path_str.contains("/.git/")
                || path_str.contains("/.orbital/")
            {
                continue;
            }

            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
            if !matches!(ext.as_str(), "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "c" | "cpp" | "h" | "hpp" | "java" | "cs") {
                continue;
            }

            // Relative path for canonical symbol keys
            let rel_path = path.strip_prefix(workspace_root).unwrap_or(path).to_string_lossy().replace('\\', "/");

            if let Ok(content) = fs::read_to_string(path) {
                let (symbols, calls) = SourceParserDispatcher::parse_source(&rel_path, &content);
                for sym in symbols {
                    graph.add_node(sym);
                }
                if !calls.is_empty() {
                    pending_calls.push((rel_path, calls));
                }
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
