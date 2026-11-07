use super::types::{CompilerDiagnostic, DiagnosticSeverity};
use regex::Regex;

pub struct DiagnosticParser;

impl DiagnosticParser {
    /// Strips ANSI terminal color escape codes.
    pub fn strip_ansi(raw: &str) -> String {
        let re = Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap();
        re.replace_all(raw, "").to_string()
    }

    /// Parses JSON stream output from `cargo check --message-format=json`.
    pub fn parse_cargo_json(raw: &str) -> Vec<CompilerDiagnostic> {
        let mut results = Vec::new();

        for line in raw.lines() {
            let trimmed = line.trim();
            if !trimmed.starts_with('{') {
                continue;
            }

            if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                if val.get("reason").and_then(|r| r.as_str()) != Some("compiler-message") {
                    continue;
                }

                if let Some(msg_obj) = val.get("message") {
                    let level = msg_obj.get("level").and_then(|l| l.as_str()).unwrap_or("error");
                    let severity = match level {
                        "error" => DiagnosticSeverity::Error,
                        "warning" => DiagnosticSeverity::Warning,
                        _ => DiagnosticSeverity::Information,
                    };

                    let message = msg_obj.get("message").and_then(|m| m.as_str()).unwrap_or("").to_string();
                    let code = msg_obj.get("code").and_then(|c| c.get("code")).and_then(|c| c.as_str()).map(|s| s.to_string());
                    let rendered = msg_obj.get("rendered").and_then(|r| r.as_str()).map(|s| Self::strip_ansi(s));

                    if let Some(spans) = msg_obj.get("spans").and_then(|s| s.as_array()) {
                        for span in spans {
                            let is_primary = span.get("is_primary").and_then(|p| p.as_bool()).unwrap_or(true);
                            if is_primary {
                                let file = span.get("file_name").and_then(|f| f.as_str()).unwrap_or("").to_string();
                                let line = span.get("line_start").and_then(|l| l.as_u64()).unwrap_or(1) as usize;
                                let col = span.get("column_start").and_then(|c| c.as_u64()).unwrap_or(1) as usize;
                                let suggested_fix = span.get("suggested_replacement").and_then(|r| r.as_str()).map(|s| s.to_string());

                                results.push(CompilerDiagnostic {
                                    file_path: file.replace('\\', "/"),
                                    line,
                                    column: col,
                                    code: code.clone(),
                                    severity,
                                    message: message.clone(),
                                    rendered_ansi: rendered.clone(),
                                    suggested_fix,
                                    context_lines: None,
                                });
                            }
                        }
                    }
                }
            }
        }

        results
    }

    /// Parses TypeScript compiler (`tsc`) standard output.
    pub fn parse_typescript_output(raw: &str) -> Vec<CompilerDiagnostic> {
        let clean = Self::strip_ansi(raw);
        let mut results = Vec::new();

        // Match: src/app.ts(42,15): error TS2322: Type 'string' is not assignable to type 'number'.
        let ts_regex = Regex::new(r"(?m)^(?P<file>[^\s(]+)\((?P<line>\d+),(?P<col>\d+)\):\s*(?P<sev>error|warning)\s*(?P<code>TS\d+):\s*(?P<msg>.+)$").unwrap();

        for caps in ts_regex.captures_iter(&clean) {
            let file = caps.name("file").map_or("", |m| m.as_str());
            let line = caps.name("line").map_or(1, |m| m.as_str().parse().unwrap_or(1));
            let col = caps.name("col").map_or(1, |m| m.as_str().parse().unwrap_or(1));
            let sev_str = caps.name("sev").map_or("error", |m| m.as_str());
            let code = caps.name("code").map(|m| m.as_str().to_string());
            let msg = caps.name("msg").map_or("", |m| m.as_str()).to_string();

            let severity = if sev_str == "error" {
                DiagnosticSeverity::Error
            } else {
                DiagnosticSeverity::Warning
            };

            results.push(CompilerDiagnostic {
                file_path: file.replace('\\', "/"),
                line,
                column: col,
                code,
                severity,
                message: msg,
                rendered_ansi: None,
                suggested_fix: None,
                context_lines: None,
            });
        }

        results
    }

    /// Universal fallback parser matching GCC / Clang / Python error lines.
    pub fn parse_generic_output(raw: &str) -> Vec<CompilerDiagnostic> {
        let clean = Self::strip_ansi(raw);
        let mut results = Vec::new();

        let generic_re = Regex::new(r"(?m)^(?P<file>[a-zA-Z0-9_\-\./\\]+):(?P<line>\d+)(?::(?P<col>\d+))?:\s*(?:(?P<sev>error|warning|fatal error):\s*)?(?P<msg>.+)$").unwrap();

        for caps in generic_re.captures_iter(&clean) {
            let file = caps.name("file").map_or("", |m| m.as_str());
            let line = caps.name("line").map_or(1, |m| m.as_str().parse().unwrap_or(1));
            let col = caps.name("col").and_then(|m| m.as_str().parse().ok()).unwrap_or(1);
            let sev_str = caps.name("sev").map_or("error", |m| m.as_str());
            let msg = caps.name("msg").map_or("", |m| m.as_str()).to_string();

            let severity = if sev_str.contains("error") {
                DiagnosticSeverity::Error
            } else {
                DiagnosticSeverity::Warning
            };

            results.push(CompilerDiagnostic {
                file_path: file.replace('\\', "/"),
                line,
                column: col,
                code: None,
                severity,
                message: msg,
                rendered_ansi: None,
                suggested_fix: None,
                context_lines: None,
            });
        }

        results
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_typescript_error_lines() {
        let tsc_output = r#"
src/components/agent.ts(104,18): error TS2339: Property 'nonExistent' does not exist on type 'AgentService'.
src/editor/monaco.ts(52,9): warning TS6133: 'unusedVar' is declared but its value is never read.
"#;
        let diags = DiagnosticParser::parse_typescript_output(tsc_output);
        assert_eq!(diags.len(), 2);

        assert_eq!(diags[0].file_path, "src/components/agent.ts");
        assert_eq!(diags[0].line, 104);
        assert_eq!(diags[0].column, 18);
        assert_eq!(diags[0].code.as_deref(), Some("TS2339"));
        assert_eq!(diags[0].severity, DiagnosticSeverity::Error);

        assert_eq!(diags[1].file_path, "src/editor/monaco.ts");
        assert_eq!(diags[1].line, 52);
        assert_eq!(diags[1].severity, DiagnosticSeverity::Warning);
    }

    #[test]
    fn test_parse_cargo_json_line() {
        let cargo_json = r#"{"reason":"compiler-message","package_id":"test 0.1.0","message":{"message":"mismatched types","code":{"code":"E0308"},"level":"error","spans":[{"file_name":"src/main.rs","byte_start":45,"byte_end":50,"line_start":12,"line_end":12,"column_start":9,"column_end":14,"is_primary":true,"text":[],"label":"expected `i32`, found `&str`","suggested_replacement":null,"suggestion_applicability":null,"expansion":null}],"children":[],"rendered":"error[E0308]: mismatched types\n  --> src/main.rs:12:9\n"}}"#;

        let diags = DiagnosticParser::parse_cargo_json(cargo_json);
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].file_path, "src/main.rs");
        assert_eq!(diags[0].line, 12);
        assert_eq!(diags[0].column, 9);
        assert_eq!(diags[0].code.as_deref(), Some("E0308"));
        assert_eq!(diags[0].message, "mismatched types");
    }
}
