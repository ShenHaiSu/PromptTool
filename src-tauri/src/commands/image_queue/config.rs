//! 生图队列配置与密钥记住（need05 B1 §4）。
//!
//! - 非敏感配置（含 `output_dir`）→ `{data_dir}/image_queue.json`（原子写，启动加载）；
//! - 敏感（`api_key` + `proxy_url`，仅 `remember_key == true`）→
//!   `{data_dir}/image_queue.secrets.json`（XOR + base64 混淆）。
//!
//! 强度声明（文档与注释如实写明）：混淆仅防 casual 窥视（顺手打开文件的人），不防专业逆向；
//! 二期可换系统钥匙串。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use super::agnes::{mask_secret, SUPPORTED_PROTOCOLS, SUPPORTED_RATIOS, SUPPORTED_SIZES};

/// API 基址默认（Agnes Hub）。
pub const DEFAULT_API_BASE: &str = "https://apihub.agnes-ai.com";
/// `iq_get_config` 返回的已设置占位；`iq_set_config` 收到它视为“保持原 key 不变”。
pub const KEY_SET_PLACEHOLDER: &str = "__SET__";
/// secrets 混淆盐（本机固定盐 + 应用标识语义；改动它会使旧 secrets 失效）。
const OBFUSCATE_SALT: &[u8] = b"pmf-image-queue-v1::agnes";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageQueueConfig {
    /// "agnes"（白名单，一期唯一）。
    pub protocol: String,
    pub loop_enabled: bool,
    /// 开始生图前自动随机一批新提示词入队（旧 `loop_after_random` 已删除；旧配置残留字段自动忽略）。
    #[serde(default)]
    pub auto_random_on_start: bool,
    /// 队列独立可控随机：以画布为锚点，仅随机缺口维度（默认 false=纯随机）。
    #[serde(default)]
    pub loop_use_partial: bool,
    /// 队列随机是否含 NSFW 条目（默认 false）。
    #[serde(default)]
    pub loop_allow_nsfw: bool,
    /// 默认 https://apihub.agnes-ai.com，收尾去 "/"。
    pub api_base: String,
    /// 永不经 `iq_get_config` 外泄（skip_serializing）。
    #[serde(skip_serializing, default)]
    pub api_key: String,
    /// 空 = 默认 `{data_dir}/output/images`；相对 = 相对 data_dir；绝对直用。
    pub output_dir: String,
    /// 1K/2K/3K/4K，默认 1K。
    pub size: String,
    /// 8 种之一，默认 1:1。
    pub ratio: String,
    /// 钳制 1..=8，默认 2。
    pub concurrency: u8,
    pub proxy_on: bool,
    pub proxy_url: String,
    /// 是否落盘密钥。
    pub remember_key: bool,
    /// 图片内嵌生图参数总开关（need06 embed-only），默认 true；false = 纯原图（应急回滚用）。
    #[serde(default = "default_true")]
    pub embed_meta: bool,
    /// 默认 15，范围 5..=60。
    #[serde(default = "default_connect_timeout_secs")]
    pub connect_timeout_secs: u64,
    /// 默认 300，范围 60..=600。
    #[serde(default = "default_total_timeout_secs")]
    pub total_timeout_secs: u64,
}

fn default_true() -> bool {
    true
}

fn default_connect_timeout_secs() -> u64 {
    15
}

fn default_total_timeout_secs() -> u64 {
    300
}

impl Default for ImageQueueConfig {
    fn default() -> Self {
        Self {
            protocol: "agnes".to_string(),
            loop_enabled: false,
            auto_random_on_start: false,
            loop_use_partial: false,
            loop_allow_nsfw: false,
            api_base: DEFAULT_API_BASE.to_string(),
            api_key: String::new(),
            output_dir: String::new(),
            size: "1K".to_string(),
            ratio: "1:1".to_string(),
            concurrency: 2,
            proxy_on: false,
            proxy_url: String::new(),
            remember_key: false,
            embed_meta: true,
            connect_timeout_secs: 15,
            total_timeout_secs: 300,
        }
    }
}

/// 前端可见的配置视图：`apiKey` 只回占位（`__SET__` 表已设置，`""` 表未设置）；
/// `apiKeyMasked` 回脱敏串（有 key 时 `前5***后4`，无 key 时 `""`），供配置页直接展示，
/// 明文永不经此视图外泄。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageQueueConfigView {
    pub protocol: String,
    pub loop_enabled: bool,
    pub auto_random_on_start: bool,
    #[serde(default)]
    pub loop_use_partial: bool,
    #[serde(default)]
    pub loop_allow_nsfw: bool,
    pub api_base: String,
    pub api_key: String,
    #[serde(default)]
    pub api_key_masked: String,
    pub output_dir: String,
    pub size: String,
    pub ratio: String,
    pub concurrency: u8,
    pub proxy_on: bool,
    pub proxy_url: String,
    pub remember_key: bool,
    #[serde(default = "default_true")]
    pub embed_meta: bool,
    pub connect_timeout_secs: u64,
    pub total_timeout_secs: u64,
}

impl ImageQueueConfig {
    pub fn view(&self) -> ImageQueueConfigView {
        ImageQueueConfigView {
            protocol: self.protocol.clone(),
            loop_enabled: self.loop_enabled,
            auto_random_on_start: self.auto_random_on_start,
            loop_use_partial: self.loop_use_partial,
            loop_allow_nsfw: self.loop_allow_nsfw,
            api_base: self.api_base.clone(),
            api_key: if self.api_key.is_empty() {
                String::new()
            } else {
                KEY_SET_PLACEHOLDER.to_string()
            },
            api_key_masked: if self.api_key.is_empty() {
                String::new()
            } else {
                mask_secret(&self.api_key)
            },
            output_dir: self.output_dir.clone(),
            size: self.size.clone(),
            ratio: self.ratio.clone(),
            concurrency: self.concurrency,
            proxy_on: self.proxy_on,
            proxy_url: if self.proxy_url.is_empty() {
                String::new()
            } else {
                // 代理地址同等敏感：仅回占位，前端显示“已设置”。
                KEY_SET_PLACEHOLDER.to_string()
            },
            remember_key: self.remember_key,
            embed_meta: self.embed_meta,
            connect_timeout_secs: self.connect_timeout_secs,
            total_timeout_secs: self.total_timeout_secs,
        }
    }

    /// 校验 + 钳制（`iq_set_config` 入口调用）。钳制后回写，调用方把纠正值返回前端。
    pub fn validate_and_normalize(&mut self) -> Result<(), String> {
        if !SUPPORTED_PROTOCOLS.contains(&self.protocol.as_str()) {
            return Err(format!("不支持的协议：{}（一期仅支持 agnes）", self.protocol));
        }
        let base = self.api_base.trim().trim_end_matches('/').to_string();
        if !(base.starts_with("http://") || base.starts_with("https://")) {
            return Err("API 路径必须以 http(s):// 开头".to_string());
        }
        self.api_base = base;
        if !SUPPORTED_SIZES.contains(&self.size.as_str()) {
            return Err(format!("不支持的分辨率：{}（仅 1K/2K/3K/4K）", self.size));
        }
        if !SUPPORTED_RATIOS.contains(&self.ratio.as_str()) {
            return Err(format!("不支持的比例：{}", self.ratio));
        }
        self.concurrency = self.concurrency.clamp(1, 8);
        if self.proxy_on {
            let u = self.proxy_url.trim().to_string();
            if u.starts_with("socks5://") || u.starts_with("socks5h://") {
                return Err("socks5 代理为二期支持，一期仅支持 http(s)://".to_string());
            }
            if !(u.starts_with("http://") || u.starts_with("https://")) {
                return Err("代理地址必须以 http(s):// 开头".to_string());
            }
            self.proxy_url = u;
        }
        self.connect_timeout_secs = self.connect_timeout_secs.clamp(5, 60);
        self.total_timeout_secs = self.total_timeout_secs.clamp(60, 600);
        Ok(())
    }

    /// 并发容量（已钳制，`Semaphore::new` 直接用）。
    pub fn concurrency_capped(&self) -> usize {
        (self.concurrency.clamp(1, 8)) as usize
    }
}

pub fn config_file_path(data_dir: &Path) -> PathBuf {
    data_dir.join("image_queue.json")
}

pub fn secrets_file_path(data_dir: &Path) -> PathBuf {
    data_dir.join("image_queue.secrets.json")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SecretsFile {
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    proxy_url: String,
}

/// XOR + base64 混淆（防 casual 窥视，不防专业逆向——见模块注释）。
pub fn obfuscate(plain: &str) -> String {
    let bytes = plain.as_bytes();
    let xored: Vec<u8> = bytes
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ OBFUSCATE_SALT[i % OBFUSCATE_SALT.len()])
        .collect();
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &xored)
}

pub fn deobfuscate(ob: &str) -> Result<String, String> {
    use base64::Engine;
    let raw = base64::engine::general_purpose::STANDARD
        .decode(ob.trim())
        .map_err(|e| format!("secrets 解析失败：{}", e))?;
    let plain: Vec<u8> = raw
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ OBFUSCATE_SALT[i % OBFUSCATE_SALT.len()])
        .collect();
    String::from_utf8(plain).map_err(|e| format!("secrets 解码失败：{}", e))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = if path.extension().is_some() {
        path.with_extension("tmp")
    } else {
        PathBuf::from(format!("{}.tmp", path.display()))
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("无法创建目录 '{}': {}", parent.display(), e))?;
    }
    std::fs::write(&tmp, bytes).map_err(|e| format!("写入临时文件失败 '{}': {}", tmp.display(), e))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("文件重命名失败: {}", e))?;
    Ok(())
}

/// 非敏感配置持久化（原子写）。`api_key` 因 `skip_serializing` 不会落盘。
pub fn save_config(data_dir: &Path, cfg: &ImageQueueConfig) -> Result<(), String> {
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    atomic_write(&config_file_path(data_dir), json.as_bytes())
}

/// 启动加载：缺文件即 Default；文件损坏返回 Err（调用方记日志后回落 Default）。
pub fn load_config(data_dir: &Path) -> Result<ImageQueueConfig, String> {
    let path = config_file_path(data_dir);
    if !path.exists() {
        return Ok(ImageQueueConfig::default());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("读取配置失败 '{}': {}", path.display(), e))?;
    let mut cfg: ImageQueueConfig = serde_json::from_str(&raw).map_err(|e| format!("配置解析失败: {}", e))?;
    // 防御：钳制一遍，避免手改文件导致非法值。
    let _ = cfg.validate_and_normalize();
    Ok(cfg)
}

/// secrets 存取：仅当 `remember_key == true` 调用 save；为 false 时删除旧文件。
pub fn save_secrets(data_dir: &Path, api_key: &str, proxy_url: &str) -> Result<(), String> {
    let s = SecretsFile {
        api_key: obfuscate(api_key),
        proxy_url: obfuscate(proxy_url),
    };
    let json = serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?;
    atomic_write(&secrets_file_path(data_dir), json.as_bytes())
}

pub fn load_secrets(data_dir: &Path) -> Result<Option<(String, String)>, String> {
    let path = secrets_file_path(data_dir);
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("读取 secrets 失败: {}", e))?;
    let s: SecretsFile = serde_json::from_str(&raw).map_err(|e| format!("secrets 解析失败: {}", e))?;
    let key = if s.api_key.is_empty() {
        String::new()
    } else {
        deobfuscate(&s.api_key)?
    };
    let proxy = if s.proxy_url.is_empty() {
        String::new()
    } else {
        deobfuscate(&s.proxy_url).unwrap_or_default()
    };
    Ok(Some((key, proxy)))
}

pub fn delete_secrets(data_dir: &Path) {
    let _ = std::fs::remove_file(secrets_file_path(data_dir));
}

/// HTTP client 指纹：`(api_base, proxy_on, proxy_url, timeout)` 一致则复用。
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct ClientFingerprint {
    pub api_base: String,
    pub proxy_on: bool,
    pub proxy_url: String,
    pub connect_secs: u64,
    pub total_secs: u64,
}

impl ClientFingerprint {
    pub fn of(cfg: &ImageQueueConfig) -> Self {
        Self {
            api_base: cfg.api_base.clone(),
            proxy_on: cfg.proxy_on,
            proxy_url: if cfg.proxy_on { cfg.proxy_url.clone() } else { String::new() },
            connect_secs: cfg.connect_timeout_secs,
            total_secs: cfg.total_timeout_secs,
        }
    }
}

/// 按指纹构造 client。代理构造失败直接 Err（`iq_set_config` 拒绝，不污染缓存）。
pub fn build_client(fp: &ClientFingerprint) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(fp.connect_secs))
        .timeout(std::time::Duration::from_secs(fp.total_secs));
    if fp.proxy_on {
        let proxy = reqwest::Proxy::all(&fp.proxy_url)
            .map_err(|e| format!("代理地址无效：{}", e))?;
        builder = builder.proxy(proxy);
    }
    builder.build().map_err(|e| format!("HTTP client 构造失败：{}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_values_match_spec() {
        let c = ImageQueueConfig::default();
        assert_eq!(c.protocol, "agnes");
        assert_eq!(c.api_base, DEFAULT_API_BASE);
        assert_eq!(c.size, "1K");
        assert_eq!(c.ratio, "1:1");
        assert_eq!(c.concurrency, 2);
        assert_eq!(c.connect_timeout_secs, 15);
        assert_eq!(c.total_timeout_secs, 300);
        assert!(!c.loop_enabled && !c.auto_random_on_start && !c.proxy_on);
        assert!(!c.loop_use_partial && !c.loop_allow_nsfw);
        assert!(c.embed_meta);
    }

    #[test]
    fn legacy_payload_missing_embed_meta_defaults_true() {
        // 回归：need06 前的 image_queue.json 无 embedMeta 字段，反序列化应回 true（新默认）。
        let raw = serde_json::json!({
            "protocol": "agnes",
            "loopEnabled": false,
            "apiBase": DEFAULT_API_BASE,
            "outputDir": "",
            "size": "1K",
            "ratio": "1:1",
            "concurrency": 2,
            "proxyOn": false,
            "proxyUrl": "",
            "rememberKey": true,
            "connectTimeoutSecs": 15,
            "totalTimeoutSecs": 300
        });
        let cfg: ImageQueueConfig = serde_json::from_value(raw).expect("旧配置应兼容 embedMeta 默认值");
        assert!(cfg.embed_meta);
        // view 透传
        assert!(cfg.view().embed_meta);
    }

    #[test]
    fn legacy_payload_missing_timeouts_falls_back_to_defaults() {
        // 回归：旧前端 payload / 旧 image_queue.json 缺超时字段时不得报 missing field；
        // 旧 `loopAfterRandom` 残留字段应被忽略，缺 `autoRandomOnStart` 时取默认 false。
        let raw = serde_json::json!({
            "protocol": "agnes",
            "loopEnabled": false,
            "loopAfterRandom": true,
            "apiBase": DEFAULT_API_BASE,
            "outputDir": "",
            "size": "1K",
            "ratio": "1:1",
            "concurrency": 2,
            "proxyOn": false,
            "proxyUrl": "",
            "rememberKey": true
        });
        let cfg: ImageQueueConfig = serde_json::from_value(raw).expect("旧 payload 应兼容默认值");
        assert_eq!(cfg.connect_timeout_secs, 15);
        assert_eq!(cfg.total_timeout_secs, 300);
        assert!(!cfg.auto_random_on_start);
        assert!(!cfg.loop_enabled);
    }

    #[test]
    fn legacy_payload_missing_loop_random_fields_defaults_false() {
        // 回归：旧 image_queue.json 无 loopUsePartial/loopAllowNsfw 时默认 false（纯随机、不含 NSFW）。
        let raw = serde_json::json!({
            "protocol": "agnes",
            "loopEnabled": false,
            "apiBase": DEFAULT_API_BASE,
            "outputDir": "",
            "size": "1K",
            "ratio": "1:1",
            "concurrency": 2,
            "proxyOn": false,
            "proxyUrl": "",
            "rememberKey": true,
            "connectTimeoutSecs": 15,
            "totalTimeoutSecs": 300
        });
        let cfg: ImageQueueConfig = serde_json::from_value(raw).expect("旧配置应兼容队列随机字段默认值");
        assert!(!cfg.loop_use_partial);
        assert!(!cfg.loop_allow_nsfw);
        assert!(!cfg.view().loop_use_partial);
        assert!(!cfg.view().loop_allow_nsfw);
    }

    #[test]
    fn loop_random_fields_roundtrip() {
        let raw = serde_json::json!({
            "protocol": "agnes",
            "loopEnabled": true,
            "autoRandomOnStart": true,
            "loopUsePartial": true,
            "loopAllowNsfw": true,
            "apiBase": DEFAULT_API_BASE,
            "outputDir": "",
            "size": "1K",
            "ratio": "1:1",
            "concurrency": 2,
            "proxyOn": false,
            "proxyUrl": "",
            "rememberKey": true,
            "connectTimeoutSecs": 15,
            "totalTimeoutSecs": 300
        });
        let cfg: ImageQueueConfig = serde_json::from_value(raw).expect("新字段应正常解析");
        assert!(cfg.loop_use_partial);
        assert!(cfg.loop_allow_nsfw);
        let v = cfg.view();
        assert!(v.loop_use_partial);
        assert!(v.loop_allow_nsfw);
    }

    #[test]
    fn auto_random_on_start_roundtrip() {
        let raw = serde_json::json!({
            "protocol": "agnes",
            "loopEnabled": false,
            "autoRandomOnStart": true,
            "apiBase": DEFAULT_API_BASE,
            "outputDir": "",
            "size": "1K",
            "ratio": "1:1",
            "concurrency": 2,
            "proxyOn": false,
            "proxyUrl": "",
            "rememberKey": true,
            "connectTimeoutSecs": 15,
            "totalTimeoutSecs": 300
        });
        let cfg: ImageQueueConfig = serde_json::from_value(raw).expect("新字段应正常解析");
        assert!(cfg.auto_random_on_start);
        assert!(!cfg.loop_enabled);
    }

    #[test]
    fn validate_rejects_bad_protocol_size_ratio() {
        let mut c = ImageQueueConfig::default();
        c.protocol = "openai-compat".into();
        assert!(c.validate_and_normalize().is_err());
        let mut c = ImageQueueConfig::default();
        c.size = "8K".into();
        assert!(c.validate_and_normalize().is_err());
        let mut c = ImageQueueConfig::default();
        c.ratio = "4:5".into();
        assert!(c.validate_and_normalize().is_err());
    }

    #[test]
    fn validate_rejects_bad_api_base() {
        let mut c = ImageQueueConfig::default();
        c.api_base = "ftp://x".into();
        assert!(c.validate_and_normalize().is_err());
    }

    #[test]
    fn concurrency_clamped_1_to_8() {
        let mut c = ImageQueueConfig::default();
        c.concurrency = 0;
        c.validate_and_normalize().unwrap();
        assert_eq!(c.concurrency, 1);
        c.concurrency = 255;
        c.validate_and_normalize().unwrap();
        assert_eq!(c.concurrency, 8);
    }

    #[test]
    fn proxy_socks5_rejected_with_phase2_hint() {
        let mut c = ImageQueueConfig::default();
        c.proxy_on = true;
        c.proxy_url = "socks5://127.0.0.1:1080".into();
        let err = c.validate_and_normalize().unwrap_err();
        assert!(err.contains("二期"), "实际：{}", err);
    }

    #[test]
    fn proxy_bad_scheme_rejected() {
        let mut c = ImageQueueConfig::default();
        c.proxy_on = true;
        c.proxy_url = "example.com:8080".into();
        assert!(c.validate_and_normalize().is_err());
    }

    #[test]
    fn auto_random_on_start_has_no_loop_side_effect() {
        // 新开关独立，不联动 loop_enabled
        let mut c = ImageQueueConfig::default();
        c.auto_random_on_start = true;
        c.validate_and_normalize().unwrap();
        assert!(c.auto_random_on_start);
        assert!(!c.loop_enabled);
    }

    #[test]
    fn timeouts_clamped() {
        let mut c = ImageQueueConfig::default();
        c.connect_timeout_secs = 1;
        c.total_timeout_secs = 9999;
        c.validate_and_normalize().unwrap();
        assert_eq!(c.connect_timeout_secs, 5);
        assert_eq!(c.total_timeout_secs, 600);
    }

    #[test]
    fn view_masks_key_and_proxy() {
        let mut c = ImageQueueConfig::default();
        c.api_key = "sk-secret-abcdef123456".into();
        c.proxy_url = "http://127.0.0.1:10808".into();
        let v = c.view();
        assert_eq!(v.api_key, "__SET__");
        assert_eq!(v.proxy_url, "__SET__");
        // 脱敏串可见但不含明文
        assert!(!v.api_key_masked.is_empty());
        assert!(!v.api_key_masked.contains("sk-secret-abcdef123456"));
        // 序列化视图不含明文
        let json = serde_json::to_string(&v).unwrap();
        assert!(!json.contains("sk-secret-abcdef123456"));
        // Config 本体序列化也不含 api_key（skip_serializing）
        let raw = serde_json::to_string(&c).unwrap();
        assert!(!raw.contains("sk-secret-abcdef123456"));
        let empty = ImageQueueConfig::default().view();
        assert_eq!(empty.api_key, "");
        assert_eq!(empty.api_key_masked, "");
    }

    #[test]
    fn obfuscate_roundtrip_and_not_plaintext() {
        let s = "sk-abcdef123456";
        let ob = obfuscate(s);
        assert!(!ob.contains(s));
        assert_eq!(deobfuscate(&ob).unwrap(), s);
    }

    #[test]
    fn config_save_load_roundtrip_temp_io() {
        let dir = std::env::temp_dir().join(format!("pmf_iq_cfg_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut c = ImageQueueConfig::default();
        c.output_dir = "/tmp/custom".into();
        c.concurrency = 5;
        save_config(&dir, &c).unwrap();
        // api_key 不落盘：读回为空
        c.api_key = "sk-x".into();
        save_config(&dir, &c).unwrap();
        let back = load_config(&dir).unwrap();
        assert_eq!(back.output_dir, "/tmp/custom");
        assert_eq!(back.concurrency, 5);
        assert!(back.api_key.is_empty());
        let raw = std::fs::read_to_string(config_file_path(&dir)).unwrap();
        assert!(!raw.contains("sk-x"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn secrets_save_load_delete_temp_io() {
        let dir = std::env::temp_dir().join(format!("pmf_iq_sec_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        save_secrets(&dir, "sk-abc", "http://127.0.0.1:10808").unwrap();
        let raw = std::fs::read_to_string(secrets_file_path(&dir)).unwrap();
        assert!(!raw.contains("sk-abc"));
        let loaded = load_secrets(&dir).unwrap().unwrap();
        assert_eq!(loaded.0, "sk-abc");
        assert_eq!(loaded.1, "http://127.0.0.1:10808");
        delete_secrets(&dir);
        assert!(!secrets_file_path(&dir).exists());
        assert!(load_secrets(&dir).unwrap().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
