use crate::semantic_graph::types::{LineRange, SymbolKind, SymbolNode};
use regex::Regex;

pub struct PythonParser;

impl PythonParser {
    pub fn parse_file(file_path: &str, content: &str) -> (Vec<SymbolNode>, Vec<(String, String)>) {
        let mut symbols = Vec::new();
        let mut raw_calls = Vec::new();

        let lines: Vec<&str> = content.lines().collect();

        let fn_regex = Regex::new(r"^(?:\s*(?:async\s+)?def\s+([a-zA-Z_0-9]+)\s*\()").unwrap();
        let class_regex = Regex::new(r"^(?:\s*class\s+([a-zA-Z_0-9]+)(?:\([^)]*\))?\s*:)").unwrap();
        let import_regex = Regex::new(r"^(?:\s*(?:from\s+([a-zA-Z_0-9.]+)\s+import\s+([a-zA-Z_0-9*,\s]+)|import\s+([a-zA-Z_0-9.,\s]+)))").unwrap();
        let call_regex = Regex::new(r"\b([a-zA-Z_0-9]+)\s*\(").unwrap();

        let mut current_class: Option<String> = None;
        let mut active_fn: Option<String> = None;
        let mut in_docstring = false;
        let mut docstring_buf = Vec::new();

        for (idx, line) in lines.iter().enumerate() {
            let line_num = idx + 1;
            let trimmed = line.trim();

            if trimmed.starts_with("\"\"\"") || trimmed.starts_with("'''") {
                if in_docstring {
                    in_docstring = false;
                    continue;
                } else if trimmed.ends_with("\"\"\"") && trimmed.len() > 3 || trimmed.ends_with("'''") && trimmed.len() > 3 {
                    // Single line docstring
                    continue;
                } else {
                    in_docstring = true;
                    docstring_buf.clear();
                    continue;
                }
            }

            if in_docstring {
                docstring_buf.push(trimmed.to_string());
                continue;
            }

            // Check imports
            if let Some(caps) = import_regex.captures(trimmed) {
                let module = caps.get(1).or_else(|| caps.get(3)).map_or("", |m| m.as_str());
                let sym_id = format!("{}:import:{}:{}", file_path, module, line_num);
                symbols.push(SymbolNode {
                    id: sym_id,
                    name: module.to_string(),
                    qualified_name: format!("import {}", module),
                    kind: SymbolKind::Import,
                    file_path: file_path.to_string(),
                    range: LineRange {
                        start_line: line_num,
                        end_line: line_num,
                        start_col: 1,
                        end_col: line.len(),
                    },
                    signature: trimmed.to_string(),
                    doc_comment: None,
                    visibility: "private".into(),
                    parent_id: None,
                });
                continue;
            }

            // Check class
            if let Some(caps) = class_regex.captures(trimmed) {
                let name = caps.get(1).map_or("", |m| m.as_str());
                let sym_id = format!("{}:class:{}:{}", file_path, name, line_num);
                current_class = Some(name.to_string());
                symbols.push(SymbolNode {
                    id: sym_id,
                    name: name.to_string(),
                    qualified_name: name.to_string(),
                    kind: SymbolKind::Class,
                    file_path: file_path.to_string(),
                    range: LineRange {
                        start_line: line_num,
                        end_line: line_num,
                        start_col: 1,
                        end_col: line.len(),
                    },
                    signature: trimmed.to_string(),
                    doc_comment: None,
                    visibility: "public".into(),
                    parent_id: None,
                });
                continue;
            }

            // Check function or method
            if let Some(caps) = fn_regex.captures(trimmed) {
                let name = caps.get(1).map_or("", |m| m.as_str());
                let (sym_kind, qual) = if let Some(ref cls) = current_class {
                    (SymbolKind::Method, format!("{}.{}", cls, name))
                } else {
                    (SymbolKind::Function, name.to_string())
                };

                let sym_id = format!("{}:{}:{}:{}", file_path, sym_kind.as_str(), qual, line_num);
                active_fn = Some(qual.clone());

                symbols.push(SymbolNode {
                    id: sym_id,
                    name: name.to_string(),
                    qualified_name: qual,
                    kind: sym_kind,
                    file_path: file_path.to_string(),
                    range: LineRange {
                        start_line: line_num,
                        end_line: line_num,
                        start_col: 1,
                        end_col: line.len(),
                    },
                    signature: trimmed.to_string(),
                    doc_comment: None,
                    visibility: if name.starts_with('_') { "private".into() } else { "public".into() },
                    parent_id: current_class.clone(),
                });
                continue;
            }

            // Call occurrences
            if let Some(ref caller) = active_fn {
                for caps in call_regex.captures_iter(trimmed) {
                    let callee = caps.get(1).map_or("", |m| m.as_str());
                    if !["if", "while", "for", "def", "class", "print", "len", "range", "str", "int"].contains(&callee) {
                        raw_calls.push((caller.clone(), callee.to_string()));
                    }
                }
            }

            // Reset class or function indent context if line is unindented and non-empty
            if !line.starts_with(' ') && !line.starts_with('\t') && !trimmed.is_empty() && !trimmed.starts_with('#') {
                if !trimmed.starts_with("def ") && !trimmed.starts_with("class ") {
                    current_class = None;
                    active_fn = None;
                }
            }
        }

        (symbols, raw_calls)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_python_parser_extracts_classes_and_methods() {
        let code = r#"
import os
from math import sqrt

class MatrixEngine:
    def __init__(self, size):
        self.size = size

    def compute(self, data):
        validate_input(data)
        return sqrt(data)

def validate_input(data):
    pass
"#;

        let (symbols, calls) = PythonParser::parse_file("engine.py", code);
        assert_eq!(symbols.len(), 6); // 2 imports, 1 class, 3 methods/functions (including __init__)

        let cls = symbols.iter().find(|s| s.name == "MatrixEngine").unwrap();
        assert_eq!(cls.kind, SymbolKind::Class);

        let method = symbols.iter().find(|s| s.name == "compute").unwrap();
        assert_eq!(method.kind, SymbolKind::Method);
        assert_eq!(method.qualified_name, "MatrixEngine.compute");

        assert!(calls.iter().any(|(caller, callee)| caller == "MatrixEngine.compute" && callee == "validate_input"));
    }
}

