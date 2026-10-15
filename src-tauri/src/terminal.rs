use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::time::Instant;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandResult {
    pub command: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u128,
    pub timed_out: bool,
    pub success: bool,
}

pub struct TerminalService;

impl TerminalService {
    pub async fn run_command(
        command_str: &str,
        cwd: &str,
        timeout_secs: u64,
    ) -> Result<CommandResult, String> {
        let start = Instant::now();

        // Safety check: block explicitly elevated or system-destroying commands
        let lower = command_str.to_lowercase();
        if lower.contains("format ") || lower.contains("rmdir /s /q c:") || lower.contains("del /f /s /q c:") {
            return Err("Execution Blocked: Destructive command detected by Orbital X safety policy.".into());
        }

        #[cfg(target_os = "windows")]
        let mut cmd = Command::new("powershell");
        #[cfg(target_os = "windows")]
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", command_str]);

        #[cfg(not(target_os = "windows"))]
        let mut cmd = Command::new("sh");
        #[cfg(not(target_os = "windows"))]
        cmd.args(["-c", command_str]);

        cmd.current_dir(cwd);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn process: {}", e))?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let timeout_duration = std::time::Duration::from_secs(timeout_secs);

        let execution = async {
            let mut out_str = String::new();
            let mut err_str = String::new();

            if let Some(mut stream) = stdout {
                let mut buf = Vec::new();
                let _ = stream.read_to_end(&mut buf).await;
                out_str = String::from_utf8_lossy(&buf).to_string();
            }

            if let Some(mut stream) = stderr {
                let mut buf = Vec::new();
                let _ = stream.read_to_end(&mut buf).await;
                err_str = String::from_utf8_lossy(&buf).to_string();
            }

            let status = child.wait().await;
            (status, out_str, err_str)
        };

        match tokio::time::timeout(timeout_duration, execution).await {
            Ok((status_res, stdout_text, stderr_text)) => {
                let duration_ms = start.elapsed().as_millis();
                let exit_code = match status_res {
                    Ok(s) => s.code(),
                    Err(_) => None,
                };
                let success = exit_code == Some(0);

                Ok(CommandResult {
                    command: command_str.to_string(),
                    exit_code,
                    stdout: stdout_text,
                    stderr: stderr_text,
                    duration_ms,
                    timed_out: false,
                    success,
                })
            }
            Err(_) => {
                // Timeout reached, kill process
                let _ = child.kill().await;
                let duration_ms = start.elapsed().as_millis();

                Ok(CommandResult {
                    command: command_str.to_string(),
                    exit_code: None,
                    stdout: String::new(),
                    stderr: format!("Process timed out after {} seconds.", timeout_secs),
                    duration_ms,
                    timed_out: true,
                    success: false,
                })
            }
        }
    }
}
