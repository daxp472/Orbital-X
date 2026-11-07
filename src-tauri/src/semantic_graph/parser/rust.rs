use crate::semantic_graph::types::{LineRange, SymbolKind, SymbolNode};
use regex::Regex;

pub struct RustParser;

impl RustParser {
    pub fn parse_file(file_path: &str, content: &str) -> (Vec<SymbolNode>, Vec<(String, String)>) {
        let mut symbols = Vec::new();
        let mut raw_calls = Vec::new(); // (caller_symbol_name, callee_symbol_name)

        let lines: Vec<&str> = content.lines().collect();
        let mut current_doc = Vec::new();

        let fn_regex = Regex::new(r"^(?:\s*(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?(?:extern\s+(?:.*?\s+)?)?fn\s+([a-zA-Z_0-9]+))").unwrap();
        let struct_regex = Regex::new(r"^(?:\s*(?:pub(?:\([^)]+\))?\s+)?struct\s+([a-zA-Z_0-9]+))").unwrap();
        let enum_regex = Regex::new(r"^(?:\s*(?:pub(?:\([^)]+\))?\s+)?enum\s+([a-zA-Z_0-9]+))").unwrap();
        let trait_regex = Regex::new(r"^(?:\s*(?:pub(?:\([^)]+\))?\s+)?trait\s+([a-zA-Z_0-9]+))").unwrap();
        let type_regex = Regex::new(r"^(?:\s*(?:pub(?:\([^)]+\))?\s+)?type\s+([a-zA-Z_0-9]+))").unwrap();
        let impl_regex = Regex::new(r"^(?:\s*impl(?:<[^>]+>)?\s+(?:([a-zA-Z_0-9:]+)\s+for\s+)?([a-zA-Z_0-9:]+))").unwrap();
        let use_regex = Regex::new(r"^\s*(?:pub\s+)?use\s+([^;]+);").unwrap();
        let call_regex = Regex::new(r"\b([a-zA-Z_0-9]+)\s*\(").unwrap();

        let mut current_impl: Option<String> = None;
        let mut active_fn: Option<String> = None;

        for (idx, line) in lines.iter().enumerate() {
            let line_num = idx + 1;
            let trimmed = line.trim();

            // Collect doc comments
            if trimmed.starts_with("///") || trimmed.starts_with("//!") {
                current_doc.push(trimmed.trim_start_matches('/').trim().to_string());
                continue;
            }

            // Check for use / imports
            if let Some(caps) = use_regex.captures(trimmed) {
                let import_path = caps.get(1).map_or("", |m| m.as_str()).trim();
                let sym_id = format!("{}:import:{}:{}", file_path, import_path, line_num);
                symbols.push(SymbolNode {
                    id: sym_id,
                    name: import_path.to_string(),
                    qualified_name: format!("use {}", import_path),
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
                    visibility: if trimmed.starts_with("pub") { "pub".into() } else { "private".into() },
                    parent_id: None,
                });
                current_doc.clear();
                continue;
            }

            // Check for impl block
            if let Some(caps) = impl_regex.captures(trimmed) {
                let for_type = caps.get(2).map_or("", |m| m.as_str());
                current_impl = Some(for_type.to_string());
                current_doc.clear();
                continue;
            }

            // Check for struct
            if let Some(caps) = struct_regex.captures(trimmed) {
                let name = caps.get(1).map_or("", |m| m.as_str());
                let sym_id = format!("{}:struct:{}:{}", file_path, name, line_num);
                let doc = if current_doc.is_empty() { None } else { Some(current_doc.join("\n")) };
                symbols.push(SymbolNode {
                    id: sym_id,
                    name: name.to_string(),
                    qualified_name: name.to_string(),
                    kind: SymbolKind::Struct,
                    file_path: file_path.to_string(),
                    range: LineRange {
                        start_line: line_num,
                        end_line: line_num,
                        start_col: 1,
                        end_col: line.len(),
                    },
                    signature: trimmed.to_string(),
                    doc_comment: doc,
                    visibility: if trimmed.starts_with("pub") { "pub".into() } else { "private".into() },
                    parent_id: None,
                });
                current_doc.clear();
                continue;
            }

            // Check for enum
            if let Some(caps) = enum_regex.captures(trimmed) {
                let name = caps.get(1).map_or("", |m| m.as_str());
                let sym_id = format!("{}:enum:{}:{}", file_path, name, line_num);
                let doc = if current_doc.is_empty() { None } else { Some(current_doc.join("\n")) };
                symbols.push(SymbolNode {
                    id: sym_id,
                    name: name.to_string(),
                    qualified_name: name.to_string(),
                    kind: SymbolKind::Enum,
                    file_path: file_path.to_string(),
                    range: LineRange {
                        start_line: line_num,
                        end_line: line_num,
                        start_col: 1,
                        end_col: line.len(),
                    },
                    signature: trimmed.to_string(),
                    doc_comment: doc,
                    visibility: if trimmed.starts_with("pub") { "pub".into() } else { "private".into() },
                    parent_id: None,
                });
                current_doc.clear();
                continue;
            }

            // Check for trait
            if let Some(caps) = trait_regex.captures(trimmed) {
                let name = caps.get(1).map_or("", |m| m.as_str());
                let sym_id = format!("{}:trait:{}:{}", file_path, name, line_num);
                let doc = if current_doc.is_empty() { None } else { Some(current_doc.join("\n")) };
                symbols.push(SymbolNode {
                    id: sym_id,
                    name: name.to_string(),
                    qualified_name: name.to_string(),
                    kind: SymbolKind::Trait,
                    file_path: file_path.to_string(),
                    range: LineRange {
                        start_line: line_num,
                        end_line: line_num,
                        start_col: 1,
                        end_col: line.len(),
                    },
                    signature: trimmed.to_string(),
                    doc_comment: doc,
                    visibility: if trimmed.starts_with("pub") { "pub".into() } else { "private".into() },
                    parent_id: None,
                });
                current_doc.clear();
                continue;
            }

            // Check for type alias
            if let Some(caps) = type_regex.captures(trimmed) {
                let name = caps.get(1).map_or("", |m| m.as_str());
                let sym_id = format!("{}:type:{}:{}", file_path, name, line_num);
                symbols.push(SymbolNode {
                    id: sym_id,
                    name: name.to_string(),
                    qualified_name: name.to_string(),
                    kind: SymbolKind::TypeAlias,
                    file_path: file_path.to_string(),
                    range: LineRange {
                        start_line: line_num,
                        end_line: line_num,
                        start_col: 1,
                        end_col: line.len(),
                    },
                    signature: trimmed.to_string(),
                    doc_comment: None,
                    visibility: if trimmed.starts_with("pub") { "pub".into() } else { "private".into() },
                    parent_id: None,
                });
                current_doc.clear();
                continue;
            }

            // Check for function or method
            if let Some(caps) = fn_regex.captures(trimmed) {
                let name = caps.get(1).map_or("", |m| m.as_str());
                let (kind, qual) = if let Some(ref impl_name) = current_impl {
                    (SymbolKind::Method, format!("{}::{}", impl_name, name))
                } else {
                    (SymbolKind::Function, name.to_string())
                };

                let sym_id = format!("{}:{}:{}:{}", file_path, kind.as_str(), qual, line_num);
                let doc = if current_doc.is_empty() { None } else { Some(current_doc.join("\n")) };

                active_fn = Some(qual.clone());
                symbols.push(SymbolNode {
                    id: sym_id,
                    name: name.to_string(),
                    qualified_name: qual,
                    kind,
                    file_path: file_path.to_string(),
                    range: LineRange {
                        start_line: line_num,
                        end_line: line_num,
                        start_col: 1,
                        end_col: line.len(),
                    },
                    signature: trimmed.to_string(),
                    doc_comment: doc,
                    visibility: if trimmed.starts_with("pub") { "pub".into() } else { "private".into() },
                    parent_id: current_impl.clone(),
                });
                current_doc.clear();
                continue;
            }

            // Record call occurrences inside active functions
            if let Some(ref caller) = active_fn {
                for caps in call_regex.captures_iter(trimmed) {
                    let callee = caps.get(1).map_or("", |m| m.as_str());
                    // Filter out keywords that look like function calls
                    if !["if", "while", "for", "match", "let", "return", "Some", "Ok", "Err", "vec", "panic"].contains(&callee) {
                        raw_calls.push((caller.clone(), callee.to_string()));
                    }
                }
            }

            if trimmed == "}" {
                if active_fn.is_some() {
                    active_fn = None;
                } else if current_impl.is_some() {
                    current_impl = None;
                }
            }

            if !trimmed.starts_with("///") && !trimmed.starts_with("//!") {
                current_doc.clear();
            }
        }

        (symbols, raw_calls)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rust_parser_extracts_structs_and_functions() {
        let code = r#"
/// Service for handling authentication
pub struct AuthService {
    token: String,
}

impl AuthService {
    pub async fn login(&self, user: &str) -> bool {
        validate_user(user);
        true
    }
}

fn validate_user(u: &str) -> bool {
    u.len() > 3
}
"#;

        let (symbols, calls) = RustParser::parse_file("src/auth.rs", code);
        assert_eq!(symbols.len(), 3);

        let struct_sym = symbols.iter().find(|s| s.name == "AuthService").unwrap();
        assert_eq!(struct_sym.kind, SymbolKind::Struct);
        assert!(struct_sym.doc_comment.as_ref().unwrap().contains("Service for handling authentication"));

        let method_sym = symbols.iter().find(|s| s.name == "login").unwrap();
        assert_eq!(method_sym.kind, SymbolKind::Method);
        assert_eq!(method_sym.qualified_name, "AuthService::login");

        assert!(calls.iter().any(|(caller, callee)| caller == "AuthService::login" && callee == "validate_user"));
    }
}

