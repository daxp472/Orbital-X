use super::types::{EdgeKind, FocusedContextSlice, GraphEdge, SymbolNode, SymbolSummary};
use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct SemanticCodeGraph {
    nodes: HashMap<String, SymbolNode>,
    edges_forward: HashMap<String, Vec<GraphEdge>>,
    edges_backward: HashMap<String, Vec<GraphEdge>>,
    file_index: HashMap<String, HashSet<String>>,
    name_index: HashMap<String, Vec<String>>,
}

impl SemanticCodeGraph {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn total_symbols(&self) -> usize {
        self.nodes.len()
    }

    pub fn total_edges(&self) -> usize {
        self.edges_forward.values().map(|v| v.len()).sum()
    }

    pub fn total_files(&self) -> usize {
        self.file_index.len()
    }

    pub fn add_node(&mut self, node: SymbolNode) {
        let id = node.id.clone();
        let name = node.name.clone();
        let file = node.file_path.clone();

        self.file_index.entry(file).or_default().insert(id.clone());
        self.name_index.entry(name).or_default().push(id.clone());
        self.nodes.insert(id, node);
    }

    pub fn add_edge(&mut self, edge: GraphEdge) {
        let src = edge.source_id.clone();
        let tgt = edge.target_id.clone();

        self.edges_forward.entry(src).or_default().push(edge.clone());
        self.edges_backward.entry(tgt).or_default().push(edge);
    }

    pub fn remove_file(&mut self, file_path: &str) {
        if let Some(symbol_ids) = self.file_index.remove(file_path) {
            for id in &symbol_ids {
                if let Some(node) = self.nodes.remove(id) {
                    if let Some(list) = self.name_index.get_mut(&node.name) {
                        list.retain(|x| x != id);
                    }
                }
                self.edges_forward.remove(id);
                self.edges_backward.remove(id);
            }
            // Clean dangling edges
            for edges in self.edges_forward.values_mut() {
                edges.retain(|e| !symbol_ids.contains(&e.target_id));
            }
            for edges in self.edges_backward.values_mut() {
                edges.retain(|e| !symbol_ids.contains(&e.source_id));
            }
        }
    }

    pub fn get_node(&self, id: &str) -> Option<&SymbolNode> {
        self.nodes.get(id)
    }

    pub fn find_symbols_by_name(&self, name: &str) -> Vec<&SymbolNode> {
        if let Some(ids) = self.name_index.get(name) {
            ids.iter().filter_map(|id| self.nodes.get(id)).collect()
        } else {
            // Case-insensitive fallback
            let lower = name.to_ascii_lowercase();
            self.nodes
                .values()
                .filter(|n| n.name.to_ascii_lowercase() == lower)
                .collect()
        }
    }

    /// Finds all caller symbols that directly invoke `target_name_or_id`.
    pub fn find_callers(&self, target: &str) -> Vec<SymbolSummary> {
        let target_ids = if self.nodes.contains_key(target) {
            vec![target.to_string()]
        } else if let Some(ids) = self.name_index.get(target) {
            ids.clone()
        } else {
            Vec::new()
        };

        let mut results = Vec::new();
        let mut seen = HashSet::new();

        for tid in target_ids {
            if let Some(incoming) = self.edges_backward.get(&tid) {
                for edge in incoming {
                    if edge.kind == EdgeKind::Calls {
                        if let Some(caller_node) = self.nodes.get(&edge.source_id) {
                            if seen.insert(caller_node.id.clone()) {
                                results.push(to_summary(caller_node));
                            }
                        }
                    }
                }
            }
        }

        results
    }

    /// Finds all callee symbols called by `source_name_or_id`.
    pub fn find_callees(&self, source: &str) -> Vec<SymbolSummary> {
        let source_ids = if self.nodes.contains_key(source) {
            vec![source.to_string()]
        } else if let Some(ids) = self.name_index.get(source) {
            ids.clone()
        } else {
            Vec::new()
        };

        let mut results = Vec::new();
        let mut seen = HashSet::new();

        for sid in source_ids {
            if let Some(outgoing) = self.edges_forward.get(&sid) {
                for edge in outgoing {
                    if edge.kind == EdgeKind::Calls {
                        if let Some(callee_node) = self.nodes.get(&edge.target_id) {
                            if seen.insert(callee_node.id.clone()) {
                                results.push(to_summary(callee_node));
                            }
                        }
                    }
                }
            }
        }

        results
    }

    /// Finds all transitive functional dependencies for a symbol up to `max_depth` hops.
    pub fn find_dependencies(&self, root_symbol_or_id: &str, max_depth: usize) -> Vec<SymbolSummary> {
        let start_ids = if self.nodes.contains_key(root_symbol_or_id) {
            vec![root_symbol_or_id.to_string()]
        } else if let Some(ids) = self.name_index.get(root_symbol_or_id) {
            ids.clone()
        } else {
            Vec::new()
        };

        let mut visited = HashSet::new();
        let mut queue = VecDeque::new();
        let mut results = Vec::new();

        for id in start_ids {
            visited.insert(id.clone());
            queue.push_back((id, 0));
        }

        while let Some((curr_id, depth)) = queue.pop_front() {
            if depth >= max_depth {
                continue;
            }

            if let Some(edges) = self.edges_forward.get(&curr_id) {
                for edge in edges {
                    if visited.insert(edge.target_id.clone()) {
                        if let Some(node) = self.nodes.get(&edge.target_id) {
                            results.push(to_summary(node));
                            queue.push_back((edge.target_id.clone(), depth + 1));
                        }
                    }
                }
            }
        }

        results
    }

    /// Extracts an ultra-compact focused semantic context slice for an LLM prompt.
    /// Replaces 100,000 raw token file dumps with a precise ~1,500 token structural slice!
    pub fn extract_focused_context(&self, target_symbol_or_name: &str) -> Option<FocusedContextSlice> {
        let target_node = self.nodes.get(target_symbol_or_name)
            .or_else(|| self.find_symbols_by_name(target_symbol_or_name).into_iter().next())?;

        let callers = self.find_callers(&target_node.id);
        let callees = self.find_callees(&target_node.id);
        let dependencies = self.find_dependencies(&target_node.id, 2);

        let definition_snippet = format!(
            "// File: {}:{}\n{}\n{}",
            target_node.file_path,
            target_node.range.start_line,
            target_node.doc_comment.as_deref().unwrap_or(""),
            target_node.signature
        );

        let est_tokens = definition_snippet.len() / 4
            + callers.len() * 20
            + callees.len() * 20
            + dependencies.len() * 20;

        Some(FocusedContextSlice {
            target_symbol: target_node.name.clone(),
            target_file: target_node.file_path.clone(),
            definition_snippet,
            callers,
            callees,
            dependencies,
            estimated_tokens: est_tokens,
        })
    }
}

fn to_summary(node: &SymbolNode) -> SymbolSummary {
    SymbolSummary {
        id: node.id.clone(),
        name: node.name.clone(),
        kind: node.kind,
        file_path: node.file_path.clone(),
        signature: node.signature.clone(),
        line: node.range.start_line,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic_graph::types::{LineRange, SymbolKind};

    #[test]
    fn test_semantic_graph_nodes_edges_and_callers() {
        let mut graph = SemanticCodeGraph::new();

        let node1 = SymbolNode {
            id: "src/main.rs:function:run:10".into(),
            name: "run".into(),
            qualified_name: "run".into(),
            kind: SymbolKind::Function,
            file_path: "src/main.rs".into(),
            range: LineRange { start_line: 10, end_line: 20, start_col: 1, end_col: 1 },
            signature: "pub fn run()".into(),
            doc_comment: None,
            visibility: "pub".into(),
            parent_id: None,
        };

        let node2 = SymbolNode {
            id: "src/auth.rs:function:authenticate:5".into(),
            name: "authenticate".into(),
            qualified_name: "authenticate".into(),
            kind: SymbolKind::Function,
            file_path: "src/auth.rs".into(),
            range: LineRange { start_line: 5, end_line: 15, start_col: 1, end_col: 1 },
            signature: "pub fn authenticate(token: &str) -> bool".into(),
            doc_comment: Some("Authenticates user token".into()),
            visibility: "pub".into(),
            parent_id: None,
        };

        graph.add_node(node1);
        graph.add_node(node2);

        graph.add_edge(GraphEdge {
            source_id: "src/main.rs:function:run:10".into(),
            target_id: "src/auth.rs:function:authenticate:5".into(),
            kind: EdgeKind::Calls,
            weight: 1.0,
        });

        assert_eq!(graph.total_symbols(), 2);
        assert_eq!(graph.total_edges(), 1);

        // Callers test
        let callers = graph.find_callers("authenticate");
        assert_eq!(callers.len(), 1);
        assert_eq!(callers[0].name, "run");

        // Callees test
        let callees = graph.find_callees("run");
        assert_eq!(callees.len(), 1);
        assert_eq!(callees[0].name, "authenticate");

        // Focused context slice test
        let slice = graph.extract_focused_context("authenticate").unwrap();
        assert_eq!(slice.target_symbol, "authenticate");
        assert_eq!(slice.callers.len(), 1);
        assert!(slice.definition_snippet.contains("Authenticates user token"));
    }
}

