use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DiagnosticSeverity {
    Error,
    Warning,
    Information,
    Hint,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CompilerDiagnostic {
    pub file_path: String,
    pub line: usize,
    pub column: usize,
    pub code: Option<String>,
    pub severity: DiagnosticSeverity,
    pub message: String,
    pub rendered_ansi: Option<String>,
    pub suggested_fix: Option<String>,
    pub context_lines: Option<Vec<(usize, String)>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ProjectToolchain {
    RustCargo,
    NodeTypeScript,
    NodeJavaScript,
    Python,
    Go,
    Generic,
}

impl ProjectToolchain {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProjectToolchain::RustCargo => "cargo",
            ProjectToolchain::NodeTypeScript => "tsc",
            ProjectToolchain::NodeJavaScript => "node",
            ProjectToolchain::Python => "python",
            ProjectToolchain::Go => "go",
            ProjectToolchain::Generic => "generic",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealingPrompt {
    pub target_file: String,
    pub line_number: usize,
    pub repair_boundary_start: usize,
    pub repair_boundary_end: usize,
    pub error_code: Option<String>,
    pub diagnostic_message: String,
    pub strict_instructions: String,
    pub consecutive_failure_count: usize,
    pub loop_detected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoopDetectionVerdict {
    pub is_loop_detected: bool,
    pub repeated_error_signature: Option<String>,
    pub loop_count: usize,
    pub recommended_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticStatus {
    pub toolchain: String,
    pub is_available: bool,
    pub last_error_count: usize,
    pub is_loop_detected: bool,
    pub consecutive_failures: usize,
}

