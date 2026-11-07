pub mod generic;
pub mod python;
pub mod rust;
pub mod typescript;

use crate::semantic_graph::types::SymbolNode;
use std::path::Path;

pub struct SourceParserDispatcher;

impl SourceParserDispatcher {
    pub fn parse_source(file_path: &str, content: &str) -> (Vec<SymbolNode>, Vec<(String, String)>) {
        let p = Path::new(file_path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();

        match ext.as_str() {
            "rs" => rust::RustParser::parse_file(file_path, content),
            "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" => typescript::TypeScriptParser::parse_file(file_path, content),
            "py" => python::PythonParser::parse_file(file_path, content),
            _ => generic::GenericParser::parse_file(file_path, content),
        }
    }
}

