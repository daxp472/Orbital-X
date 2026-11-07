use crate::semantic_graph::types::{LineRange, SymbolKind, SymbolNode};
use regex::Regex;

pub struct TypeScriptParser;

impl TypeScriptParser {
    pub fn parse_file(file_path: &str, content: &str) -> (Vec<SymbolNode>, Vec<(String, String)>) {
        let mut symbols = Vec::new();
        let mut raw_calls = Vec::new();

        let lines: Vec<&str> = content.lines().collect();
        let mut current_doc = Vec::new();

        let fn_regex = Regex::new(r"^(?:\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([a-zA-Z_0-9]+))").unwrap();
        let arrow_fn_regex = Regex::new(r"^(?:\s*(?:export\s+)?(?:const|let|var)\s+([a-zA-Z_0-9]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?=>)").unwrap();
        let method_regex = Regex::new(r"^(?:\s*(?:(?:public|private|protected|static|override|async)\s+)+([a-zA-Z_0-9]+)\s*\([^)]*\)|\s*([a-zA-Z_0-9]+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{)").unwrap();
        let class_regex = Regex::new(r"^(?:\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([a-zA-Z_0-9]+))").unwrap();
        let interface_regex = Regex::new(r"^(?:\s*(?:export\s+)?interface\s+([a-zA-Z_0-9]+))").unwrap();
        let type_regex = Regex::new(r"^(?:\s*(?:export\s+)?type\s+([a-zA-Z_0-9]+))").unwrap();
        let import_regex = Regex::new(r#"^\s*import\s+(?:\{[^}]*\}|[a-zA-Z_0-9*,\s]+)\s+from\s+['"]([^'"]+)['"]"#).unwrap();
        let call_regex = Regex::new(r"\b([a-zA-Z_0-9]+)\s*\(").unwrap();

        let mut current_class: Option<String> = None;
        let mut active_fn: Option<String> = None;

        for (idx, line) in lines.iter().enumerate() {
            let line_num = idx + 1;
            let trimmed = line.trim();

            // Collect JSDoc comments
            if trimmed.starts_with("/**") || trimmed.starts_with('*') {
                let clean = trimmed.trim_start_matches('/').trim_start_matches('*').trim();
                if !clean.is_empty() {
                    current_doc.push(clean.to_string());
                }
                continue;
            }

            // Check for imports
            if let Some(caps) = import_regex.captures(trimmed) {
                let import_target = caps.get(1).map_or("", |m| m.as_str());
                let sym_id = format!("{}:import:{}:{}", file_path, import_target, line_num);
                symbols.push(SymbolNode {
                    id: sym_id,
                    name: import_target.to_string(),
                    qualified_name: format!("import from {}", import_target),
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
                current_doc.clear();
                continue;
            }

            // Check for class
            if let Some(caps) = class_regex.captures(trimmed) {
                let name = caps.get(1).map_or("", |m| m.as_str());
                let sym_id = format!("{}:class:{}:{}", file_path, name, line_num);
                let doc = if current_doc.is_empty() { None } else { Some(current_doc.join("\n")) };
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
                    doc_comment: doc,
                    visibility: if trimmed.contains("export") { "export".into() } else { "private".into() },
                    parent_id: None,
                });
                current_doc.clear();
                continue;
            }

            // Check for interface
            if let Some(caps) = interface_regex.captures(trimmed) {
                let name = caps.get(1).map_or("", |m| m.as_str());
                let sym_id = format!("{}:interface:{}:{}", file_path, name, line_num);
                let doc = if current_doc.is_empty() { None } else { Some(current_doc.join("\n")) };
                symbols.push(SymbolNode {
                    id: sym_id,
                    name: name.to_string(),
                    qualified_name: name.to_string(),
                    kind: SymbolKind::Interface,
                    file_path: file_path.to_string(),
                    range: LineRange {
                        start_line: line_num,
                        end_line: line_num,
                        start_col: 1,
                        end_col: line.len(),
                    },
                    signature: trimmed.to_string(),
                    doc_comment: doc,
                    visibility: if trimmed.contains("export") { "export".into() } else { "private".into() },
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
                    visibility: if trimmed.contains("export") { "export".into() } else { "private".into() },
                    parent_id: None,
                });
                current_doc.clear();
                continue;
            }

            // Check for function or class method
            let found_fn = fn_regex.captures(trimmed).map(|c| (c.get(1).unwrap().as_str(), SymbolKind::Function))
                .or_else(|| arrow_fn_regex.captures(trimmed).map(|c| (c.get(1).unwrap().as_str(), SymbolKind::Function)))
                .or_else(|| {
                    if current_class.is_some() && !trimmed.ends_with(';') {
                        method_regex.captures(trimmed).and_then(|c| {
                            let m = c.get(1).or_else(|| c.get(2)).map(|v| v.as_str())?;
                            if m == "constructor" || m == "if" || m == "while" || m == "for" || m == "switch" {
                                None
                            } else {
                                Some((m, SymbolKind::Method))
                            }
                        })
                    } else {
                        None
                    }
                });

            if let Some((name, kind)) = found_fn {
                let (sym_kind, qual) = if let Some(ref cls) = current_class {
                    (SymbolKind::Method, format!("{}.{}", cls, name))
                } else {
                    (kind, name.to_string())
                };

                let sym_id = format!("{}:{}:{}:{}", file_path, sym_kind.as_str(), qual, line_num);
                let doc = if current_doc.is_empty() { None } else { Some(current_doc.join("\n")) };
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
                    doc_comment: doc,
                    visibility: if trimmed.contains("export") { "export".into() } else { "private".into() },
                    parent_id: current_class.clone(),
                });
                current_doc.clear();
                continue;
            }

            // Calls tracking
            if let Some(ref caller) = active_fn {
                for caps in call_regex.captures_iter(trimmed) {
                    let callee = caps.get(1).map_or("", |m| m.as_str());
                    if !["if", "while", "for", "switch", "catch", "import", "require", "super", "console", "log"].contains(&callee) {
                        raw_calls.push((caller.clone(), callee.to_string()));
                    }
                }
            }

            if trimmed == "}" {
                if active_fn.is_some() {
                    active_fn = None;
                } else if current_class.is_some() {
                    current_class = None;
                }
            }

            if !trimmed.starts_with('/') && !trimmed.starts_with('*') {
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
    fn test_typescript_parser_extracts_interfaces_classes_and_arrow_functions() {
        let code = r#"
import { Router } from 'express';

/** API user interface */
export interface UserPayload {
    id: string;
    email: string;
}

export class UserController {
    constructor() {}
    public async getUser(id: string) {
        validateId(id);
    }
}

export const validateId = (id: string): boolean => {
    return id.length > 0;
};
"#;

        let (symbols, calls) = TypeScriptParser::parse_file("src/controllers/user.ts", code);
        assert_eq!(symbols.len(), 5); // 1 import, 1 interface, 1 class, 1 method, 1 arrow fn

        let iface = symbols.iter().find(|s| s.name == "UserPayload").unwrap();
        assert_eq!(iface.kind, SymbolKind::Interface);
        assert!(iface.doc_comment.as_ref().unwrap().contains("API user interface"));

        let method = symbols.iter().find(|s| s.name == "getUser").unwrap();
        assert_eq!(method.kind, SymbolKind::Method);
        assert_eq!(method.qualified_name, "UserController.getUser");

        assert!(calls.iter().any(|(caller, callee)| caller == "UserController.getUser" && callee == "validateId"));
    }
}

