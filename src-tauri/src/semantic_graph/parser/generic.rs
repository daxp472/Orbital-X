use crate::semantic_graph::types::{LineRange, SymbolKind, SymbolNode};
use regex::Regex;

pub struct GenericParser;

impl GenericParser {
    pub fn parse_file(file_path: &str, content: &str) -> (Vec<SymbolNode>, Vec<(String, String)>) {
        let mut symbols = Vec::new();
        let mut raw_calls = Vec::new();

        let lines: Vec<&str> = content.lines().collect();

        // Generic C/C++/Java/Go function detector
        let fn_regex = Regex::new(r"^(?:\s*(?:public|private|protected|static|final|func)?\s*(?:[a-zA-Z_0-9<>,:*&]+\s+)?([a-zA-Z_0-9]+)\s*\([^)]*\)\s*\{?)").unwrap();
        let class_regex = Regex::new(r"^(?:\s*(?:public|private)?\s*(?:class|struct|interface)\s+([a-zA-Z_0-9]+))").unwrap();
        let call_regex = Regex::new(r"\b([a-zA-Z_0-9]+)\s*\(").unwrap();

        let mut active_fn: Option<String> = None;

        for (idx, line) in lines.iter().enumerate() {
            let line_num = idx + 1;
            let trimmed = line.trim();

            if trimmed.starts_with("//") || trimmed.starts_with('#') || trimmed.is_empty() {
                continue;
            }

            if let Some(caps) = class_regex.captures(trimmed) {
                let name = caps.get(1).map_or("", |m| m.as_str());
                let sym_id = format!("{}:class:{}:{}", file_path, name, line_num);
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

            if let Some(caps) = fn_regex.captures(trimmed) {
                let name = caps.get(1).map_or("", |m| m.as_str());
                if !["if", "while", "for", "switch", "catch", "return"].contains(&name) {
                    let sym_id = format!("{}:function:{}:{}", file_path, name, line_num);
                    active_fn = Some(name.to_string());
                    symbols.push(SymbolNode {
                        id: sym_id,
                        name: name.to_string(),
                        qualified_name: name.to_string(),
                        kind: SymbolKind::Function,
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
            }

            if let Some(ref caller) = active_fn {
                for caps in call_regex.captures_iter(trimmed) {
                    let callee = caps.get(1).map_or("", |m| m.as_str());
                    if !["if", "while", "for", "switch", "catch", "return", "sizeof"].contains(&callee) {
                        raw_calls.push((caller.clone(), callee.to_string()));
                    }
                }
            }

            if trimmed == "}" {
                active_fn = None;
            }
        }

        (symbols, raw_calls)
    }
}

