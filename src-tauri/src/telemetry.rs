use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareTelemetry {
    pub cpu_percent: f32,
    pub ram_total_mb: u64,
    pub ram_used_mb: u64,
    pub ram_free_mb: u64,
    pub ram_percent: f32,
    pub vram_total_mb: u64,
    pub vram_used_mb: u64,
    pub vram_free_mb: u64,
    pub vram_percent: f32,
    pub active_model_vram_mb: u64,
    pub active_model_name: String,
    pub tokens_per_second: f32,
    pub gpu_name: String,
    pub timestamp_ms: u64,
}

struct TokenRecord {
    count: usize,
    at: Instant,
}

static TOKEN_COUNTER: Mutex<Option<Vec<TokenRecord>>> = Mutex::new(None);
static LAST_KNOWN_TPS: AtomicUsize = AtomicUsize::new(0); // scaled by 10 (e.g. 850 = 85.0 TPS)

pub fn record_tokens_generated(count: usize) {
    if count == 0 {
        return;
    }
    let now = Instant::now();
    let mut guard = match TOKEN_COUNTER.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    let records = guard.get_or_insert_with(Vec::new);
    records.push(TokenRecord { count, at: now });

    // Retain records from the last 4 seconds
    let cutoff = now.checked_sub(Duration::from_secs(4)).unwrap_or(now);
    records.retain(|r| r.at >= cutoff);

    // Calculate TPS
    if records.len() >= 2 {
        let first = records.first().unwrap();
        let total_tokens: usize = records.iter().map(|r| r.count).sum();
        let elapsed_secs = now.duration_since(first.at).as_secs_f32().max(0.1);
        let tps = (total_tokens as f32) / elapsed_secs;
        LAST_KNOWN_TPS.store((tps * 10.0) as usize, Ordering::Relaxed);
    } else {
        LAST_KNOWN_TPS.store((count as f32 * 10.0) as usize, Ordering::Relaxed);
    }
}

pub fn get_current_tps() -> f32 {
    let now = Instant::now();
    let mut guard = match TOKEN_COUNTER.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(records) = guard.as_mut() {
        let cutoff = now.checked_sub(Duration::from_secs(3)).unwrap_or(now);
        records.retain(|r| r.at >= cutoff);
        if records.is_empty() {
            LAST_KNOWN_TPS.store(0, Ordering::Relaxed);
            return 0.0;
        }
    } else {
        return 0.0;
    }
    (LAST_KNOWN_TPS.load(Ordering::Relaxed) as f32) / 10.0
}

pub async fn sample_hardware_telemetry(ollama_url: Option<String>) -> HardwareTelemetry {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.refresh_cpu_usage();

    // Give a brief yield so CPU delta is meaningful
    tokio::time::sleep(Duration::from_millis(50)).await;
    sys.refresh_cpu_usage();

    let cpu_percent: f32 = sys.global_cpu_info().cpu_usage().clamp(0.0, 100.0);
    let total_bytes = sys.total_memory();
    let used_bytes = sys.used_memory();
    let free_bytes = sys.free_memory();

    let ram_total_mb = total_bytes / (1024 * 1024);
    let ram_used_mb = used_bytes / (1024 * 1024);
    let ram_free_mb = free_bytes / (1024 * 1024);
    let ram_percent = if total_bytes > 0 {
        ((used_bytes as f64 / total_bytes as f64) * 100.0) as f32
    } else {
        0.0
    };

    // GPU detection
    let (gpu_name, vram_total_mb) = detect_primary_gpu_info();

    // Query active Ollama model memory allocation via /api/ps
    let (active_model_name, active_model_vram_mb) = query_ollama_running_memory(ollama_url).await;

    let vram_used_mb = active_model_vram_mb;
    let vram_free_mb = vram_total_mb.saturating_sub(vram_used_mb);
    let vram_percent = if vram_total_mb > 0 {
        ((vram_used_mb as f32 / vram_total_mb as f32) * 100.0).min(100.0)
    } else {
        0.0
    };

    let tps = get_current_tps();
    let now_ms = chrono::Utc::now().timestamp_millis() as u64;

    HardwareTelemetry {
        cpu_percent,
        ram_total_mb,
        ram_used_mb,
        ram_free_mb,
        ram_percent,
        vram_total_mb,
        vram_used_mb,
        vram_free_mb,
        vram_percent,
        active_model_vram_mb,
        active_model_name,
        tokens_per_second: tps,
        gpu_name,
        timestamp_ms: now_ms,
    }
}

#[cfg(windows)]
fn detect_primary_gpu_info() -> (String, u64) {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let class_path = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}";
    if let Ok(class) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(class_path) {
        for idx in 0..=16 {
            if let Ok(sub) = class.open_subkey(format!("{:04}", idx)) {
                let name: Option<String> = sub.get_value("DriverDesc").ok();
                let vram_bytes: Option<u64> = sub
                    .open_subkey("HardwareInformation")
                    .ok()
                    .and_then(|hw| hw.get_value("qwMemorySize").ok());
                if let Some(n) = name {
                    if !n.is_empty() {
                        let mb = vram_bytes.map(|b| b / (1024 * 1024)).unwrap_or(0);
                        return (n, mb);
                    }
                }
            }
        }
    }
    ("Generic GPU".into(), 0)
}

#[cfg(not(windows))]
fn detect_primary_gpu_info() -> (String, u64) {
    ("System Graphics".into(), 0)
}

async fn query_ollama_running_memory(url: Option<String>) -> (String, u64) {
    let endpoint = format!("{}/api/ps", url.unwrap_or_else(|| "http://localhost:11434".into()).trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(600))
        .build();

    if let Ok(c) = client {
        if let Ok(resp) = c.get(&endpoint).send().await {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(arr) = json.get("models").and_then(|m| m.as_array()) {
                        if let Some(first) = arr.first() {
                            let name = first.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                            let vram_bytes = first
                                .get("size_vram")
                                .and_then(|v| v.as_u64())
                                .or_else(|| first.get("size").and_then(|s| s.as_u64()))
                                .unwrap_or(0);
                            return (name, vram_bytes / (1024 * 1024));
                        }
                    }
                }
            }
        }
    }
    ("None (Idle)".into(), 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_meter_tracking() {
        record_tokens_generated(15);
        let tps = get_current_tps();
        assert!(tps >= 0.0);
    }

    #[test]
    fn test_telemetry_struct_serialization() {
        let sample = HardwareTelemetry {
            cpu_percent: 15.5,
            ram_total_mb: 16384,
            ram_used_mb: 8192,
            ram_free_mb: 8192,
            ram_percent: 50.0,
            vram_total_mb: 8192,
            vram_used_mb: 3200,
            vram_free_mb: 4992,
            vram_percent: 39.0,
            active_model_vram_mb: 3200,
            active_model_name: "qwen2.5-coder:7b".into(),
            tokens_per_second: 42.5,
            gpu_name: "NVIDIA GeForce RTX".into(),
            timestamp_ms: 1730628000000,
        };
        let json = serde_json::to_string(&sample).unwrap();
        assert!(json.contains("qwen2.5-coder:7b"));
        assert!(json.contains("tokensPerSecond"));
    }
}
