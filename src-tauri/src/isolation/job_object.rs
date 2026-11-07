use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Resource limit configurations for the isolated runner.
#[derive(Debug, Clone)]
pub struct SandboxResourceLimits {
    pub max_memory_bytes: u64,
    pub max_active_processes: u32,
    pub max_cpu_rate_percent: u32,
    pub kill_on_close: bool,
}

impl Default for SandboxResourceLimits {
    fn default() -> Self {
        Self {
            max_memory_bytes: 1536 * 1024 * 1024, // 1.5 GB
            max_active_processes: 24,
            max_cpu_rate_percent: 75, // 75% CPU cap
            kill_on_close: true,
        }
    }
}

#[cfg(target_os = "windows")]
mod win32_job {
    use super::*;
    use std::ffi::c_void;
    use std::ptr;

    #[allow(non_camel_case_types)]
    type HANDLE = *mut c_void;
    #[allow(non_camel_case_types)]
    type BOOL = i32;
    #[allow(non_camel_case_types)]
    type DWORD = u32;
    #[allow(non_camel_case_types)]
    type ULONG_PTR = usize;

    const INVALID_HANDLE_VALUE: HANDLE = -1isize as HANDLE;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: DWORD = 0x00002000;
    const JOB_OBJECT_LIMIT_ACTIVE_PROCESS: DWORD = 0x00000008;
    const JOB_OBJECT_LIMIT_JOB_MEMORY: DWORD = 0x00000200;
    const JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION: DWORD = 0x00000400;

    const JOB_OBJECT_CPU_RATE_CONTROL_ENABLE: DWORD = 0x00000001;
    const JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP: DWORD = 0x00000004;

    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;
    const JOB_OBJECT_CPU_RATE_CONTROL_INFORMATION: i32 = 15;

    #[repr(C)]
    #[allow(non_snake_case)]
    struct IO_COUNTERS {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: DWORD,
        minimum_working_set_size: ULONG_PTR,
        maximum_working_set_size: ULONG_PTR,
        active_process_limit: DWORD,
        affinity: ULONG_PTR,
        priority_class: DWORD,
        scheduling_class: DWORD,
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        basic_limit_information: JOBOBJECT_BASIC_LIMIT_INFORMATION,
        io_info: IO_COUNTERS,
        process_memory_limit: ULONG_PTR,
        job_memory_limit: ULONG_PTR,
        peak_process_memory_used: ULONG_PTR,
        peak_job_memory_used: ULONG_PTR,
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    struct JOBOBJECT_CPU_RATE_CONTROL_INFORMATION {
        control_flags: DWORD,
        cpu_rate_or_weight_or_min_rate: DWORD,
    }

    unsafe extern "system" {
        fn CreateJobObjectW(lpJobAttributes: *mut c_void, lpName: *const u16) -> HANDLE;
        fn SetInformationJobObject(
            hJob: HANDLE,
            JobObjectInformationClass: i32,
            lpJobObjectInformation: *const c_void,
            cbJobObjectInformationLength: DWORD,
        ) -> BOOL;
        fn AssignProcessToJobObject(hJob: HANDLE, hProcess: HANDLE) -> BOOL;
        fn CloseHandle(hObject: HANDLE) -> BOOL;
        fn TerminateJobObject(hJob: HANDLE, uExitCode: DWORD) -> BOOL;
    }

    pub struct WindowsJobSandbox {
        job_handle: HANDLE,
        limits: SandboxResourceLimits,
        is_terminated: Arc<AtomicBool>,
    }

    unsafe impl Send for WindowsJobSandbox {}
    unsafe impl Sync for WindowsJobSandbox {}

    impl WindowsJobSandbox {
        pub fn new(limits: SandboxResourceLimits) -> Result<Self, String> {
            let job_handle = unsafe { CreateJobObjectW(ptr::null_mut(), ptr::null()) };
            if job_handle.is_null() || job_handle == INVALID_HANDLE_VALUE {
                return Err(format!("Failed to create Windows Job Object: code {}", std::io::Error::last_os_error()));
            }

            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            let mut flags = 0;

            if limits.kill_on_close {
                flags |= JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            }
            if limits.max_active_processes > 0 {
                flags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
                info.basic_limit_information.active_process_limit = limits.max_active_processes;
            }
            if limits.max_memory_bytes > 0 {
                flags |= JOB_OBJECT_LIMIT_JOB_MEMORY;
                info.job_memory_limit = limits.max_memory_bytes as usize;
            }
            flags |= JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;

            info.basic_limit_information.limit_flags = flags;

            let res = unsafe {
                SetInformationJobObject(
                    job_handle,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                    &info as *const _ as *const c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as DWORD,
                )
            };

            if res == 0 {
                let err = std::io::Error::last_os_error();
                unsafe { CloseHandle(job_handle) };
                return Err(format!("Failed configuring Job Object extended limits: {}", err));
            }

            // CPU rate control
            if limits.max_cpu_rate_percent > 0 && limits.max_cpu_rate_percent <= 100 {
                let rate_info = JOBOBJECT_CPU_RATE_CONTROL_INFORMATION {
                    control_flags: JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP,
                    cpu_rate_or_weight_or_min_rate: limits.max_cpu_rate_percent * 100, // in 1/100ths of 1%
                };

                let _ = unsafe {
                    SetInformationJobObject(
                        job_handle,
                        JOB_OBJECT_CPU_RATE_CONTROL_INFORMATION,
                        &rate_info as *const _ as *const c_void,
                        std::mem::size_of::<JOBOBJECT_CPU_RATE_CONTROL_INFORMATION>() as DWORD,
                    )
                };
            }

            Ok(Self {
                job_handle,
                limits,
                is_terminated: Arc::new(AtomicBool::new(false)),
            })
        }

        pub fn limits(&self) -> &SandboxResourceLimits {
            &self.limits
        }

        pub fn assign_process_raw(&self, process_handle: HANDLE) -> Result<(), String> {
            let res = unsafe { AssignProcessToJobObject(self.job_handle, process_handle) };
            if res == 0 {
                return Err(format!(
                    "Failed to assign process to Job Object sandbox: {}",
                    std::io::Error::last_os_error()
                ));
            }
            Ok(())
        }

        #[cfg(windows)]
        pub fn assign_child_process(&self, child: &std::process::Child) -> Result<(), String> {
            use std::os::windows::io::AsRawHandle;
            self.assign_process_raw(child.as_raw_handle() as HANDLE)
        }

        #[cfg(windows)]
        pub fn assign_tokio_child(&self, child: &tokio::process::Child) -> Result<(), String> {
            if let Some(raw_handle) = child.raw_handle() {
                self.assign_process_raw(raw_handle as HANDLE)
            } else {
                Err("Tokio child process does not possess a valid Windows handle".into())
            }
        }

        pub fn terminate(&self) -> Result<(), String> {
            self.is_terminated.store(true, Ordering::SeqCst);
            let res = unsafe { TerminateJobObject(self.job_handle, 1) };
            if res == 0 {
                return Err(format!("Failed terminating Job Object: {}", std::io::Error::last_os_error()));
            }
            Ok(())
        }
    }

    impl Drop for WindowsJobSandbox {
        fn drop(&mut self) {
            if !self.job_handle.is_null() && self.job_handle != INVALID_HANDLE_VALUE {
                unsafe {
                    if self.limits.kill_on_close {
                        let _ = TerminateJobObject(self.job_handle, 1);
                    }
                    CloseHandle(self.job_handle);
                }
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub use win32_job::WindowsJobSandbox as PlatformJobSandbox;

#[cfg(not(target_os = "windows"))]
mod unix_job {
    use super::*;

    pub struct UnixProcessSandbox {
        limits: SandboxResourceLimits,
        is_terminated: Arc<AtomicBool>,
    }

    impl UnixProcessSandbox {
        pub fn new(limits: SandboxResourceLimits) -> Result<Self, String> {
            Ok(Self {
                limits,
                is_terminated: Arc::new(AtomicBool::new(false)),
            })
        }

        pub fn assign_tokio_child(&self, _child: &tokio::process::Child) -> Result<(), String> {
            // On Unix, process groups and setpgid/prctl are applied during Command spawn pre_exec
            Ok(())
        }

        pub fn terminate(&self) -> Result<(), String> {
            self.is_terminated.store(true, Ordering::SeqCst);
            Ok(())
        }
    }

    impl Drop for UnixProcessSandbox {
        fn drop(&mut self) {
            let _ = self.terminate();
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub use unix_job::UnixProcessSandbox as PlatformJobSandbox;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_platform_job_creation_and_termination() {
        let limits = SandboxResourceLimits::default();
        let sandbox = PlatformJobSandbox::new(limits);
        assert!(sandbox.is_ok(), "Sandbox creation should succeed");

        let s = sandbox.unwrap();
        let _ = s.terminate();
    }
}

