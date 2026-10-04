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

use super::agnes::{
    mask_secret, validate_model, DEFAULT_MODEL, SUPPORTED_PROTOCOLS, SUPPORTED_RATIOS,
    SUPPORTED_SIZES,
};

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
    /// 模型名（need02 过渡期双写：SSOT 在 connection.json，此处为只读镜像；B4 后删除）。
    /// 缺字段即默认 `agnes-image-2.5-flash`。
    #[serde(default = "default_model")]
    pub model: String,
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

/// need02 模型 SSOT 默认（与 `agnes::DEFAULT_MODEL` 同源；`connection.json` 缺字段回填此值）。
fn default_model() -> String {
    DEFAULT_MODEL.to_string()
}

impl Default for ImageQueueConfig {
    fn default() -> Self {
        Self {
            protocol: "agnes".to_string(),
            model: default_model(),
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
    /// need02 过渡期只读镜像（SSOT 在 connection.json；`iq_set_config` 忽略此字段）。
    #[serde(default = "default_model")]
    pub model: String,
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
            model: if self.model.trim().is_empty() {
                default_model()
            } else {
                self.model.clone()
            },
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
        // need02：模型走白名单（空即默认；非法直接拒绝，不回落）。
        self.model = validate_model(if self.model.trim().is_empty() {
            DEFAULT_MODEL
        } else {
            &self.model
        })?;
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
 
     /// need01-02B 连接快照：单发预览/保存命令改读此快照（client 指纹同理），队列规则字段不进入快照。
     pub fn connection_snapshot(&self) -> ConnectionSnapshot {
         ConnectionSnapshot {
             protocol: self.protocol.clone(),
             model: if self.model.trim().is_empty() { default_model() } else { self.model.clone() },
             api_base: self.api_base.clone(),
             api_key: self.api_key.clone(),
             proxy_on: self.proxy_on,
             proxy_url: self.proxy_url.clone(),
             connect_secs: self.connect_timeout_secs,
             total_secs: self.total_timeout_secs,
         }
     }
 }
 
 /// 连接快照（内存态，不落盘）：`iq_generate_one_preview / iq_save_preview` 改读此快照。
 #[derive(Debug, Clone)]
 pub struct ConnectionSnapshot {
     pub protocol: String,
     pub model: String,
     pub api_base: String,
     pub api_key: String,
     pub proxy_on: bool,
     pub proxy_url: String,
     pub connect_secs: u64,
     pub total_secs: u64,
 }

 pub fn config_file_path(data_dir: &Path) -> PathBuf {
     data_dir.join("image_queue.json")
 }
 
 /// need01-02B 连接独立文件（非敏感子集）。secrets 不动。
 /// 旧 image_queue.json 打开自动迁移：缺 connection.json 时从旧全量拆出连接字段写入。
 pub fn connection_file_path(data_dir: &Path) -> PathBuf {
     data_dir.join("connection.json")
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
 /// need01-02B：同时写 connection.json（连接子集）+ image_queue.json（全量兼容），secrets 不动。
 pub fn save_config(data_dir: &Path, cfg: &ImageQueueConfig) -> Result<(), String> {
     let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
     atomic_write(&config_file_path(data_dir), json.as_bytes())?;
     let conn = ConnectionFile::from_config(cfg);
     let conn_json = serde_json::to_string_pretty(&conn).map_err(|e| e.to_string())?;
     atomic_write(&connection_file_path(data_dir), conn_json.as_bytes())
 }
 
 /// 连接独立文件（非敏感子集，缺字段即默认，参考 validate 兼容写法）。
 #[derive(Debug, Clone, Serialize, Deserialize)]
 #[serde(rename_all = "camelCase")]
 pub struct ConnectionFile {
     #[serde(default = "default_protocol")]
     pub protocol: String,
     /// need02 模型 SSOT 唯一写点归属：缺字段即默认回填 + 补写文件（幂等）。
     #[serde(default = "default_model")]
     pub model: String,
     #[serde(default = "default_api_base")]
     pub api_base: String,
     #[serde(default)]
     pub proxy_on: bool,
     #[serde(default)]
     pub proxy_url: String,
     #[serde(default = "default_true_fn")]
     pub remember_key: bool,
     #[serde(default = "default_connect_timeout_secs")]
     pub connect_timeout_secs: u64,
     #[serde(default = "default_total_timeout_secs")]
     pub total_timeout_secs: u64,
 }
 
 fn default_protocol() -> String { "agnes".to_string() }
 fn default_api_base() -> String { DEFAULT_API_BASE.to_string() }
 fn default_true_fn() -> bool { true }

 impl Default for ConnectionFile {
     fn default() -> Self {
         Self {
             protocol: default_protocol(),
             model: default_model(),
             api_base: default_api_base(),
             proxy_on: false,
             proxy_url: String::new(),
             remember_key: default_true_fn(),
             connect_timeout_secs: default_connect_timeout_secs(),
             total_timeout_secs: default_total_timeout_secs(),
         }
     }
 }

 impl ConnectionFile {
     pub fn from_config(cfg: &ImageQueueConfig) -> Self {
         Self {
             protocol: cfg.protocol.clone(),
             model: if cfg.model.trim().is_empty() { default_model() } else { cfg.model.clone() },
             api_base: cfg.api_base.clone(),
             proxy_on: cfg.proxy_on,
             proxy_url: String::new(),
             remember_key: cfg.remember_key,
             connect_timeout_secs: cfg.connect_timeout_secs,
             total_timeout_secs: cfg.total_timeout_secs,
         }
     }
     pub fn apply_to(&self, cfg: &mut ImageQueueConfig) {
         cfg.protocol = self.protocol.clone();
         cfg.model = if self.model.trim().is_empty() { default_model() } else { self.model.clone() };
         cfg.api_base = self.api_base.clone();
         cfg.proxy_on = self.proxy_on;
         cfg.remember_key = self.remember_key;
         cfg.connect_timeout_secs = self.connect_timeout_secs;
         cfg.total_timeout_secs = self.total_timeout_secs;
     }
 }
 
 /// 启动加载：缺文件即 Default；文件损坏返回 Err（调用方记日志后回落 Default）。
 /// need01-02B 迁移：connection.json 存在则覆盖连接字段；缺失但旧 image_queue.json 存在则读旧全量并补写 connection.json。
 pub fn load_config(data_dir: &Path) -> Result<ImageQueueConfig, String> {
     let path = config_file_path(data_dir);
     let conn_path = connection_file_path(data_dir);
     if !path.exists() && !conn_path.exists() {
         return Ok(ImageQueueConfig::default());
     }
     let mut cfg = if path.exists() {
         let raw = std::fs::read_to_string(&path).map_err(|e| format!("读取配置失败 '{}': {}", path.display(), e))?;
         serde_json::from_str::<ImageQueueConfig>(&raw).map_err(|e| format!("配置解析失败: {}", e))?
     } else {
         ImageQueueConfig::default()
     };
     if conn_path.exists() {
         if let Ok(raw) = std::fs::read_to_string(&conn_path) {
             if let Ok(mut conn) = serde_json::from_str::<ConnectionFile>(&raw) {
                 // need02：缺 model 即默认回填 + 补写文件（幂等，失败不阻断启动）。
                 if conn.model.trim().is_empty() {
                     conn.model = default_model();
                     if let Ok(conn_json) = serde_json::to_string_pretty(&conn) {
                         let _ = atomic_write(&conn_path, conn_json.as_bytes());
                     }
                 }
                 conn.apply_to(&mut cfg);
             }
         }
     } else if path.exists() {
         // 一次性迁移读取：旧全量拆出连接子集落盘（失败不阻断启动）
         let conn = ConnectionFile::from_config(&cfg);
         if let Ok(conn_json) = serde_json::to_string_pretty(&conn) {
             let _ = atomic_write(&conn_path, conn_json.as_bytes());
         }
     }
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

/// HTTP client 指纹：`(api_base, proxy_on, proxy_url, timeout, model)` 一致则复用。
/// need02：换模型即换 client，不污染旧连接复用。
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct ClientFingerprint {
    pub api_base: String,
    pub model: String,
    pub proxy_on: bool,
    pub proxy_url: String,
    pub connect_secs: u64,
    pub total_secs: u64,
}

impl ClientFingerprint {
    pub fn of(cfg: &ImageQueueConfig) -> Self {
        Self {
            api_base: cfg.api_base.clone(),
            model: if cfg.model.trim().is_empty() { default_model() } else { cfg.model.clone() },
            proxy_on: cfg.proxy_on,
            proxy_url: if cfg.proxy_on { cfg.proxy_url.clone() } else { String::new() },
            connect_secs: cfg.connect_timeout_secs,
            total_secs: cfg.total_timeout_secs,
        }
    }

    /// need02：模型快照直构指纹（队列 worker / 单发 / model_test 共用同一换 client 语义）。
    pub fn of_snapshot(snap: &ConnectionSnapshot) -> Self {
        Self {
            api_base: snap.api_base.clone(),
            model: if snap.model.trim().is_empty() { default_model() } else { snap.model.clone() },
            proxy_on: snap.proxy_on,
            proxy_url: if snap.proxy_on { snap.proxy_url.clone() } else { String::new() },
            connect_secs: snap.connect_secs,
            total_secs: snap.total_secs,
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

// ------------------------------------------------------------------
// need02 模型 SSOT 视图与纯函数（`model_*` 三命令 + `queue.rs` 命令层共用；
// 命令层只做锁/落盘编排，校验与占位语义全部在此）
// ------------------------------------------------------------------

/// 模型配置视图（唯一可写面的 DTO）：`apiKey/proxyUrl` 占位语义与 `ImageQueueConfigView` 一致，
/// 明文永不经此视图外泄；队列规则字段不在此出现。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfigView {
    pub protocol: String,
    #[serde(default = "default_model")]
    pub model: String,
    pub api_base: String,
    pub api_key: String,
    #[serde(default)]
    pub api_key_masked: String,
    pub proxy_on: bool,
    pub proxy_url: String,
    pub remember_key: bool,
    pub connect_timeout_secs: u64,
    pub total_timeout_secs: u64,
}

/// 空即默认（队列 worker / 单发 / 内嵌 meta 统一经此读模型，防空串进请求体）。
pub fn model_or_default(cfg: &ImageQueueConfig) -> String {
    if cfg.model.trim().is_empty() {
        default_model()
    } else {
        cfg.model.clone()
    }
}

/// 内存配置 → 模型视图（占位/脱敏语义与 `ImageQueueConfig::view` 一致）。
pub fn model_view_of(cfg: &ImageQueueConfig) -> ModelConfigView {
    ModelConfigView {
        protocol: cfg.protocol.clone(),
        model: model_or_default(cfg),
        api_base: cfg.api_base.clone(),
        api_key: if cfg.api_key.is_empty() {
            String::new()
        } else {
            KEY_SET_PLACEHOLDER.to_string()
        },
        api_key_masked: if cfg.api_key.is_empty() {
            String::new()
        } else {
            mask_secret(&cfg.api_key)
        },
        proxy_on: cfg.proxy_on,
        proxy_url: if cfg.proxy_url.is_empty() {
            String::new()
        } else {
            KEY_SET_PLACEHOLDER.to_string()
        },
        remember_key: cfg.remember_key,
        connect_timeout_secs: cfg.connect_timeout_secs,
        total_timeout_secs: cfg.total_timeout_secs,
    }
}

impl ModelConfigView {
    /// 校验 + 钳制（`model_set` 入口调用；调用方须先把 `__SET__` 解析为真值再调）。
    pub fn validate_and_normalize(&mut self) -> Result<(), String> {
        if !SUPPORTED_PROTOCOLS.contains(&self.protocol.as_str()) {
            return Err(format!("不支持的协议：{}（一期仅支持 agnes）", self.protocol));
        }
        let m = if self.model.trim().is_empty() {
            DEFAULT_MODEL.to_string()
        } else {
            self.model.trim().to_string()
        };
        self.model = validate_model(&m)?;
        let base = self.api_base.trim().trim_end_matches('/').to_string();
        if !(base.starts_with("http://") || base.starts_with("https://")) {
            return Err("API 路径必须以 http(s):// 开头".to_string());
        }
        self.api_base = base;
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
}

/// 模型视图回填内存配置（仅模型 8 项 + key；队列规则字段不动）。
pub fn apply_model_view(cfg: &mut ImageQueueConfig, v: &ModelConfigView) {
    cfg.protocol = v.protocol.clone();
    cfg.model = v.model.clone();
    cfg.api_base = v.api_base.clone();
    cfg.api_key = v.api_key.clone();
    cfg.proxy_on = v.proxy_on;
    cfg.proxy_url = v.proxy_url.clone();
    cfg.remember_key = v.remember_key;
    cfg.connect_timeout_secs = v.connect_timeout_secs;
    cfg.total_timeout_secs = v.total_timeout_secs;
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
 
     #[test]
     fn legacy_image_queue_migrates_to_connection_json() {
         // need01-02B：旧 image_queue.json 打开自动迁移不断连
         let dir = std::env::temp_dir().join(format!("pmf_iq_mig_{}", uuid::Uuid::new_v4()));
         std::fs::create_dir_all(&dir).unwrap();
         let mut c = ImageQueueConfig::default();
         c.api_base = "https://old.example.com".into();
         c.output_dir = "/tmp/q".into();
         let json = serde_json::to_string_pretty(&c).unwrap();
         std::fs::write(config_file_path(&dir), json).unwrap();
         assert!(!connection_file_path(&dir).exists());
         let back = load_config(&dir).unwrap();
         assert_eq!(back.api_base, "https://old.example.com");
         assert_eq!(back.output_dir, "/tmp/q");
         assert!(connection_file_path(&dir).exists());
         // 快照仅连接字段
         let snap = back.connection_snapshot();
         assert_eq!(snap.api_base, "https://old.example.com");
         let _ = std::fs::remove_dir_all(&dir);
     }

     #[test]
     fn default_model_is_pinned_whitelist_value() {
         // need02 B1：默认模型即白名单唯一值
         let c = ImageQueueConfig::default();
         assert_eq!(c.model, "agnes-image-2.5-flash");
         assert_eq!(default_model(), "agnes-image-2.5-flash");
         let conn = ConnectionFile::default();
         assert_eq!(conn.model, "agnes-image-2.5-flash");
     }

     #[test]
     fn legacy_payload_missing_model_defaults() {
         // need02 B1：旧 image_queue.json / 旧前端 payload 无 model 字段 → 默认回填
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
         let cfg: ImageQueueConfig = serde_json::from_value(raw).expect("旧配置应兼容 model 默认值");
         assert_eq!(cfg.model, "agnes-image-2.5-flash");
         assert_eq!(cfg.view().model, "agnes-image-2.5-flash");
         // 旧 connection.json 同理
         let conn_raw = serde_json::json!({ "protocol": "agnes", "apiBase": DEFAULT_API_BASE });
         let conn: ConnectionFile = serde_json::from_value(conn_raw).expect("旧 connection.json 应兼容 model 默认值");
         assert_eq!(conn.model, "agnes-image-2.5-flash");
     }

     #[test]
     fn validate_rejects_bad_model() {
         // need02 B2：非法 model 前后端一致拒绝（中文 Err）
         let mut c = ImageQueueConfig::default();
         c.model = "gpt-4".into();
         let err = c.validate_and_normalize().unwrap_err();
         assert!(err.contains("不支持的模型"), "实际：{}", err);
         let mut v = model_view_of(&ImageQueueConfig::default());
         v.model = "  ".into();
         v.validate_and_normalize().unwrap();
         assert_eq!(v.model, "agnes-image-2.5-flash");
         let mut v2 = model_view_of(&ImageQueueConfig::default());
         v2.model = "evil-model".into();
         assert!(v2.validate_and_normalize().is_err());
     }

     #[test]
     fn model_view_masks_key_and_serializes_no_plaintext() {
         // need02 B2：ModelConfigView 占位/脱敏语义与 iq view 一致，明文永不外泄
         let mut c = ImageQueueConfig::default();
         c.api_key = "sk-secret-abcdef123456".into();
         let v = model_view_of(&c);
         assert_eq!(v.model, "agnes-image-2.5-flash");
         assert_eq!(v.api_key, "__SET__");
         assert!(!v.api_key_masked.is_empty());
         let json = serde_json::to_string(&v).unwrap();
         assert!(!json.contains("sk-secret-abcdef123456"));
     }

     #[test]
     fn model_or_default_falls_back_on_blank() {
         let mut c = ImageQueueConfig::default();
         c.model = "   ".into();
         assert_eq!(model_or_default(&c), "agnes-image-2.5-flash");
     }

     #[test]
     fn apply_model_view_only_touches_model_fields() {
         // need02 B2：回填仅动模型 8 项 + key，队列规则不动
         let mut c = ImageQueueConfig::default();
         c.size = "4K".into();
         c.concurrency = 7;
         let mut v = model_view_of(&c);
         v.api_base = "https://new.example.com".into();
         v.model = "agnes-image-2.5-flash".into();
         v.connect_timeout_secs = 30;
         apply_model_view(&mut c, &v);
         assert_eq!(c.api_base, "https://new.example.com");
         assert_eq!(c.model, "agnes-image-2.5-flash");
         assert_eq!(c.connect_timeout_secs, 30);
         assert_eq!(c.size, "4K");
         assert_eq!(c.concurrency, 7);
     }

     #[test]
     fn fingerprint_includes_model() {
         // need02 B2：换模型即换 client 指纹
         let a = ImageQueueConfig::default();
         let fp_a = ClientFingerprint::of(&a);
         let mut b = ImageQueueConfig::default();
         b.model = "agnes-image-2.5-flash".into();
         assert_eq!(fp_a, ClientFingerprint::of(&b));
         let snap = a.connection_snapshot();
         assert_eq!(snap.model, "agnes-image-2.5-flash");
         assert_eq!(ClientFingerprint::of_snapshot(&snap), fp_a);
     }

     #[test]
     fn connection_json_missing_model_backfills_temp_io() {
         // need02 B1：connection.json 缺 model → 默认回填 + 补写文件（幂等）
         let dir = std::env::temp_dir().join(format!("pmf_iq_model_{}", uuid::Uuid::new_v4()));
         std::fs::create_dir_all(&dir).unwrap();
         let raw = serde_json::json!({ "protocol": "agnes", "apiBase": "https://old.example.com" });
         std::fs::write(connection_file_path(&dir), serde_json::to_string_pretty(&raw).unwrap()).unwrap();
         let back = load_config(&dir).unwrap();
         assert_eq!(back.model, "agnes-image-2.5-flash");
         let reread: ConnectionFile = serde_json::from_str(
             &std::fs::read_to_string(connection_file_path(&dir)).unwrap(),
         )
         .unwrap();
         assert_eq!(reread.model, "agnes-image-2.5-flash");
         let _ = std::fs::remove_dir_all(&dir);
     }
 }
