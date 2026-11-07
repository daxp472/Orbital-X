use super::graph::SemanticCodeGraph;
use super::indexer::GraphIndexer;
use super::types::{FocusedContextSlice, SymbolSummary};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GraphStats {
    pub total_symbols: usize,
    pub total_edges: usize,
    pub total_files: usize,
    pub is_indexing: bool,
}

#[derive(Clone)]
pub struct SemanticGraphEngine {
    workspace_root: PathBuf,
    graph: Arc<RwLock<SemanticCodeGraph>>,
    is_indexing: Arc<AtomicBool>,
}

impl SemanticGraphEngine {
    pub fn new(workspace_root: PathBuf) -> Self {
        let is_indexing = Arc::new(AtomicBool::new(false));
        let graph = Arc::new(RwLock::new(SemanticCodeGraph::new()));

        Self {
            workspace_root,
            graph,
            is_indexing,
        }
    }

    /// Spawns background indexing for the active workspace on a dedicated background thread.
    /// This runs completely decoupled from any async reactor runtime so it is safe to invoke
    /// from synchronous Tauri command contexts without triggering runtime panics.
    pub fn start_background_indexing(&self) {
        let ws = self.workspace_root.clone();
        let graph_arc = self.graph.clone();
        let indexing_flag = self.is_indexing.clone();

        let _ = std::thread::Builder::new()
            .name("semantic-graph-indexer".into())
            .spawn(move || {
                indexing_flag.store(true, Ordering::SeqCst);
                let built = GraphIndexer::build_workspace_graph(&ws);
                if let Ok(mut lock) = graph_arc.write() {
                    *lock = built;
                }
                indexing_flag.store(false, Ordering::SeqCst);
            });
    }

    /// Incrementally updates a modified file in the semantic graph.
    pub fn on_file_changed(&self, rel_path: &str) {
        if let Ok(mut lock) = self.graph.write() {
            GraphIndexer::update_file(&mut lock, &self.workspace_root, rel_path);
        }
    }

    pub fn query_callers(&self, target_symbol: &str) -> Vec<SymbolSummary> {
        let lock = match self.graph.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        lock.find_callers(target_symbol)
    }

    pub fn query_callees(&self, source_symbol: &str) -> Vec<SymbolSummary> {
        let lock = match self.graph.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        lock.find_callees(source_symbol)
    }

    pub fn query_dependencies(&self, root_symbol: &str, max_depth: usize) -> Vec<SymbolSummary> {
        let lock = match self.graph.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        lock.find_dependencies(root_symbol, max_depth)
    }

    pub fn get_focused_context(&self, target_symbol: &str) -> Option<FocusedContextSlice> {
        let lock = match self.graph.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        lock.extract_focused_context(target_symbol)
    }

    pub fn get_stats(&self) -> GraphStats {
        let lock = match self.graph.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        GraphStats {
            total_symbols: lock.total_symbols(),
            total_edges: lock.total_edges(),
            total_files: lock.total_files(),
            is_indexing: self.is_indexing.load(Ordering::SeqCst),
        }
    }
}
