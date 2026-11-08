use super::env_scrubber::EnvironmentScrubber;
use super::job_object::{PlatformJobSandbox, SandboxResourceLimits};
use super::staging::EphemeralStagingManager;
use super::validator::{ChangeValidator, ValidationReport};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Instant;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Mutex as TokioMutex;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IsolatedCommandResult {
    pub command: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u128,
    pub timed_out: bool,
    pub success: bool,
    pub memory_capped: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SandboxStatus {
    pub is_active: bool,
    pub platform: String,
    pub max_memory_mb: u64,
    pub max_cpu_percent: u32,
    pub max_active_processes: u32,
    pub active_staging_files: usize,
}

#[derive(Clone)]
pub struct IsolationEngine {
    host_workspace: PathBuf,
    staging_mgr: Arc<TokioMutex<EphemeralStagingManager>>,
    validator: ChangeValidator,
    scrubber: EnvironmentScrubber,
    limits: SandboxResourceLimits,
}

impl IsolationEngine {
    pub fn new(host_workspace: PathBuf) -> Result<Self, String> {
        let staging_mgr = Arc::new(TokioMutex::new(EphemeralStagingManager::new(host_workspace.clone())?));
        Ok(Self {
            host_workspace,
            staging_mgr,
            validator: ChangeValidator::new(),
            scrubber: EnvironmentScrubber::new(),
            limits: SandboxResourceLimits::default(),
        })
    }

    pub fn with_resource_limits(mut self, limits: SandboxResourceLimits) -> Self {
        self.limits = limits;
        self
    }

    pub fn host_workspace(&self) -> &Path {
        &self.host_workspace
    }

    /// Stages a file modification in the ephemeral staging workspace.
    pub async fn stage_write(&self, rel_path: &Path, content: &[u8]) -> Result<(), String> {
        let mut mgr = self.staging_mgr.lock().await;
        mgr.stage_write(rel_path, content)
    }

    /// Stages a file deletion in the ephemeral staging workspace.
    pub async fn stage_delete(&self, rel_path: &Path) -> Result<(), String> {
        let mut mgr = self.staging_mgr.lock().await;
        mgr.stage_deletion(rel_path)
    }

    /// Reads a file from staging (or falls back to host workspace).
    pub async fn read_staged(&self, rel_path: &Path) -> Result<Vec<u8>, String> {
        let mgr = self.staging_mgr.lock().await;
        mgr.read_file(rel_path)
    }

    /// Validates all staged mutations without modifying the host.
    pub async fn validate_staged(&self) -> ValidationReport {
        let mgr = self.staging_mgr.lock().await;
        mgr.validate(&self.validator)
    }

    /// Commits verified mutations from staging into the real physical host workspace.
    pub async fn commit_staged(&self) -> Result<ValidationReport, String> {
        let mut mgr = self.staging_mgr.lock().await;
        mgr.sync_to_host(&self.validator)
    }

    /// Discards all staged changes and purges the staging directory.
    pub async fn discard_staged(&self) -> Result<(), String> {
        let mut mgr = self.staging_mgr.lock().await;
        mgr.cleanup()
    }

    /// Returns the live sandbox status, resource caps, and platform implementation.
    pub async fn get_status(&self) -> SandboxStatus {
        let staging = self.staging_mgr.lock().await;
        let active_staging_files = staging.staged_count();
        let platform = if cfg!(target_os = "windows") {
            "Windows Job Object".to_string()
        } else {
            "Unix Process Group".to_string()
        };
        SandboxStatus {
            is_active: true,
            platform,
            max_memory_mb: self.limits.max_memory_bytes / (1024 * 1024),
            max_cpu_percent: self.limits.max_cpu_rate_percent,
            max_active_processes: self.limits.max_active_processes,
            active_staging_files,
        }
    }

    /// Executes an autonomous agent command completely inside the isolated sandbox:
    /// 1. Attached to the native Windows Job Object / process group sandbox
    /// 2. Sanitized environment with host cloud secrets stripped
    /// 3. Working directory locked to staging or host workspace (boundary checked)
    /// 4. CPU and memory resource ceilings enforced
    /// 5. Automatically terminated on timeout or kill signal
    pub async fn execute_sandboxed_command(
        &self,
        command_str: &str,
        cwd_override: Option<&Path>,
        timeout_secs: u64,
    ) -> Result<IsolatedCommandResult, String> {
        // Enforce basic policy classification first
        let classification = crate::policy::CommandClassifier::classify(command_str);
        if let crate::policy::CommandClassification::Prohibited(reason) = classification {
            return Err(format!(
                "Execution Blocked by Orbital X Safety Policy: {}",
                reason
            ));
        }

        // Strict workspace path confinement check
        let effective_cwd = if let Some(cwd) = cwd_override {
            let in_workspace = cwd.starts_with(&self.host_workspace);
            let in_staging = {
                let mgr = self.staging_mgr.lock().await;
                cwd.starts_with(mgr.staging_root())
            };
            if !in_workspace && !in_staging {
                return Err(format!(
                    "Security Boundary Violation: CWD '{}' escapes workspace boundary '{}'",
                    cwd.display(),
                    self.host_workspace.display()
                ));
            }
            cwd.to_path_buf()
        } else {
            self.host_workspace.clone()
        };

        let sanitized_env = self.scrubber.sanitize_host_environment();
        let job_sandbox = PlatformJobSandbox::new(self.limits.clone())?;

        #[cfg(target_os = "windows")]
        let mut cmd = Command::new("powershell");
        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", command_str]);
        }

        #[cfg(not(target_os = "windows"))]
        let mut cmd = Command::new("sh");
        #[cfg(not(target_os = "windows"))]
        {
            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                cmd.process_group(0);
            }
            cmd.args(["-c", command_str]);
        }

        cmd.current_dir(&effective_cwd);
        cmd.env_clear();
        cmd.envs(&sanitized_env);
        cmd.env("ORBITAL_SANDBOX_ACTIVE", "1");
        cmd.env("ORBITAL_WORKSPACE_ROOT", self.host_workspace.to_string_lossy().to_string());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let start = Instant::now();
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn sandboxed command '{}': {}", command_str, e))?;

        // Assign child process to native Job Object sandbox
        if let Err(e) = job_sandbox.assign_tokio_child(&child) {
            let _ = child.kill().await;
            return Err(format!("Security Violation: Failed to bind process to sandbox Job Object: {}", e));
        }

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

                Ok(IsolatedCommandResult {
                    command: command_str.to_string(),
                    exit_code,
                    stdout: stdout_text,
                    stderr: stderr_text,
                    duration_ms,
                    timed_out: false,
                    success,
                    memory_capped: false,
                })
            }
            Err(_) => {
                let _ = job_sandbox.terminate();
                let duration_ms = start.elapsed().as_millis();

                Ok(IsolatedCommandResult {
                    command: command_str.to_string(),
                    exit_code: None,
                    stdout: String::new(),
                    stderr: format!("Sandboxed execution timed out after {} seconds.", timeout_secs),
                    duration_ms,
                    timed_out: true,
                    success: false,
                    memory_capped: false,
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_isolation_engine_command_execution() {
        let temp_dir = std::env::temp_dir().join(format!("orbital_test_engine_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let engine = IsolationEngine::new(temp_dir.clone()).unwrap();

        #[cfg(target_os = "windows")]
        let cmd = "Write-Output 'IsolationEngine Verified'";
        #[cfg(not(target_os = "windows"))]
        let cmd = "echo 'IsolationEngine Verified'";

        let res = engine.execute_sandboxed_command(cmd, Some(&temp_dir), 10).await.unwrap();
        assert!(res.success);
        assert!(res.stdout.contains("IsolationEngine Verified"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}

