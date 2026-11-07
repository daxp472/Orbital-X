use super::types::{CompilerDiagnostic, DiagnosticSeverity, HealingPrompt, LoopDetectionVerdict};
use std::collections::HashMap;

pub struct DiagnosticOracle {
    /// History of failure signatures and their occurrence counts
    signature_counts: HashMap<String, usize>,
    consecutive_signatures: Vec<String>,
    max_consecutive_loop_threshold: usize,
}

impl Default for DiagnosticOracle {
    fn default() -> Self {
        Self {
            signature_counts: HashMap::new(),
            consecutive_signatures: Vec::new(),
            max_consecutive_loop_threshold: 2,
        }
    }
}

impl DiagnosticOracle {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn compute_signature(diag: &CompilerDiagnostic) -> String {
        let code_str = diag.code.as_deref().unwrap_or("GENERIC");
        let truncated_msg: String = diag.message.chars().take(40).collect();
        format!("{}:{}:{}:{}", diag.file_path, diag.line, code_str, truncated_msg)
    }

    /// Evaluates a list of compiler diagnostics, detects loops, and formulates a deterministic healing prompt.
    pub fn evaluate_diagnostics(&mut self, diagnostics: &[CompilerDiagnostic]) -> Option<HealingPrompt> {
        // Find the first blocking Error
        let primary_error = diagnostics
            .iter()
            .find(|d| d.severity == DiagnosticSeverity::Error)
            .or_else(|| diagnostics.first())?;

        let sig = Self::compute_signature(primary_error);
        let count = self.signature_counts.entry(sig.clone()).or_insert(0);
        *count += 1;
        let consecutive_count = *count;

        let loop_verdict = self.check_loop(&sig);

        // Strict repair boundary: localized window around the error line
        let boundary_start = primary_error.line.saturating_sub(4).max(1);
        let boundary_end = primary_error.line + 4;

        let strict_instructions = if loop_verdict.is_loop_detected {
            format!(
                "RECURSIVE HALLUCINATION LOOP DETECTED: You have failed to resolve this compiler error {} consecutive times.\n\
                DO NOT repeat your previous attempt. Re-read the exact compiler diagnostic below.\n\
                STRICT REPAIR BOUNDARY: Confine your edits strictly between lines {} and {} of '{}'.\n\
                Do NOT touch imports, surrounding functions, or rewrite the file structure.",
                consecutive_count, boundary_start, boundary_end, primary_error.file_path
            )
        } else {
            format!(
                "DETERMINISTIC COMPILER HEALING REQUIRED:\n\
                File '{}' failed compilation at line {}: {}\n\
                STRICT REPAIR BOUNDARY: Confine your edits strictly between lines {} and {}.\n\
                Fix only the localized syntax or type mismatch. Do NOT rewrite the entire file.",
                primary_error.file_path, primary_error.line, primary_error.message, boundary_start, boundary_end
            )
        };

        self.consecutive_signatures.push(sig);

        Some(HealingPrompt {
            target_file: primary_error.file_path.clone(),
            line_number: primary_error.line,
            repair_boundary_start: boundary_start,
            repair_boundary_end: boundary_end,
            error_code: primary_error.code.clone(),
            diagnostic_message: primary_error.message.clone(),
            strict_instructions,
            consecutive_failure_count: consecutive_count,
            loop_detected: loop_verdict.is_loop_detected,
        })
    }

    /// Checks if the agent has entered an identical or oscillatory hallucination loop.
    pub fn check_loop(&self, current_sig: &str) -> LoopDetectionVerdict {
        let count = self.signature_counts.get(current_sig).copied().unwrap_or(0);
        let is_loop = count >= self.max_consecutive_loop_threshold;

        LoopDetectionVerdict {
            is_loop_detected: is_loop,
            repeated_error_signature: if is_loop { Some(current_sig.to_string()) } else { None },
            loop_count: count,
            recommended_action: if is_loop {
                "Halt speculative rewrites; enforce localized repair window".into()
            } else {
                "Proceed with bounded localized fix".into()
            },
        }
    }

    /// Resets the oracle tracking when a clean build succeeds.
    pub fn reset_on_success(&mut self) {
        self.signature_counts.clear();
        self.consecutive_signatures.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diagnostic_oracle_detects_repeated_failure_loop() {
        let mut oracle = DiagnosticOracle::new();

        let diag = CompilerDiagnostic {
            file_path: "src/main.rs".into(),
            line: 42,
            column: 15,
            code: Some("E0308".into()),
            severity: DiagnosticSeverity::Error,
            message: "mismatched types: expected u64, found i32".into(),
            rendered_ansi: None,
            suggested_fix: None,
            context_lines: None,
        };

        // Turn 1
        let prompt1 = oracle.evaluate_diagnostics(&[diag.clone()]).unwrap();
        assert!(!prompt1.loop_detected);
        assert_eq!(prompt1.consecutive_failure_count, 1);
        assert_eq!(prompt1.repair_boundary_start, 38);
        assert_eq!(prompt1.repair_boundary_end, 46);

        // Turn 2 (Identical error repeats)
        let prompt2 = oracle.evaluate_diagnostics(&[diag]).unwrap();
        assert!(prompt2.loop_detected);
        assert_eq!(prompt2.consecutive_failure_count, 2);
        assert!(prompt2.strict_instructions.contains("RECURSIVE HALLUCINATION LOOP DETECTED"));
    }
}

