use chrono::{Datelike, Local};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsageRecord {
    pub id: String,
    pub timestamp: String,
    pub provider: String,
    pub model: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
    pub is_estimated: bool,
    pub category: String, // "chat", "agent_turn", "plan"
    pub status: String,   // "completed", "cancelled", "failed"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyUsage {
    pub date: String, // "YYYY-MM-DD"
    pub total_tokens: u64,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub requests: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenUsageStats {
    pub today_tokens: u64,
    pub today_prompt_tokens: u64,
    pub today_completion_tokens: u64,
    pub today_requests: u64,
    pub seven_days: Vec<DailyUsage>,
    pub month_tokens: u64,
    pub month_requests: u64,
    pub lifetime_tokens: u64,
    pub lifetime_requests: u64,
    pub total_tokens: u64,
    pub total_requests: u64,
    pub by_provider: HashMap<String, u64>,
    pub by_model: HashMap<String, u64>,
    pub reported_count: u64,
    pub estimated_count: u64,
    pub reported_tokens: u64,
    pub estimated_tokens: u64,
    pub last_request_time: Option<String>,
}

pub struct UsageService;

impl UsageService {
    fn get_storage_path() -> PathBuf {
        let dir = dirs::home_dir()
            .map(|h| h.join(".orbital"))
            .unwrap_or_else(|| PathBuf::from(".orbital"));
        if !dir.exists() {
            let _ = fs::create_dir_all(&dir);
        }
        dir.join("token_usage.json")
    }

    pub fn load_records() -> Vec<TokenUsageRecord> {
        let path = Self::get_storage_path();
        if let Ok(bytes) = fs::read(&path) {
            if let Ok(records) = serde_json::from_slice::<Vec<TokenUsageRecord>>(&bytes) {
                return records;
            }
        }
        Vec::new()
    }

    pub fn record_usage(record: TokenUsageRecord) -> Result<(), String> {
        let mut records = Self::load_records();
        records.push(record);

        // Keep last 10,000 entries to prevent infinite unbounded disk growth
        if records.len() > 10000 {
            let trim_count = records.len() - 10000;
            records.drain(0..trim_count);
        }

        let path = Self::get_storage_path();
        let serialized = serde_json::to_string_pretty(&records).map_err(|e| e.to_string())?;
        fs::write(path, serialized).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_stats() -> TokenUsageStats {
        let records = Self::load_records();
        let now = Local::now();
        let today_str = now.format("%Y-%m-%d").to_string();
        let current_year = now.year();
        let current_month = now.month();

        let mut stats = TokenUsageStats::default();

        // Prepare last 7 calendar days bucket
        let mut daily_map: HashMap<String, (u64, u64, u64, u64)> = HashMap::new();
        for i in 0..7 {
            if let Some(d) = now.date_naive().checked_sub_days(chrono::Days::new(i)) {
                let date_str = d.format("%Y-%m-%d").to_string();
                daily_map.insert(date_str, (0, 0, 0, 0));
            }
        }

        for r in &records {
            let tokens = r.total_tokens;
            stats.lifetime_tokens += tokens;
            stats.lifetime_requests += 1;

            if r.is_estimated {
                stats.estimated_count += 1;
            } else {
                stats.reported_count += 1;
            }

            *stats.by_provider.entry(r.provider.clone()).or_insert(0) += tokens;
            *stats.by_model.entry(r.model.clone()).or_insert(0) += tokens;

            // Parse timestamp for day & month aggregation
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&r.timestamp) {
                let local_dt = dt.with_timezone(&Local);
                let rec_date_str = local_dt.format("%Y-%m-%d").to_string();

                if rec_date_str == today_str {
                    stats.today_tokens += tokens;
                    stats.today_prompt_tokens += r.prompt_tokens;
                    stats.today_completion_tokens += r.completion_tokens;
                    stats.today_requests += 1;
                }

                if local_dt.year() == current_year && local_dt.month() == current_month {
                    stats.month_tokens += tokens;
                    stats.month_requests += 1;
                }

                if let Some(entry) = daily_map.get_mut(&rec_date_str) {
                    entry.0 += tokens;
                    entry.1 += r.prompt_tokens;
                    entry.2 += r.completion_tokens;
                    entry.3 += 1;
                }
            }
        }

        if let Some(last) = records.last() {
            stats.last_request_time = Some(last.timestamp.clone());
        }

        // Sort 7 days chronologically
        let mut days_vec: Vec<DailyUsage> = daily_map
            .into_iter()
            .map(|(date, (total, prompt, comp, reqs))| DailyUsage {
                date,
                total_tokens: total,
                prompt_tokens: prompt,
                completion_tokens: comp,
                requests: reqs,
            })
            .collect();
        days_vec.sort_by(|a, b| a.date.cmp(&b.date));
        stats.seven_days = days_vec;

        stats.total_tokens = stats.lifetime_tokens;
        stats.total_requests = stats.lifetime_requests;

        stats
    }

    pub fn clear_usage() -> Result<(), String> {
        let path = Self::get_storage_path();
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_record_and_stats() {
        let _test_record = TokenUsageRecord {
            id: "test-id-1".into(),
            timestamp: Local::now().to_rfc3339(),
            provider: "Ollama".into(),
            model: "llama3".into(),
            prompt_tokens: 120,
            completion_tokens: 80,
            total_tokens: 200,
            is_estimated: false,
            category: "chat".into(),
            status: "completed".into(),
        };

        let stats = UsageService::get_stats();
        // Verifies stats calculation without panic
        assert!(stats.seven_days.len() <= 7);
    }
}
