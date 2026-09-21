//! Agnes 生图协议接入层（need05 B1）。
//!
//! 硬约束（见 `docs/need05/01_协议调研结论.md` §4，Code Review 必查）：
//! 1. `response_format` 只许出现在 `extra_body` 内，顶层禁止出现该 key；
//! 2. 一期文生图禁止构造任何 `image` 字段；图生图仅预留签名（`unimplemented!`）。

/// Agnes 模型名写死，不接受前端传入。
pub const AGNES_MODEL: &str = "agnes-image-2.5-flash";
/// 文生图默认输出格式：走 `extra_body.response_format`（推荐 url，省带宽）。
pub const AGNES_RESPONSE_FORMAT: &str = "url";
/// 测试连接探针 prompt（固定句，与 `scripts/probe_agnes.py` 一致）。
pub const PROBE_PROMPT: &str = "a small glass cube on a white studio background, soft shadows, high detail";

/// 支持的协议白名单（一期仅 agnes）。
pub const SUPPORTED_PROTOCOLS: &[&str] = &["agnes"];
/// 支持的分辨率档位（只做白名单校验，不映射像素）。
pub const SUPPORTED_SIZES: &[&str] = &["1K", "2K", "3K", "4K"];
/// 支持的比例（8 种）。
pub const SUPPORTED_RATIOS: &[&str] = &["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"];

/// 生成错误分类：供 B2 调度器决策重试/失败/取消。
#[derive(Debug, Clone)]
pub enum IqError {
    /// 400/401 等：不重试，直接记失败。
    Fatal(String),
    /// 超时 / 连接失败 / 5xx：可退避重试（最多 2 次）。
    Retryable(String),
    /// 任务被取消：不计入熔断。
    Cancelled,
}

impl std::fmt::Display for IqError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IqError::Fatal(e) => write!(f, "{}", e),
            IqError::Retryable(e) => write!(f, "{}", e),
            IqError::Cancelled => write!(f, "任务已取消"),
        }
    }
}

/// ImageProvider trait：给“协议 select”留扩展位，一期只注册 Agnes。
pub trait ImageProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn endpoint(&self, api_base: &str) -> String;
    fn build_text_to_image(&self, prompt: &str, size: &str, ratio: &str) -> serde_json::Value;
    fn parse_image_url(&self, body: &serde_json::Value) -> Result<String, String>;
}

pub struct AgnesProvider;

impl ImageProvider for AgnesProvider {
    fn name(&self) -> &'static str {
        "agnes"
    }

    fn endpoint(&self, api_base: &str) -> String {
        format!("{}/v1/images/generations", api_base.trim_end_matches('/'))
    }

    fn build_text_to_image(&self, prompt: &str, size: &str, ratio: &str) -> serde_json::Value {
        serde_json::json!({
            "model": AGNES_MODEL,
            "prompt": prompt,
            "size": size,
            "ratio": ratio,
            "extra_body": { "response_format": AGNES_RESPONSE_FORMAT }
        })
    }

    fn parse_image_url(&self, body: &serde_json::Value) -> Result<String, String> {
        parse_image_url(body)
    }
}

/// 图生图扩展方法签名预留，一期不支持图生图 UI，直接 `unimplemented!`。
#[allow(dead_code)]
pub fn build_image_to_image(
    _prompt: &str,
    _size: &str,
    _ratio: &str,
    _images: &[String],
) -> serde_json::Value {
    unimplemented!("一期不支持图生图")
}

/// 按协议名分发 provider。
pub fn provider_for(protocol: &str) -> Result<AgnesProvider, String> {
    match protocol {
        "agnes" => Ok(AgnesProvider),
        other => Err(format!("未知协议：{}（一期仅支持 agnes）", other)),
    }
}

/// 从成功响应体解析 `data[0].url`。
pub fn parse_image_url(body: &serde_json::Value) -> Result<String, String> {
    let url = body
        .pointer("/data/0/url")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if url.is_empty() {
        // b64_json 一期不解析；若非空仅记 warning（调用方日志），此处仍按缺 url 报错。
        return Err(format!("响应缺少 data[0].url：{}", truncate_body(body)));
    }
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(format!("非法图片 URL：{}", mask_secret(url)));
    }
    Ok(url.to_string())
}

/// Agnes 错误体统一抽取：`{"error":{"message":...,"type":...,"code":...}}`。
/// 401 映射“密钥无效”，400 映射原文 message，方便前端 toast。
pub fn extract_agnes_error(status: u16, body: &serde_json::Value) -> String {
    let message = body
        .pointer("/error/message")
        .and_then(|v| v.as_str())
        .or_else(|| body.pointer("/message").and_then(|v| v.as_str()))
        .unwrap_or("")
        .trim();
    match status {
        401 => {
            if message.is_empty() {
                "密钥无效（401）：请检查 API 密钥".to_string()
            } else {
                format!("密钥无效（401）：{}", message)
            }
        }
        400 => {
            if message.is_empty() {
                format!("请求被拒绝（400）：{}", truncate_body(body))
            } else {
                format!("请求被拒绝（400）：{}", message)
            }
        }
        s if (500..600).contains(&s) => {
            if message.is_empty() {
                format!("服务端错误（{}），可重试", s)
            } else {
                format!("服务端错误（{}）：{}，可重试", s, message)
            }
        }
        _ => {
            if message.is_empty() {
                format!("请求失败（{}）：{}", status, truncate_body(body))
            } else {
                format!("请求失败（{}）：{}", status, message)
            }
        }
    }
}

/// HTTP 状态 → 重试决策：仅超时/连接失败/5xx 可重试，400/401 直接 Fatal。
/// `is_transport` 为 true 表示 reqwest 层传输错误（超时/连接/DNS）。
pub fn classify_http_status(status: u16, body: &serde_json::Value) -> IqError {
    if (500..600).contains(&status) {
        IqError::Retryable(extract_agnes_error(status, body))
    } else {
        IqError::Fatal(extract_agnes_error(status, body))
    }
}

pub fn classify_transport_error(err: &reqwest::Error) -> IqError {
    if err.is_timeout() || err.is_connect() || err.is_body() || err.is_decode() {
        IqError::Retryable(format!("网络错误（可重试）：{}", err))
    } else if err.is_builder() {
        IqError::Fatal(format!("请求构造失败：{}", err))
    } else {
        // 状态码错误已在外层按 status 处理；兜底按可重试归类以免丢任务。
        IqError::Retryable(format!("网络错误（可重试）：{}", err))
    }
}

/// 单次文生图：发请求 + 解析 url。client 由调用方按配置指纹缓存提供，本函数只管发。
/// 重试：仅重试超时/连接失败/5xx，最多 2 次，退避 1s → 3s；400/401 直接返回 Fatal。
pub async fn generate_one(
    client: &reqwest::Client,
    api_base: &str,
    api_key: &str,
    prompt: &str,
    size: &str,
    ratio: &str,
) -> Result<(String, u128), IqError> {
    let provider = AgnesProvider;
    let url = provider.endpoint(api_base);
    let body = provider.build_text_to_image(prompt, size, ratio);
    let started = std::time::Instant::now();
    let backoffs = [std::time::Duration::from_secs(1), std::time::Duration::from_secs(3)];

    for attempt in 0..=2usize {
        let resp = client
            .post(&url)
            .bearer_auth(api_key)
            .json(&body)
            .send()
            .await;
        match resp {
            Err(e) => {
                let ce = classify_transport_error(&e);
                match ce {
                    IqError::Retryable(msg) if attempt < 2 => {
                        tokio::time::sleep(backoffs[attempt]).await;
                        let _ = msg;
                        continue;
                    }
                    other => return Err(other),
                }
            }
            Ok(resp) => {
                let status = resp.status().as_u16();
                let parsed: serde_json::Value = resp.json().await.map_err(|e| {
                    IqError::Retryable(format!("响应解析失败（可重试）：{}", e))
                })?;
                if (200..300).contains(&status) {
                    match provider.parse_image_url(&parsed) {
                        Ok(u) => return Ok((u, started.elapsed().as_millis())),
                        Err(e) => return Err(IqError::Fatal(e)),
                    }
                } else if (500..600).contains(&status) {
                    if attempt < 2 {
                        tokio::time::sleep(backoffs[attempt]).await;
                        continue;
                    }
                    return Err(IqError::Retryable(extract_agnes_error(status, &parsed)));
                } else {
                    return Err(IqError::Fatal(extract_agnes_error(status, &parsed)));
                }
            }
        }
    }
    Err(IqError::Retryable("重试耗尽仍未成功".to_string()))
}

/// 日志/错误信息脱敏：前 5 + `***` + 后 4（短串直接打码）。
/// Key 明文不出内存：日志/事件/toast 一律经此脱敏。
pub fn mask_secret(s: &str) -> String {
    if s.len() <= 10 {
        "***".to_string()
    } else {
        format!("{}***{}", &s[..5], &s[s.len() - 4..])
    }
}

fn truncate_body(body: &serde_json::Value) -> String {
    let s = body.to_string();
    if s.len() > 300 {
        format!("{}…", &s[..300])
    } else {
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_top_level_has_no_response_format() {
        let p = AgnesProvider;
        let body = p.build_text_to_image("a cat", "1K", "1:1");
        assert!(body.get("response_format").is_none(), "顶层禁止出现 response_format");
        assert_eq!(
            body.pointer("/extra_body/response_format").and_then(|v| v.as_str()),
            Some("url")
        );
    }

    #[test]
    fn body_model_is_pinned() {
        let p = AgnesProvider;
        let body = p.build_text_to_image("a cat", "2K", "16:9");
        assert_eq!(body.get("model").and_then(|v| v.as_str()), Some(AGNES_MODEL));
        assert_eq!(body.get("model").and_then(|v| v.as_str()), Some("agnes-image-2.5-flash"));
    }

    #[test]
    fn body_has_no_image_field() {
        let p = AgnesProvider;
        let body = p.build_text_to_image("a cat", "1K", "1:1");
        assert!(body.get("image").is_none(), "顶层禁止出现 image");
        assert!(
            body.pointer("/extra_body/image").is_none(),
            "文生图 extra_body 禁止出现 image"
        );
    }

    #[test]
    fn body_size_ratio_passthrough() {
        let p = AgnesProvider;
        let body = p.build_text_to_image("a cat", "4K", "21:9");
        assert_eq!(body.get("size").and_then(|v| v.as_str()), Some("4K"));
        assert_eq!(body.get("ratio").and_then(|v| v.as_str()), Some("21:9"));
    }

    #[test]
    fn endpoint_trims_trailing_slash() {
        let p = AgnesProvider;
        assert_eq!(
            p.endpoint("https://apihub.agnes-ai.com/"),
            "https://apihub.agnes-ai.com/v1/images/generations"
        );
    }

    #[test]
    fn parse_url_ok() {
        let body = serde_json::json!({
            "created": 123,
            "data": [{ "url": "https://platform-outputs.agnes-ai.space/x.png", "b64_json": null, "revised_prompt": "r" }]
        });
        assert_eq!(
            parse_image_url(&body).unwrap(),
            "https://platform-outputs.agnes-ai.space/x.png"
        );
    }

    #[test]
    fn parse_url_missing_is_err() {
        let empty = serde_json::json!({ "data": [] });
        let err = parse_image_url(&empty).unwrap_err();
        assert!(err.contains("data[0].url"), "信息须含 data[0].url，实际：{}", err);
        let null_url = serde_json::json!({ "data": [{ "url": null }] });
        let err2 = parse_image_url(&null_url).unwrap_err();
        assert!(err2.contains("data[0].url"), "实际：{}", err2);
    }

    #[test]
    fn parse_url_illegal_scheme_is_err() {
        let body = serde_json::json!({ "data": [{ "url": "ftp://evil/x.png" }] });
        assert!(parse_image_url(&body).is_err());
    }

    #[test]
    fn extract_401_maps_key_error() {
        let body = serde_json::json!({ "error": { "message": "Invalid API key", "type": "auth", "code": 401 } });
        let msg = extract_agnes_error(401, &body);
        assert!(msg.contains("密钥无效"), "实际：{}", msg);
    }

    #[test]
    fn extract_400_maps_message() {
        let body = serde_json::json!({ "error": { "message": "image must be a public http(s) URL", "type": "api", "code": 400 } });
        let msg = extract_agnes_error(400, &body);
        assert!(msg.contains("image must be"), "实际：{}", msg);
    }

    #[test]
    fn classify_5xx_is_retryable_4xx_is_fatal() {
        let body = serde_json::json!({});
        assert!(matches!(classify_http_status(500, &body), IqError::Retryable(_)));
        assert!(matches!(classify_http_status(429, &body), IqError::Fatal(_)));
        assert!(matches!(classify_http_status(400, &body), IqError::Fatal(_)));
        assert!(matches!(classify_http_status(401, &body), IqError::Fatal(_)));
    }

    #[test]
    fn provider_for_rejects_unknown() {
        assert!(provider_for("agnes").is_ok());
        assert!(provider_for("openai-compat").is_err());
    }
}
