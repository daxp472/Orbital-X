use super::detector::ToolchainDetector;
use super::oracle::DiagnosticOracle;
use super::parser::DiagnosticParser;
use super::types::{CompilerDiagnostic, HealingPrompt, ProjectToolchain};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Mutex as TokioMutex;

#[derive(Clone)]
pub struct DiagnosticService {
    workspace_root: PathBuf,
    oracle: Arc<TokioMutex<DiagnosticOracle>>,
}

impl DiagnosticService {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self {
            workspace_root,
            oracle: Arc::new(TokioMutex::new(DiagnosticOracle::new())),
        }
    }

    /// Automatically runs the project's compiler or linter check and parses the diagnostics.
    pub async fn run_compiler_check(&self, timeout_secs: u64) -> Result<Vec<CompilerDiagnostic>, String> {
        let cmd_info = ToolchainDetector::detect_toolchain(&self.workspace_root);
        if cmd_info.toolchain == ProjectToolchain::Generic {
            return Ok(Vec::new());
        }

        let mut cmd = Command::new(cmd_info.executable);
        cmd.args(&cmd_info.args);
        cmd.current_dir(&self.workspace_root);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to launch compiler diagnostic check '{}': {}", cmd_info.executable, e))?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let timeout_duration = std::time::Duration::from_secs(timeout_secs);

        let execution = async {
            let mut out_str = String::new();
            let mut err_str = String::new();

            let (out_res, err_res) = tokio::join!(
                async {
                    if let Some(mut stream) = stdout {
                        let mut buf = Vec::new();
                        let _ = stream.read_to_end(&mut buf).await;
                        Some(String::from_utf8_lossy(&buf).to_string())
                    } else {
                        None
                    }
                },
                async {
                    if let Some(mut stream) = stderr {
                        let mut buf = Vec::new();
                        let _ = stream.read_to_end(&mut buf).await;
                        Some(String::from_utf8_lossy(&buf).to_string())
                    } else {
                        None
                    }
                }
            );

            if let Some(o) = out_res {
                out_str = o;
            }
            if let Some(e) = err_res {
                err_str = e;
            }

            let _ = child.wait().await;
            (out_str, err_str)
        };

        let (stdout_text, stderr_text) = match tokio::time::timeout(timeout_duration, execution).await {
            Ok(res) => res,
            Err(_) => {
                let _ = child.kill().await;
                return Err(format!("Compiler diagnostic check timed out after {}s", timeout_secs));
            }
        };

        let raw_combined = format!("{}\n{}", stdout_text, stderr_text);

        let diagnostics = match cmd_info.toolchain {
            ProjectToolchain::RustCargo => DiagnosticParser::parse_cargo_json(&raw_combined),
            ProjectToolchain::NodeTypeScript => DiagnosticParser::parse_typescript_output(&raw_combined),
            _ => DiagnosticParser::parse_generic_output(&raw_combined),
        };

        Ok(diagnostics)
    }

    /// Evaluates the active compiler state and produces a deterministic healing prompt if errors are found.
    pub async fn evaluate_and_heal(&self, timeout_secs: u64) -> Result<Option<HealingPrompt>, String> {
        let diags = self.run_compiler_check(timeout_secs).await?;
        if diags.is_empty() {
            let mut oracle_lock = self.oracle.lock().await;
            oracle_lock.reset_on_success();
            return Ok(None);
        }

        let mut oracle_lock = self.oracle.lock().await;
        Ok(oracle_lock.evaluate_diagnostics(&diags))
    }
}
