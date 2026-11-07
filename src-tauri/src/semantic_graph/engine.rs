use super::graph::SemanticCodeGraph;
use super::indexer::GraphIndexer;
use super::types::{FocusedContextSlice, SymbolSummary};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock as TokioRwLock;

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
    graph: Arc<TokioRwLock<SemanticCodeGraph>>,
    is_indexing: Arc<AtomicBool>,
}

impl SemanticGraphEngine {
    pub fn new(workspace_root: PathBuf) -> Self {
        let is_indexing = Arc::new(AtomicBool::new(false));
        let graph = Arc::new(TokioRwLock::new(SemanticCodeGraph::new()));

        Self {
            workspace_root,
            graph,
            is_indexing,
        }
    }

    /// Spawns background indexing for the active workspace.
    pub fn start_background_indexing(&self) {
        let ws = self.workspace_root.clone();
        let graph_arc = self.graph.clone();
        let indexing_flag = self.is_indexing.clone();

        tokio::spawn(async move {
            indexing_flag.store(true, Ordering::SeqCst);
            // Run compute-intensive parsing on a blocking thread
            let built = tokio::task::spawn_blocking(move || {
                GraphIndexer::build_workspace_graph(&ws)
            }).await.unwrap_or_default();

            {
                let mut lock = graph_arc.write().await;
                *lock = built;
            }
            indexing_flag.store(false, Ordering::SeqCst);
        });
    }

    /// Incrementally updates a modified file in the semantic graph.
    pub async fn on_file_changed(&self, rel_path: &str) {
        let mut lock = self.graph.write().await;
        GraphIndexer::update_file(&mut lock, &self.workspace_root, rel_path);
    }

    pub async fn query_callers(&self, target_symbol: &str) -> Vec<SymbolSummary> {
        let lock = self.graph.read().await;
        lock.find_callers(target_symbol)
    }

    pub async fn query_callees(&self, source_symbol: &str) -> Vec<SymbolSummary> {
        let lock = self.graph.read().await;
        lock.find_callees(source_symbol)
    }

    pub async fn query_dependencies(&self, root_symbol: &str, max_depth: usize) -> Vec<SymbolSummary> {
        let lock = self.graph.read().await;
        lock.find_dependencies(root_symbol, max_depth)
    }

    pub async fn get_focused_context(&self, target_symbol: &str) -> Option<FocusedContextSlice> {
        let lock = self.graph.read().await;
        lock.extract_focused_context(target_symbol)
    }

    pub async fn get_stats(&self) -> GraphStats {
        let lock = self.graph.read().await;
        GraphStats {
            total_symbols: lock.total_symbols(),
            total_edges: lock.total_edges(),
            total_files: lock.total_files(),
            is_indexing: self.is_indexing.load(Ordering::SeqCst),
        }
    }
}
