use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String, // "system", "user", "assistant", "tool"
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
    pub is_estimated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderResponse {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
    pub finish_reason: Option<String>,
    pub usage: Option<TokenUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics: Option<GenMetrics>,
    /// True when the turn ended because the user cancelled it.
    #[serde(default)]
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionTestResult {
    pub success: bool,
    pub provider: String,
    pub message: String,
    pub models_available: Vec<String>,
}

/// Per-request inference options supplied by the frontend (user settings +
/// model-aware defaults). All fields optional; providers apply what they support.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DispatchOptions {
    /// Context window size for local models (Ollama num_ctx). None = let the
    /// frontend resolve a model-aware default before sending.
    pub num_ctx: Option<u64>,
    /// Ollama keep-alive duration ("5m", "30m", "2h", "forever"). None = "30m".
    pub keep_alive: Option<String>,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    /// Cap on generated tokens per turn (Ollama num_predict / OpenAI max_tokens).
    pub num_predict: Option<u64>,
}

/// Generation performance metrics captured from the provider response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenMetrics {
    pub tokens_per_second: Option<f64>,
    pub prompt_tokens_per_second: Option<f64>,
    pub total_duration_ms: Option<u64>,
    pub load_duration_ms: Option<u64>,
}

pub struct ProviderService;

impl ProviderService {
    pub async fn test_connection(
        provider: &str,
        api_key: &str,
        model: &str,
        base_url: Option<String>,
    ) -> ConnectionTestResult {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap_or_default();

        match provider.to_lowercase().as_str() {
            "ollama" => {
                let url = base_url.unwrap_or_else(|| "http://localhost:11434".into());
                let tags_endpoint = format!("{}/api/tags", url.trim_end_matches('/'));

                match client.get(&tags_endpoint).send().await {
                    Ok(resp) => {
                        if resp.status().is_success() {
                            let json: serde_json::Value = resp.json().await.unwrap_or_default();
                            let mut models = Vec::new();
                            if let Some(list) = json.get("models").and_then(|m| m.as_array()) {
                                for m in list {
                                    if let Some(name) = m.get("name").and_then(|n| n.as_str()) {
                                        models.push(name.to_string());
                                    }
                                }
                            }
                            ConnectionTestResult {
                                success: true,
                                provider: "Ollama (Local)".into(),
                                message: format!("Connected to Ollama! Found {} local models.", models.len()),
                                models_available: models,
                            }
                        } else {
                            ConnectionTestResult {
                                success: false,
                                provider: "Ollama (Local)".into(),
                                message: format!("Ollama returned HTTP error: {}", resp.status()),
                                models_available: vec![],
                            }
                        }
                    }
                    Err(e) => ConnectionTestResult {
                        success: false,
                        provider: "Ollama (Local)".into(),
                        message: format!("Could not reach Ollama at {}. Is Ollama running? Error: {}", url, e),
                        models_available: vec![],
                    },
                }
            }

            "anthropic" => {
                if api_key.trim().is_empty() {
                    return ConnectionTestResult {
                        success: false,
                        provider: "Anthropic Claude".into(),
                        message: "API key is empty".into(),
                        models_available: vec![],
                    };
                }

                let target_model = if model.is_empty() { "claude-3-5-sonnet-20241022" } else { model };
                let body = serde_json::json!({
                    "model": target_model,
                    "max_tokens": 10,
                    "messages": [{"role": "user", "content": "ping"}]
                });

                match client
                    .post("https://api.anthropic.com/v1/messages")
                    .header("x-api-key", api_key.trim())
                    .header("anthropic-version", "2023-06-01")
                    .header("content-type", "application/json")
                    .json(&body)
                    .send()
                    .await
                {
                    Ok(resp) => {
                        let status = resp.status();
                        if status.is_success() {
                            ConnectionTestResult {
                                success: true,
                                provider: "Anthropic Claude".into(),
                                message: format!("Successfully verified Anthropic API key with {}", target_model),
                                models_available: vec![
                                    "claude-3-7-sonnet-20250219".into(),
                                    "claude-3-5-sonnet-20241022".into(),
                                    "claude-3-5-haiku-20241022".into(),
                                ],
                            }
                        } else {
                            let text = resp.text().await.unwrap_or_default();
                            ConnectionTestResult {
                                success: false,
                                provider: "Anthropic Claude".into(),
                                message: format!("Anthropic API error ({}): {}", status, text),
                                models_available: vec![],
                            }
                        }
                    }
                    Err(e) => ConnectionTestResult {
                        success: false,
                        provider: "Anthropic Claude".into(),
                        message: format!("Network error connecting to Anthropic: {}", e),
                        models_available: vec![],
                    },
                }
            }

            "openai" => {
                if api_key.trim().is_empty() {
                    return ConnectionTestResult {
                        success: false,
                        provider: "OpenAI".into(),
                        message: "API key is empty".into(),
                        models_available: vec![],
                    };
                }

                let target_model = if model.is_empty() { "gpt-4o" } else { model };
                let body = serde_json::json!({
                    "model": target_model,
                    "max_tokens": 10,
                    "messages": [{"role": "user", "content": "ping"}]
                });

                let endpoint = base_url.unwrap_or_else(|| "https://api.openai.com/v1/chat/completions".into());

                match client
                    .post(&endpoint)
                    .header("Authorization", format!("Bearer {}", api_key.trim()))
                    .json(&body)
                    .send()
                    .await
                {
                    Ok(resp) => {
                        let status = resp.status();
                        if status.is_success() {
                            ConnectionTestResult {
                                success: true,
                                provider: "OpenAI".into(),
                                message: format!("Successfully verified OpenAI API key with {}", target_model),
                                models_available: vec![
                                    "gpt-4o".into(),
                                    "gpt-4o-mini".into(),
                                    "o3-mini".into(),
                                    "o1".into(),
                                ],
                            }
                        } else {
                            let text = resp.text().await.unwrap_or_default();
                            ConnectionTestResult {
                                success: false,
                                provider: "OpenAI".into(),
                                message: format!("OpenAI API error ({}): {}", status, text),
                                models_available: vec![],
                            }
                        }
                    }
                    Err(e) => ConnectionTestResult {
                        success: false,
                        provider: "OpenAI".into(),
                        message: format!("Network error connecting to OpenAI: {}", e),
                        models_available: vec![],
                    },
                }
            }

            "gemini" => {
                if api_key.trim().is_empty() {
                    return ConnectionTestResult {
                        success: false,
                        provider: "Google Gemini".into(),
                        message: "API key is empty".into(),
                        models_available: vec![],
                    };
                }

                let target_model = if model.is_empty() { "gemini-2.0-flash" } else { model };
                let endpoint = format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                    target_model,
                    api_key.trim()
                );

                let body = serde_json::json!({
                    "contents": [{
                        "parts": [{"text": "ping"}]
                    }]
                });

                match client.post(&endpoint).json(&body).send().await {
                    Ok(resp) => {
                        let status = resp.status();
                        if status.is_success() {
                            ConnectionTestResult {
                                success: true,
                                provider: "Google Gemini".into(),
                                message: format!("Successfully verified Gemini API key with {}", target_model),
                                models_available: vec![
                                    "gemini-2.5-pro".into(),
                                    "gemini-2.5-flash".into(),
                                    "gemini-2.0-flash".into(),
                                ],
                            }
                        } else {
                            let text = resp.text().await.unwrap_or_default();
                            ConnectionTestResult {
                                success: false,
                                provider: "Google Gemini".into(),
                                message: format!("Gemini API error ({}): {}", status, text),
                                models_available: vec![],
                            }
                        }
                    }
                    Err(e) => ConnectionTestResult {
                        success: false,
                        provider: "Google Gemini".into(),
                        message: format!("Network error connecting to Gemini: {}", e),
                        models_available: vec![],
                    },
                }
            }

            _ => ConnectionTestResult {
                success: false,
                provider: provider.into(),
                message: format!("Unknown provider: {}", provider),
                models_available: vec![],
            },
        }
    }

    /// Sends a prompt and tools to the chosen provider and standardizes the response
    pub async fn dispatch_turn(
        provider: &str,
        api_key: &str,
        model: &str,
        base_url: Option<String>,
        messages: Vec<ChatMessage>,
        tools_def: serde_json::Value,
        options: &DispatchOptions,
    ) -> Result<ProviderResponse, String> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300)) // 5 min for local Ollama cold starts
            .build()
            .unwrap_or_default();

        match provider.to_lowercase().as_str() {
            "ollama" => {
                let url = base_url.unwrap_or_else(|| "http://localhost:11434".into());
                let chat_endpoint = format!("{}/api/chat", url.trim_end_matches('/'));
                let payload = build_ollama_payload(model, &messages, tools_def, options, false);

                let resp = client
                    .post(&chat_endpoint)
                    .json(&payload)
                    .send()
                    .await
                    .map_err(|e| format!("Ollama request failed: {}", e))?;

                if !resp.status().is_success() {
                    let err = resp.text().await.unwrap_or_default();
                    return Err(format!("Ollama error: {}", err));
                }

                let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
                Ok(parse_ollama_response(&json, &messages))
            }

            "openai" => {
                let endpoint = base_url.unwrap_or_else(|| "https://api.openai.com/v1/chat/completions".into());

                let mut openai_msgs: Vec<serde_json::Value> = Vec::new();
                for m in &messages {
                    if m.role == "tool" {
                        openai_msgs.push(serde_json::json!({
                            "role": "tool",
                            "tool_call_id": m.tool_call_id.clone().unwrap_or_default(),
                            "content": m.content
                        }));
                    } else if let Some(calls) = &m.tool_calls {
                        let calls_json: Vec<serde_json::Value> = calls
                            .iter()
                            .map(|c| {
                                serde_json::json!({
                                    "id": c.id,
                                    "type": "function",
                                    "function": {
                                        "name": c.name,
                                        "arguments": c.arguments.to_string()
                                    }
                                })
                            })
                            .collect();
                        openai_msgs.push(serde_json::json!({
                            "role": "assistant",
                            "content": m.content,
                            "tool_calls": calls_json
                        }));
                    } else {
                        openai_msgs.push(serde_json::json!({
                            "role": m.role,
                            "content": m.content
                        }));
                    }
                }

                let mut payload = serde_json::json!({
                    "model": if model.is_empty() { "gpt-4o" } else { model },
                    "messages": openai_msgs
                });
                if let Some(t) = options.temperature {
                    payload["temperature"] = serde_json::json!(t);
                }
                if let Some(np) = options.num_predict {
                    payload["max_tokens"] = serde_json::json!(np);
                }

                if let Some(arr) = tools_def.as_array() {
                    if !arr.is_empty() {
                        payload["tools"] = tools_def.clone();
                    }
                }

                let resp = client
                    .post(&endpoint)
                    .header("Authorization", format!("Bearer {}", api_key.trim()))
                    .json(&payload)
                    .send()
                    .await
                    .map_err(|e| format!("OpenAI request failed: {}", e))?;

                if !resp.status().is_success() {
                    let err = resp.text().await.unwrap_or_default();
                    return Err(format!("OpenAI error: {}", err));
                }

                let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
                let choice = json.get("choices").and_then(|c| c.as_array()).and_then(|arr| arr.first());
                let msg = choice.and_then(|c| c.get("message"));

                let content = msg
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str())
                    .unwrap_or_default()
                    .to_string();

                let mut tool_calls = Vec::new();
                if let Some(calls) = msg.and_then(|m| m.get("tool_calls")).and_then(|c| c.as_array()) {
                    for call in calls {
                        let id = call.get("id").and_then(|i| i.as_str()).unwrap_or_default().to_string();
                        if let Some(func) = call.get("function") {
                            let name = func.get("name").and_then(|n| n.as_str()).unwrap_or_default().to_string();
                            let raw_args = func.get("arguments").and_then(|a| a.as_str()).unwrap_or("{}");
                            let parsed_args: serde_json::Value = serde_json::from_str(raw_args).unwrap_or(serde_json::json!({}));
                            tool_calls.push(ToolCall {
                                id,
                                name,
                                arguments: parsed_args,
                            });
                        }
                    }
                }

                let finish_reason = choice
                    .and_then(|c| c.get("finish_reason"))
                    .and_then(|r| r.as_str())
                    .map(|s| s.to_string());

                let usage = json.get("usage").map(|u| {
                    let p = u.get("prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                    let c = u.get("completion_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                    let t = u.get("total_tokens").and_then(|v| v.as_u64()).unwrap_or(p + c);
                    TokenUsage {
                        prompt_tokens: p,
                        completion_tokens: c,
                        total_tokens: t,
                        is_estimated: false,
                    }
                });

                Ok(ProviderResponse {
                    content,
                    tool_calls,
                    finish_reason,
                    usage,
                    metrics: None,
                    cancelled: false,
                })
            }

            "anthropic" => {
                let target_model = if model.is_empty() { "claude-3-5-sonnet-20241022" } else { model };

                // Extract system messages
                let mut system_prompt = String::new();
                let mut anthropic_msgs: Vec<serde_json::Value> = Vec::new();

                for m in &messages {
                    if m.role == "system" {
                        if !system_prompt.is_empty() {
                            system_prompt.push_str("\n\n");
                        }
                        system_prompt.push_str(&m.content);
                    } else if m.role == "tool" {
                        anthropic_msgs.push(serde_json::json!({
                            "role": "user",
                            "content": [{
                                "type": "tool_result",
                                "tool_use_id": m.tool_call_id.clone().unwrap_or_default(),
                                "content": m.content
                            }]
                        }));
                    } else if let Some(calls) = &m.tool_calls {
                        let mut content_blocks: Vec<serde_json::Value> = Vec::new();
                        if !m.content.is_empty() {
                            content_blocks.push(serde_json::json!({
                                "type": "text",
                                "text": m.content
                            }));
                        }
                        for c in calls {
                            content_blocks.push(serde_json::json!({
                                "type": "tool_use",
                                "id": c.id,
                                "name": c.name,
                                "input": c.arguments
                            }));
                        }
                        anthropic_msgs.push(serde_json::json!({
                            "role": "assistant",
                            "content": content_blocks
                        }));
                    } else {
                        anthropic_msgs.push(serde_json::json!({
                            "role": m.role,
                            "content": m.content
                        }));
                    }
                }

                let mut payload = serde_json::json!({
                    "model": target_model,
                    "max_tokens": options.num_predict.unwrap_or(4096),
                    "messages": anthropic_msgs
                });
                if let Some(t) = options.temperature {
                    payload["temperature"] = serde_json::json!(t);
                }

                if !system_prompt.is_empty() {
                    payload["system"] = serde_json::json!(system_prompt);
                }

                // Format tools for Anthropic
                if let Some(arr) = tools_def.as_array() {
                    if !arr.is_empty() {
                        let anthropic_tools: Vec<serde_json::Value> = arr
                            .iter()
                            .filter_map(|t| {
                                let func = t.get("function")?;
                                Some(serde_json::json!({
                                    "name": func.get("name")?,
                                    "description": func.get("description").unwrap_or(&serde_json::json!("")),
                                    "input_schema": func.get("parameters").unwrap_or(&serde_json::json!({
                                        "type": "object",
                                        "properties": {}
                                    }))
                                }))
                            })
                            .collect();
                        payload["tools"] = serde_json::json!(anthropic_tools);
                    }
                }

                let resp = client
                    .post("https://api.anthropic.com/v1/messages")
                    .header("x-api-key", api_key.trim())
                    .header("anthropic-version", "2023-06-01")
                    .header("content-type", "application/json")
                    .json(&payload)
                    .send()
                    .await
                    .map_err(|e| format!("Anthropic request failed: {}", e))?;

                if !resp.status().is_success() {
                    let err = resp.text().await.unwrap_or_default();
                    return Err(format!("Anthropic error: {}", err));
                }

                let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
                let mut text_content = String::new();
                let mut tool_calls = Vec::new();

                if let Some(content_arr) = json.get("content").and_then(|c| c.as_array()) {
                    for block in content_arr {
                        if let Some(btype) = block.get("type").and_then(|t| t.as_str()) {
                            if btype == "text" {
                                if let Some(txt) = block.get("text").and_then(|t| t.as_str()) {
                                    text_content.push_str(txt);
                                }
                            } else if btype == "tool_use" {
                                let id = block.get("id").and_then(|i| i.as_str()).unwrap_or_default().to_string();
                                let name = block.get("name").and_then(|n| n.as_str()).unwrap_or_default().to_string();
                                let input = block.get("input").cloned().unwrap_or(serde_json::json!({}));
                                tool_calls.push(ToolCall {
                                    id,
                                    name,
                                    arguments: input,
                                });
                            }
                        }
                    }
                }

                let finish_reason = json.get("stop_reason").and_then(|r| r.as_str()).map(|s| s.to_string());

                let usage = json.get("usage").map(|u| {
                    let p = u.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                    let c = u.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                    TokenUsage {
                        prompt_tokens: p,
                        completion_tokens: c,
                        total_tokens: p + c,
                        is_estimated: false,
                    }
                });

                Ok(ProviderResponse {
                    content: text_content,
                    tool_calls,
                    finish_reason,
                    usage,
                    metrics: None,
                    cancelled: false,
                })
            }

            "gemini" => {
                let target_model = if model.is_empty() { "gemini-2.0-flash" } else { model };
                let endpoint = format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                    target_model,
                    api_key.trim()
                );

                let mut gemini_contents: Vec<serde_json::Value> = Vec::new();
                for m in &messages {
                    let role = if m.role == "assistant" { "model" } else { "user" };
                    gemini_contents.push(serde_json::json!({
                        "role": role,
                        "parts": [{"text": m.content}]
                    }));
                }

                let payload = serde_json::json!({
                    "contents": gemini_contents
                });

                let resp = client
                    .post(&endpoint)
                    .json(&payload)
                    .send()
                    .await
                    .map_err(|e| format!("Gemini request failed: {}", e))?;

                if !resp.status().is_success() {
                    let err = resp.text().await.unwrap_or_default();
                    return Err(format!("Gemini error: {}", err));
                }

                let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
                let mut text_content = String::new();

                if let Some(cands) = json.get("candidates").and_then(|c| c.as_array()) {
                    if let Some(first) = cands.first() {
                        if let Some(parts) = first.get("content").and_then(|c| c.get("parts")).and_then(|p| p.as_array()) {
                            for part in parts {
                                if let Some(txt) = part.get("text").and_then(|t| t.as_str()) {
                                    text_content.push_str(txt);
                                }
                            }
                        }
                    }
                }

                let usage = json.get("usageMetadata").map(|u| {
                    let p = u.get("promptTokenCount").and_then(|v| v.as_u64()).unwrap_or(0);
                    let c = u.get("candidatesTokenCount").and_then(|v| v.as_u64()).unwrap_or(0);
                    let t = u.get("totalTokenCount").and_then(|v| v.as_u64()).unwrap_or(p + c);
                    TokenUsage {
                        prompt_tokens: p,
                        completion_tokens: c,
                        total_tokens: t,
                        is_estimated: false,
                    }
                });

                Ok(ProviderResponse {
                    content: text_content,
                    tool_calls: vec![],
                    finish_reason: Some("stop".into()),
                    usage,
                    metrics: None,
                    cancelled: false,
                })
            }

            _ => Err(format!("Unsupported provider: {}", provider)),
        }
    }
}

// ============================================================================
// Ollama payload/response helpers (shared by streaming and blocking paths)
// ============================================================================

fn ollama_keep_alive_value(options: &DispatchOptions) -> serde_json::Value {
    match options.keep_alive.as_deref() {
        Some("forever") | Some("-1") => serde_json::json!(-1),
        Some(d) if !d.is_empty() => serde_json::json!(d),
        // Default: release the model after 30 minutes of inactivity instead of
        // pinning every used model in VRAM/RAM indefinitely.
        _ => serde_json::json!("30m"),
    }
}

pub fn build_ollama_payload(
    model: &str,
    messages: &[ChatMessage],
    tools_def: serde_json::Value,
    options: &DispatchOptions,
    stream: bool,
) -> serde_json::Value {
    let ollama_msgs: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| {
            if m.role == "tool" {
                // Ollama uses role=tool with plain content (no tool_call_id needed)
                serde_json::json!({
                    "role": "tool",
                    "content": m.content
                })
            } else {
                let mut msg_obj = serde_json::json!({
                    "role": m.role,
                    "content": m.content
                });
                if let Some(calls) = &m.tool_calls {
                    let tc_json: Vec<serde_json::Value> = calls
                        .iter()
                        .map(|c| {
                            serde_json::json!({
                                "function": {
                                    "name": c.name,
                                    "arguments": c.arguments
                                }
                            })
                        })
                        .collect();
                    msg_obj["tool_calls"] = serde_json::Value::Array(tc_json);
                }
                msg_obj
            }
        })
        .collect();

    let mut gen_options = serde_json::json!({});
    if let Some(nc) = options.num_ctx {
        gen_options["num_ctx"] = serde_json::json!(nc);
    }
    if let Some(t) = options.temperature {
        gen_options["temperature"] = serde_json::json!(t);
    }
    if let Some(tp) = options.top_p {
        gen_options["top_p"] = serde_json::json!(tp);
    }
    if let Some(np) = options.num_predict {
        gen_options["num_predict"] = serde_json::json!(np);
    }

    let mut payload = serde_json::json!({
        "model": if model.is_empty() { "llama3" } else { model },
        "messages": ollama_msgs,
        "stream": stream,
        "keep_alive": ollama_keep_alive_value(options),
        "options": gen_options,
    });

    if let Some(arr) = tools_def.as_array() {
        if !arr.is_empty() {
            payload["tools"] = tools_def.clone();
        }
    }
    payload
}

/// Normalizes tool-call arguments into a JSON object.
///
/// Root cause of the `write_file — Missing path` failures: some Ollama
/// versions/model templates return `function.arguments` as a JSON *string*
/// (OpenAI wire style) instead of an object, and local models emitting
/// manual JSON tool calls sometimes use `parameters`/`input` instead of
/// `arguments`. Anything not an object made `arguments.get("path")` return
/// None downstream. Everything converges through here — native calls,
/// streamed calls, and the JSON fallback parser.
fn normalize_tool_arguments(val: &serde_json::Value) -> serde_json::Value {
    match val {
        serde_json::Value::Object(_) => val.clone(),
        serde_json::Value::String(s) => {
            let trimmed = s.trim();
            // Models occasionally wrap the arguments JSON in a markdown fence
            let cleaned = trimmed
                .strip_prefix("```json")
                .or_else(|| trimmed.strip_prefix("```"))
                .unwrap_or(trimmed)
                .trim()
                .trim_end_matches("```")
                .trim();
            if cleaned.is_empty() {
                return serde_json::json!({});
            }
            match serde_json::from_str::<serde_json::Value>(cleaned) {
                Ok(parsed) => normalize_tool_arguments(&parsed),
                Err(_) => {
                    // Not valid JSON — do not guess fields; an empty object
                    // lets execute_tool return its structured "missing path"
                    // error so the model can correct the format.
                    serde_json::json!({})
                }
            }
        }
        // Null / numbers / bools / arrays are not argument maps
        _ => serde_json::json!({}),
    }
}

fn parse_ollama_tool_calls(msg: &serde_json::Value) -> Vec<ToolCall> {
    let mut tool_calls = Vec::new();
    if let Some(calls) = msg.get("tool_calls").and_then(|c| c.as_array()) {
        for (i, call) in calls.iter().enumerate() {
            if let Some(func) = call.get("function") {
                let name = func
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or_default()
                    .to_string();
                // Prefer "arguments"; accept "parameters"/"input" (aliases
                // some model templates emit). Normalize strings to objects.
                let raw_args = func
                    .get("arguments")
                    .or_else(|| func.get("parameters"))
                    .or_else(|| func.get("input"));
                let args = raw_args.map(normalize_tool_arguments).unwrap_or_else(|| serde_json::json!({}));
                tool_calls.push(ToolCall {
                    id: format!("ollama_call_{}", i),
                    name,
                    arguments: args,
                });
            }
        }
    }
    tool_calls
}

fn estimate_usage(messages: &[ChatMessage], content: &str) -> TokenUsage {
    let est_p = ((messages.iter().map(|m| m.content.len()).sum::<usize>()) / 4).max(1) as u64;
    let est_c = (content.len() / 4).max(1) as u64;
    TokenUsage {
        prompt_tokens: est_p,
        completion_tokens: est_c,
        total_tokens: est_p + est_c,
        is_estimated: true,
    }
}

fn metrics_from_durations(json: &serde_json::Value) -> Option<GenMetrics> {
    let total_ns = json.get("total_duration").and_then(|v| v.as_u64())?;
    let eval_ns = json.get("eval_duration").and_then(|v| v.as_u64());
    let prompt_eval_ns = json.get("prompt_eval_duration").and_then(|v| v.as_u64());
    let eval_count = json.get("eval_count").and_then(|v| v.as_u64());
    let prompt_count = json.get("prompt_eval_count").and_then(|v| v.as_u64());

    let tps = eval_ns
        .filter(|d| *d > 0)
        .and_then(|d| eval_count.map(|c| (c as f64) / (d as f64 / 1e9)));
    let ptps = prompt_eval_ns
        .filter(|d| *d > 0)
        .and_then(|d| prompt_count.map(|c| (c as f64) / (d as f64 / 1e9)));

    Some(GenMetrics {
        tokens_per_second: tps.map(|v| (v * 10.0).round() / 10.0),
        prompt_tokens_per_second: ptps.map(|v| (v * 10.0).round() / 10.0),
        total_duration_ms: Some(total_ns / 1_000_000),
        load_duration_ms: json
            .get("load_duration")
            .and_then(|v| v.as_u64())
            .map(|d| d / 1_000_000),
    })
}

/// Normalize a full (non-streamed) /api/chat response into ProviderResponse.
pub fn parse_ollama_response(json: &serde_json::Value, messages: &[ChatMessage]) -> ProviderResponse {
    let msg = json.get("message").cloned().unwrap_or_default();
    let content = msg
        .get("content")
        .and_then(|c| c.as_str())
        .unwrap_or_default()
        .to_string();

    let mut tool_calls = parse_ollama_tool_calls(&msg);
    if tool_calls.is_empty() {
        if let Some(fallback_calls) = extract_json_tool_calls(&content) {
            tool_calls = fallback_calls;
        }
    }

    let prompt_tokens = json.get("prompt_eval_count").and_then(|v| v.as_u64());
    let completion_tokens = json.get("eval_count").and_then(|v| v.as_u64());
    let usage = match (prompt_tokens, completion_tokens) {
        (Some(p), Some(c)) => Some(TokenUsage {
            prompt_tokens: p,
            completion_tokens: c,
            total_tokens: p + c,
            is_estimated: false,
        }),
        _ => Some(estimate_usage(messages, &content)),
    };

    ProviderResponse {
        content,
        tool_calls,
        finish_reason: json
            .get("done_reason")
            .and_then(|r| r.as_str())
            .map(|s| s.to_string()),
        usage,
        metrics: metrics_from_durations(json),
        cancelled: false,
    }
}

/// Streams an Ollama /api/chat response as NDJSON lines.
///
/// - Emits `{"type":"status",...}` / `{"type":"token","text":...}` events through
///   `on_event` as generation progresses.
/// - Honours `cancel`: dropping out of this function closes the HTTP stream,
///   which stops Ollama's generation and frees the model for the next request.
/// - Returns the assembled ProviderResponse once the stream completes.
///   If cancelled mid-stream, returns a response with `cancelled: true`
///   containing whatever partial content was produced.
pub async fn stream_ollama_turn(
    base_url: &str,
    model: &str,
    messages: Vec<ChatMessage>,
    tools_def: serde_json::Value,
    options: &DispatchOptions,
    cancel: tokio_util::sync::CancellationToken,
    mut on_event: impl FnMut(serde_json::Value),
) -> Result<ProviderResponse, String> {
    use futures_util::StreamExt;

    let chat_endpoint = format!("{}/api/chat", base_url.trim_end_matches('/'));
    let payload = build_ollama_payload(model, &messages, tools_def, options, true);

    // No total timeout: a cold model load can legitimately take minutes on CPU.
    // Connect timeout keeps dead endpoints from hanging forever; each stream
    // read is bounded below so a stalled connection cannot hang the agent.
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    on_event(serde_json::json!({"type": "status", "text": "Connecting to Ollama…"}));

    let resp = client
        .post(&chat_endpoint)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {}", e))?;

    if !resp.status().is_success() {
        let err = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama error: {}", err));
    }

    on_event(serde_json::json!({"type": "status", "text": "Generating…"}));

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut content = String::new();
    let mut tool_calls: Vec<ToolCall> = Vec::new();
    let mut final_json: Option<serde_json::Value> = None;

    loop {
        let chunk = tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                // Dropping `stream` here closes the connection, which tells
                // Ollama to stop generating instead of finishing in the dark.
                return Ok(ProviderResponse {
                    content,
                    tool_calls: vec![],
                    finish_reason: Some("cancelled".into()),
                    usage: None,
                    metrics: None,
                    cancelled: true,
                });
            }
            item = tokio::time::timeout(
                std::time::Duration::from_secs(600),
                stream.next(),
            ) => item.map_err(|_| "Ollama stream stalled (no data for 10 minutes)".to_string())?,
        };

        let Some(chunk) = chunk else { break };
        let chunk = chunk.map_err(|e| format!("Ollama stream read failed: {}", e))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buf.find('\n') {
            let line: String = buf.drain(..=pos).collect();
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
                continue; // tolerate malformed keep-alive lines
            };

            if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
                return Err(format!("Ollama stream error: {}", err));
            }

            if let Some(msg) = v.get("message") {
                if let Some(txt) = msg.get("content").and_then(|c| c.as_str()) {
                    if !txt.is_empty() {
                        content.push_str(txt);
                        on_event(serde_json::json!({"type": "token", "text": txt}));
                    }
                }
                for call in parse_ollama_tool_calls(msg) {
                    // Later chunks may repeat the full call list; replace in order.
                    if !tool_calls.iter().any(|c| c.name == call.name) {
                        tool_calls.push(call);
                    }
                }
            }

            if v.get("done").and_then(|d| d.as_bool()).unwrap_or(false) {
                final_json = Some(v.clone());
            }
        }
    }

    let final_json = final_json.unwrap_or_else(|| serde_json::json!({}));

    // Final chunk carries the full message (with any tool_calls) + counters.
    let final_msg = final_json.get("message").cloned().unwrap_or_default();
    if let Some(full) = final_msg.get("content").and_then(|c| c.as_str()) {
        if full.len() > content.len() {
            content = full.to_string();
        }
    }
    let streamed_calls = parse_ollama_tool_calls(&final_msg);
    if !streamed_calls.is_empty() {
        tool_calls = streamed_calls;
    }
    if tool_calls.is_empty() {
        if let Some(fallback_calls) = extract_json_tool_calls(&content) {
            tool_calls = fallback_calls;
        }
    }

    let mut response = parse_ollama_response(&final_json, &messages);
    if response.content.is_empty() && !content.is_empty() {
        response.content = content.clone();
    }
    response.tool_calls = tool_calls;
    if response.usage.is_none() {
        response.usage = Some(estimate_usage(&messages, &content));
    }
    Ok(response)
}

fn extract_json_tool_calls(content: &str) -> Option<Vec<ToolCall>> {
    let mut calls = Vec::new();
    let mut search_str = content;

    while let Some(start_idx) = search_str.find("```json") {
        let after_start = &search_str[start_idx + 7..];
        if let Some(end_idx) = after_start.find("```") {
            let json_str = after_start[..end_idx].trim();
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                if let Some(call) = parse_val_to_tool_call(&val, calls.len()) {
                    calls.push(call);
                } else if let Some(arr) = val.as_array() {
                    for item in arr {
                        if let Some(c) = parse_val_to_tool_call(item, calls.len()) {
                            calls.push(c);
                        }
                    }
                }
            }
            search_str = &after_start[end_idx + 3..];
        } else {
            break;
        }
    }

    if !calls.is_empty() {
        return Some(calls);
    }

    if let Ok(val) = serde_json::from_str::<serde_json::Value>(content.trim()) {
        if let Some(call) = parse_val_to_tool_call(&val, 0) {
            return Some(vec![call]);
        }
    }

    None
}

fn parse_val_to_tool_call(val: &serde_json::Value, idx: usize) -> Option<ToolCall> {
    if let Some(name) = val.get("name").and_then(|n| n.as_str()) {
        let raw_args = val
            .get("arguments")
            .or_else(|| val.get("parameters"))
            .or_else(|| val.get("input"));
        let args = match raw_args {
            Some(a) => normalize_tool_arguments(a),
            // The object itself is the argument map ({"name":"write_file","path":...})
            None => normalize_tool_arguments(val),
        };
        return Some(ToolCall {
            id: format!("parsed_call_{}", idx),
            name: name.to_string(),
            arguments: args,
        });
    }
    if let Some(tool) = val.get("tool").and_then(|t| t.as_str()) {
        let mut args = val.clone();
        if let Some(obj) = args.as_object_mut() {
            obj.remove("tool");
        }
        let args = normalize_tool_arguments(&args);
        return Some(ToolCall {
            id: format!("parsed_call_{}", idx),
            name: tool.to_string(),
            arguments: args,
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_string_arguments_normalized_to_object() {
        // The exact shape that produced "write_file — Missing path":
        // Ollama returning function.arguments as a JSON string
        let msg = serde_json::json!({
            "tool_calls": [{
                "function": {
                    "name": "write_file",
                    "arguments": "{\"path\": \"src/main.rs\", \"content\": \"fn main() {}\"}"
                }
            }]
        });
        let calls = parse_ollama_tool_calls(&msg);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "write_file");
        assert_eq!(calls[0].arguments.get("path").and_then(|p| p.as_str()), Some("src/main.rs"));
        assert_eq!(calls[0].arguments.get("content").and_then(|c| c.as_str()), Some("fn main() {}"));
    }

    #[test]
    fn test_fenced_string_arguments_normalized() {
        let msg = serde_json::json!({
            "tool_calls": [{
                "function": {
                    "name": "read_file",
                    "arguments": "```json\n{\"path\": \"lib.rs\"}\n```"
                }
            }]
        });
        let calls = parse_ollama_tool_calls(&msg);
        assert_eq!(calls[0].arguments.get("path").and_then(|p| p.as_str()), Some("lib.rs"));
    }

    #[test]
    fn test_parameters_alias_accepted() {
        let msg = serde_json::json!({
            "tool_calls": [{
                "function": {
                    "name": "write_file",
                    "parameters": { "path": "a.txt", "content": "x" }
                }
            }]
        });
        let calls = parse_ollama_tool_calls(&msg);
        assert_eq!(calls[0].arguments.get("path").and_then(|p| p.as_str()), Some("a.txt"));
    }

    #[test]
    fn test_fallback_json_with_inline_args() {
        // Local model emitting manual JSON where the object itself is the arg map
        let content = "I'll write the file now.\n```json\n{\"name\":\"write_file\",\"path\":\"x.py\",\"content\":\"print(1)\"}\n```";
        let calls = extract_json_tool_calls(content).expect("should parse");
        assert_eq!(calls[0].name, "write_file");
        assert_eq!(calls[0].arguments.get("path").and_then(|p| p.as_str()), Some("x.py"));
    }

    #[test]
    fn test_unparseable_string_arguments_yield_empty_object() {
        // Never invent a path — dispatcher returns its structured error instead
        let msg = serde_json::json!({
            "tool_calls": [{
                "function": { "name": "write_file", "arguments": "not json at all" }
            }]
        });
        let calls = parse_ollama_tool_calls(&msg);
        assert!(calls[0].arguments.as_object().map(|o| o.is_empty()).unwrap_or(false));
    }

    #[test]
    fn test_object_arguments_pass_through() {
        let msg = serde_json::json!({
            "tool_calls": [{
                "function": { "name": "list_files", "arguments": { "max_depth": 3 } }
            }]
        });
        let calls = parse_ollama_tool_calls(&msg);
        assert_eq!(calls[0].arguments.get("max_depth").and_then(|d| d.as_u64()), Some(3));
    }
}
