use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex as TokioMutex;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractiveSessionInfo {
    pub id: String,
    pub name: String,
    pub shell: String,
    pub cwd: String,
    pub is_alive: bool,
}

pub struct ActiveSession {
    pub id: String,
    pub name: String,
    pub shell: String,
    pub cwd: String,
    pub stdin: Arc<TokioMutex<Option<ChildStdin>>>,
    pub output_buffer: Arc<TokioMutex<Vec<u8>>>,
    pub child: Arc<TokioMutex<Option<Child>>>,
    pub is_alive: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct InteractiveTerminalManager {
    sessions: TokioMutex<HashMap<String, ActiveSession>>,
}

impl InteractiveTerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: TokioMutex::new(HashMap::new()),
        }
    }

    pub async fn create_session(
        &self,
        session_id_opt: Option<String>,
        name: Option<String>,
        cwd: Option<String>,
        shell_override: Option<String>,
    ) -> Result<InteractiveSessionInfo, String> {
        let session_id = session_id_opt.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let session_name = name.unwrap_or_else(|| "powershell".to_string());
        let effective_cwd = cwd.unwrap_or_else(|| {
            dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| ".".into())
        });

        #[cfg(target_os = "windows")]
        let shell_cmd = shell_override.unwrap_or_else(|| "powershell.exe".to_string());
        #[cfg(not(target_os = "windows"))]
        let shell_cmd = shell_override.unwrap_or_else(|| "sh".to_string());

        let mut cmd = Command::new(&shell_cmd);
        #[cfg(target_os = "windows")]
        {
            cmd.creation_flags(CREATE_NO_WINDOW);
            if shell_cmd.contains("powershell") {
                cmd.args(["-NoLogo"]);
            }
        }

        cmd.current_dir(&effective_cwd);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn shell '{}': {}", shell_cmd, e))?;

        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let output_buffer = Arc::new(TokioMutex::new(Vec::<u8>::new()));
        let is_alive = Arc::new(AtomicBool::new(true));

        if let Some(mut stream) = stdout {
            let buf = Arc::clone(&output_buffer);
            let alive = Arc::clone(&is_alive);
            tokio::spawn(async move {
                let mut temp = [0u8; 1024];
                while alive.load(Ordering::Relaxed) {
                    match stream.read(&mut temp).await {
                        Ok(n) if n > 0 => {
                            let mut lock = buf.lock().await;
                            lock.extend_from_slice(&temp[..n]);
                        }
                        _ => break,
                    }
                }
                alive.store(false, Ordering::Relaxed);
            });
        }

        if let Some(mut stream) = stderr {
            let buf = Arc::clone(&output_buffer);
            let alive = Arc::clone(&is_alive);
            tokio::spawn(async move {
                let mut temp = [0u8; 1024];
                while alive.load(Ordering::Relaxed) {
                    match stream.read(&mut temp).await {
                        Ok(n) if n > 0 => {
                            let mut lock = buf.lock().await;
                            lock.extend_from_slice(&temp[..n]);
                        }
                        _ => break,
                    }
                }
            });
        }

        let session = ActiveSession {
            id: session_id.clone(),
            name: session_name.clone(),
            shell: shell_cmd.clone(),
            cwd: effective_cwd.clone(),
            stdin: Arc::new(TokioMutex::new(stdin)),
            output_buffer,
            child: Arc::new(TokioMutex::new(Some(child))),
            is_alive,
        };

        let mut lock = self.sessions.lock().await;
        lock.insert(session_id.clone(), session);

        Ok(InteractiveSessionInfo {
            id: session_id,
            name: session_name,
            shell: shell_cmd,
            cwd: effective_cwd,
            is_alive: true,
        })
    }

    pub async fn write_input(&self, session_id: &str, input: &str) -> Result<(), String> {
        let lock = self.sessions.lock().await;
        let session = lock
            .get(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;

        let mut stdin_lock = session.stdin.lock().await;
        if let Some(stdin) = stdin_lock.as_mut() {
            stdin
                .write_all(input.as_bytes())
                .await
                .map_err(|e| format!("Failed to write to terminal stdin: {}", e))?;
            stdin
                .flush()
                .await
                .map_err(|e| format!("Failed to flush terminal stdin: {}", e))?;
            Ok(())
        } else {
            Err("Terminal stdin is not open".into())
        }
    }

    pub async fn poll_output(&self, session_id: &str) -> Result<String, String> {
        let lock = self.sessions.lock().await;
        let session = lock
            .get(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;

        let mut buf_lock = session.output_buffer.lock().await;
        let bytes = std::mem::take(&mut *buf_lock);
        Ok(String::from_utf8_lossy(&bytes).to_string())
    }

    pub async fn close_session(&self, session_id: &str) -> Result<(), String> {
        let mut lock = self.sessions.lock().await;
        if let Some(session) = lock.remove(session_id) {
            session.is_alive.store(false, Ordering::SeqCst);
            let mut child_lock = session.child.lock().await;
            if let Some(mut child) = child_lock.take() {
                let _ = child.kill().await;
            }
        }
        Ok(())
    }

    pub async fn list_sessions(&self) -> Vec<InteractiveSessionInfo> {
        let lock = self.sessions.lock().await;
        lock.values()
            .map(|s| InteractiveSessionInfo {
                id: s.id.clone(),
                name: s.name.clone(),
                shell: s.shell.clone(),
                cwd: s.cwd.clone(),
                is_alive: s.is_alive.load(Ordering::Relaxed),
            })
            .collect()
    }
}

pub struct TerminalService;

impl TerminalService {
    /// Shared one-shot process execution with timeout. Callers prepare the
    /// Command; safety classification is the caller's responsibility.
    async fn execute_prepared(
        mut cmd: Command,
        display: &str,
        timeout_secs: u64,
    ) -> Result<CommandResult, String> {
        let start = Instant::now();
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn process: {}", e))?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let timeout_duration = std::time::Duration::from_secs(timeout_secs);

        let execution = async {
            let mut out_str = String::new();
            let mut err_str = String::new();

            // Read both pipes concurrently to avoid the classic pipe-buffer
            // deadlock when a child writes heavily to stderr while stdout is open.
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
                    command: display.to_string(),
                    exit_code,
                    stdout: stdout_text,
                    stderr: stderr_text,
                    duration_ms,
                    timed_out: false,
                    success,
                })
            }
            Err(_) => {
                let _ = child.kill().await;
                let duration_ms = start.elapsed().as_millis();

                Ok(CommandResult {
                    command: display.to_string(),
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

    /// Safe one-shot execution used by Agent tools (with policy inspection and timeouts)
    pub async fn run_command(
        command_str: &str,
        cwd: &str,
        timeout_secs: u64,
    ) -> Result<CommandResult, String> {
        // Safety check: block explicitly prohibited, elevated or system-destroying commands
        let classification = crate::policy::CommandClassifier::classify(command_str);
        if let crate::policy::CommandClassification::Prohibited(reason) = classification {
            return Err(format!("Execution Blocked: Destructive command detected by Orbital X safety policy ({}).", reason));
        }

        #[cfg(target_os = "windows")]
        let mut cmd = Command::new("powershell");
        #[cfg(target_os = "windows")]
        {
            cmd.creation_flags(CREATE_NO_WINDOW);
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", command_str]);
        }

        #[cfg(not(target_os = "windows"))]
        let mut cmd = Command::new("sh");
        #[cfg(not(target_os = "windows"))]
        cmd.args(["-c", command_str]);

        cmd.current_dir(cwd);
        Self::execute_prepared(cmd, command_str, timeout_secs).await
    }

    /// Runs git with an argument array — never through a shell. Commit
    /// messages, branch names and paths are passed as single argv entries, so
    /// they can never inject shell syntax. The policy layer still gates the
    /// calling tool (git_commit requires approval); this removes the injection
    /// path that string interpolation used to have.
    pub async fn run_git(
        args: &[&str],
        cwd: &str,
        timeout_secs: u64,
    ) -> Result<CommandResult, String> {
        let mut cmd = Command::new("git");
        cmd.args(args);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.current_dir(cwd);
        let display = format!("git {}", args.join(" "));
        Self::execute_prepared(cmd, &display, timeout_secs).await
    }
}
