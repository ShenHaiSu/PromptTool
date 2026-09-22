//! 生图队列调度、并发、落盘（need05 B2）。
//!
//! - 任务状态机：Queued → Running → Succeeded / Failed / Cancelled；
//!   Failed / Cancelled 可 `iq_retry` 回 Queued（`retry_count` 不清零，沿用剩余次数）。
//! - 并发：`tokio::Semaphore` 全链路占用（含下载）；`iq_set_config` 热更新用
//!   `add_permits` / `try_acquire + forget`，运行中不重建在途信号量。
//! - 循环补货：后端不直接调随机引擎；`loop_enabled` 且饥饿时 emit `hungry`，前端补货。
//! - 锁顺序（防死锁）：永远先 `order` 后 `tasks`。
//!
//! 事件（`app.emit`，命名空间固定前缀）：
//! - `image-queue://task-updated` 单任务变迁；`image-queue://stats` 计数；
//! - `image-queue://hungry` 饥饿补货 `{want}`；`image-queue://halted` 停止/熔断。

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use super::agnes::{generate_one, mask_secret, AgnesProvider, IqError, PROBE_PROMPT, SUPPORTED_RATIOS, SUPPORTED_SIZES};
use super::config::{
    build_client, delete_secrets, load_config, load_secrets, save_config, save_secrets, ClientFingerprint,
    ImageQueueConfig, ImageQueueConfigView, KEY_SET_PLACEHOLDER,
};
use super::embed::{embed_jpg, embed_png, extract_embedded_meta};

// ------------------------------------------------------------------
// 常量
// ------------------------------------------------------------------

/// 队列总量上限（含 finished），超限拒绝新入队。
pub const MAX_TASKS: usize = 2000;
/// 熔断阈值：连续失败 ≥ 5 自动 stop。
pub const MAX_CONSEC_FAIL: usize = 5;
/// 磁盘水位：输出目录所在盘剩余 < 500MB 即 halted(disk)。
pub const DISK_WATERLINE_BYTES: u64 = 500 * 1024 * 1024;
/// prompt 上限字符数（Agnes 未明示，超限截断，不拒绝）。
pub const PROMPT_MAX_CHARS: usize = 4000;
/// 可重试错误的最多重试次数。
pub const MAX_RETRY: u8 = 2;
/// 单张图片下载上限 100MB，超限中止。
pub const MAX_IMAGE_BYTES: u64 = 100 * 1024 * 1024;
/// Agnes 模型名（图片内嵌 meta 用）。
const AGNES_MODEL: &str = "agnes-image-2.5-flash";

pub const EVT_TASK_UPDATED: &str = "image-queue://task-updated";
pub const EVT_STATS: &str = "image-queue://stats";
pub const EVT_HUNGRY: &str = "image-queue://hungry";
pub const EVT_HALTED: &str = "image-queue://halted";

// ------------------------------------------------------------------
// 数据结构
// ------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskStatus::Queued => "queued",
            TaskStatus::Running => "running",
            TaskStatus::Succeeded => "succeeded",
            TaskStatus::Failed => "failed",
            TaskStatus::Cancelled => "cancelled",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "queued" => Some(TaskStatus::Queued),
            "running" => Some(TaskStatus::Running),
            "succeeded" => Some(TaskStatus::Succeeded),
            "failed" => Some(TaskStatus::Failed),
            "cancelled" => Some(TaskStatus::Cancelled),
            _ => None,
        }
    }
}

/// 状态变迁合法性表（单测覆盖，非法变迁拒绝）。
pub fn can_transition(from: TaskStatus, to: TaskStatus) -> bool {
    matches!(
        (from, to),
        (TaskStatus::Queued, TaskStatus::Running)
            | (TaskStatus::Queued, TaskStatus::Cancelled)
            | (TaskStatus::Running, TaskStatus::Succeeded)
            | (TaskStatus::Running, TaskStatus::Failed)
            | (TaskStatus::Running, TaskStatus::Cancelled)
            | (TaskStatus::Failed, TaskStatus::Queued)
            | (TaskStatus::Cancelled, TaskStatus::Queued)
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageTask {
    /// uuid v4。
    pub id: String,
    /// 英文终稿原文（超长已截断）。
    pub prompt: String,
    pub ir_hash: Option<String>,
    /// 下单时刻快照（配置后改不影响已入队）。
    pub size: String,
    pub ratio: String,
    pub status: TaskStatus,
    pub image_url: Option<String>,
    pub file_path: Option<String>,
    pub elapsed_ms: Option<u128>,
    pub error: Option<String>,
    /// 上限 2（仅 Retryable 消耗）。
    pub retry_count: u8,
    /// chrono Utc 秒。
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueItem {
    pub prompt: String,
    pub ir_hash: Option<String>,
    /// 一键复用下单（need06 复用 Dialog）：单条指定的 size/ratio；缺省或非法时回落当前配置快照。
    #[serde(default)]
    pub size: Option<String>,
    #[serde(default)]
    pub ratio: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueResult {
    pub task_id: Option<String>,
    pub skipped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResult {
    pub total: usize,
    pub items: Vec<ImageTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionResult {
    pub ok: bool,
    pub elapsed_ms: Option<u128>,
    pub stage: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsPayload {
    pub queued: usize,
    pub running: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub consec_fail: usize,
    pub stopped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HungryPayload {
    pub want: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HaltedPayload {
    /// manual | circuit | io | disk
    pub reason: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetConfigResult {
    #[serde(flatten)]
    pub config: ImageQueueConfigView,
}

pub struct ImageQueueState {
    // 注：B2 设计写 RwLock，此处用 std Mutex 等价实现（临界区短、无跨 await 持锁，
    // 且读写锁在调度循环的“读-升级-写”路径上有死锁风险；仍满足“std 同步原语”约束）。
    pub config: Mutex<ImageQueueConfig>,
    /// 全量任务（含 finished，上限 2000）。
    pub tasks: Mutex<HashMap<String, ImageTask>>,
    /// 入队顺序（分页拉取用）。
    pub order: Mutex<VecDeque<String>>,
    /// 当前 running 计数（信号量外再计一次，供 hungry 判断）。
    pub running: AtomicUsize,
    /// 连续失败计数（成功清零，≥5 熔断）。
    pub consec_fail: AtomicUsize,
    /// true = 已停止/熔断/自然结束，调度循环退出。
    pub stop_flag: AtomicBool,
    /// 每次 start 自增，旧调度循环凭此退出（防 start/stop 竞态）。
    pub generation: AtomicU64,
    /// 调度循环是否在运行（`start` 幂等凭据）。
    pub scheduler_active: AtomicBool,
    /// 并发信号量（热更新时原地 add_permits / 空闲时重建）。
    pub semaphore: Mutex<std::sync::Arc<tokio::sync::Semaphore>>,
    /// client 指纹缓存（上限 4，超限清最旧）。
    pub client_cache: Mutex<HashMap<ClientFingerprint, reqwest::Client>>,
    /// running worker 的 abort 句柄（`iq_stop` 取消用）。
    pub handles: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>,
}

impl ImageQueueState {
    pub fn new(cfg: ImageQueueConfig) -> Self {
        let cap = cfg.concurrency_capped();
        Self {
            config: Mutex::new(cfg),
            tasks: Mutex::new(HashMap::new()),
            order: Mutex::new(VecDeque::new()),
            running: AtomicUsize::new(0),
            consec_fail: AtomicUsize::new(0),
            stop_flag: AtomicBool::new(true),
            generation: AtomicU64::new(0),
            scheduler_active: AtomicBool::new(false),
            semaphore: Mutex::new(std::sync::Arc::new(tokio::sync::Semaphore::new(cap))),
            client_cache: Mutex::new(HashMap::new()),
            handles: Mutex::new(HashMap::new()),
        }
    }

    /// 取快照 client：指纹命中复用，未命中构造并缓存。
    /// 运行中任务继续用旧 client（快照语义），新任务取新指纹。
    pub fn client_for(&self, cfg: &ImageQueueConfig) -> Result<reqwest::Client, String> {
        let fp = ClientFingerprint::of(cfg);
        let mut cache = self.client_cache.lock().map_err(|e| format!("client 缓存锁失败：{}", e))?;
        if let Some(c) = cache.get(&fp) {
            return Ok(c.clone());
        }
        let client = build_client(&fp)?;
        if cache.len() >= 4 {
            if let Some(k) = cache.keys().next().cloned() {
                cache.remove(&k);
            }
        }
        cache.insert(fp, client.clone());
        Ok(client)
    }
}

/// 启动时构造 state：加载 `image_queue.json` +（记住时）secrets；失败记日志回落 Default。
pub fn init_state(app: &AppHandle) -> ImageQueueState {
    let mut cfg = ImageQueueConfig::default();
    let data_dir = super::super::migration::data_dir_for(app)
        .map_err(|e| {
            eprintln!("[image-queue] data_dir 失败，使用默认配置：{}", e);
            e
        })
        .ok();
    if let Some(dir) = data_dir {
        match load_config(&dir) {
            Ok(c) => cfg = c,
            Err(e) => eprintln!("[image-queue] 加载配置失败，使用默认：{}", e),
        }
        // 记住闭环：remember_key 且 secrets 存在 → 恢复内存 key/proxy。
        if cfg.remember_key {
            match load_secrets(&dir) {
                Ok(Some((k, p))) => {
                    cfg.api_key = k;
                    if !p.is_empty() {
                        cfg.proxy_url = p;
                    }
                }
                Ok(None) => {}
                Err(e) => eprintln!("[image-queue] 加载 secrets 失败：{}", e),
            }
        }
    }
    ImageQueueState::new(cfg)
}

// ------------------------------------------------------------------
// 纯函数（单测覆盖，无 IO / 无 AppHandle）
// ------------------------------------------------------------------

/// prompt 归一化：trim + 连续空白折叠（去重键用）。
pub fn normalize_prompt_key(prompt: &str) -> String {
    prompt.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 去重键：`ir_hash` 有则按 hash，无则按归一化 prompt。
pub fn dedupe_key(ir_hash: Option<&str>, prompt: &str) -> String {
    match ir_hash.map(str::trim).filter(|s| !s.is_empty()) {
        Some(h) => format!("hash:{}", h),
        None => format!("prompt:{}", normalize_prompt_key(prompt)),
    }
}

/// prompt djb2 变体 hash（文件名 hash8 用，稳定可复现）。
pub fn prompt_hash8(prompt: &str) -> String {
    let mut h: u64 = 5381;
    for b in prompt.as_bytes() {
        h = h.wrapping_mul(33).wrapping_add(*b as u64);
    }
    format!("{:08x}", h & 0xffff_ffff)
}

/// 单条入队的 size/ratio 决议（一键复用下单用）：item 值经 trim 后在白名单则采用，
/// 否则回落当前配置快照（旧前端不送这两字段时行为与 need05 一致）。
pub fn resolve_item_size_ratio(
    item_size: Option<&str>,
    item_ratio: Option<&str>,
    cfg_size: &str,
    cfg_ratio: &str,
) -> (String, String) {
    let size = item_size
        .map(str::trim)
        .filter(|s| SUPPORTED_SIZES.contains(s))
        .unwrap_or(cfg_size)
        .to_string();
    let ratio = item_ratio
        .map(str::trim)
        .filter(|s| SUPPORTED_RATIOS.contains(s))
        .unwrap_or(cfg_ratio)
        .to_string();
    (size, ratio)
}

/// 文件名模板：`{yyyyMMdd_HHmmss}_{seq}_{size}_{ratio}_{hash8}.{ext}`。
pub fn build_image_filename(date_prefix: &str, seq: usize, size: &str, ratio: &str, prompt: &str, ext: &str) -> String {
    let ratio_safe = ratio.replace(':', "-");
    format!(
        "{}_{:03}_{}_{}_{}.{}",
        date_prefix,
        seq,
        size,
        ratio_safe,
        prompt_hash8(prompt),
        ext
    )
}

/// content-type → 扩展名（非图片返回 None，调用方记失败）。
pub fn ext_for_content_type(ct: &str) -> Option<&'static str> {
    let ct = ct.split(';').next().unwrap_or("").trim().to_lowercase();
    match ct.as_str() {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        "image/bmp" => Some("bmp"),
        _ => None,
    }
}

/// 图片魔数校验（PNG / JPEG / GIF / WEBP / BMP）。
pub fn has_image_magic(head: &[u8]) -> bool {
    if head.len() >= 8 && head[..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        return true; // PNG
    }
    if head.len() >= 3 && head[..3] == [0xFF, 0xD8, 0xFF] {
        return true; // JPEG
    }
    if head.len() >= 6 && (head[..6] == *b"GIF87a" || head[..6] == *b"GIF89a") {
        return true; // GIF
    }
    if head.len() >= 12 && head[..4] == *b"RIFF" && head[8..12] == *b"WEBP" {
        return true; // WEBP
    }
    if head.len() >= 2 && head[..2] == *b"BM" {
        return true; // BMP
    }
    false
}

fn lexical_normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in p.components() {
        match comp {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            c => out.push(c.as_os_str()),
        }
    }
    out
}

/// 目录归一（纯路径计算，不触碰 fs；`ensure_image_dir` 负责创建 + 可写探测）：
/// - `""` → `{data_dir}/output/images`；
/// - 相对 → 相对 data_dir 拼接（strip 历史 `data/` 前缀，与 export 一致）；
/// - 绝对 → 直接用。
pub fn normalize_image_dir_for(data_dir: &Path, input: &str) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Ok(data_dir.join("output").join("images"));
    }
    let mut raw = PathBuf::from(trimmed);
    if !raw.is_absolute() {
        let s = raw.to_string_lossy().replace('\\', "/");
        if s == "data" {
            return Ok(data_dir.join("output").join("images"));
        }
        if let Some(stripped) = s.strip_prefix("data/") {
            raw = PathBuf::from(stripped);
        }
        if raw.as_os_str().is_empty() {
            return Ok(data_dir.join("output").join("images"));
        }
        raw = data_dir.join(raw);
    }
    Ok(lexical_normalize(&raw))
}

fn unique_filename_in(dir: &Path, stem: &str) -> PathBuf {
    let candidate = dir.join(stem);
    if !candidate.exists() {
        return PathBuf::from(stem);
    }
    let dot = stem.rfind('.');
    let (base, ext) = if let Some(idx) = dot { (&stem[..idx], &stem[idx..]) } else { (stem, "") };
    for i in 1..100 {
        let name = format!("{}-{}{}", base, i, ext);
        if !dir.join(&name).exists() {
            return PathBuf::from(name);
        }
    }
    let ms = chrono::Local::now().timestamp_millis() % 1000;
    PathBuf::from(format!("{}-{}{}", base, ms, ext))
}

/// 重试退避：1s → 3s。
pub fn backoff_for(retry_count: u8) -> std::time::Duration {
    match retry_count {
        0 => std::time::Duration::from_secs(1),
        _ => std::time::Duration::from_secs(3),
    }
}

// ------------------------------------------------------------------
// 事件 emit
// ------------------------------------------------------------------

fn emit_task(app: &AppHandle, task: &ImageTask) {
    let _ = app.emit(EVT_TASK_UPDATED, task);
}

fn compute_stats(state: &ImageQueueState) -> StatsPayload {
    let tasks = state.tasks.lock().map(|t| t.values().fold((0, 0, 0, 0), |mut acc, task| {
        match task.status {
            TaskStatus::Queued => acc.0 += 1,
            TaskStatus::Running => acc.1 += 1,
            TaskStatus::Succeeded => acc.2 += 1,
            TaskStatus::Failed | TaskStatus::Cancelled => acc.3 += 1,
        }
        acc
    }));
    let (queued, running, succeeded, failed) = tasks.unwrap_or_default();
    StatsPayload {
        queued,
        running,
        succeeded,
        failed,
        consec_fail: state.consec_fail.load(Ordering::SeqCst),
        stopped: state.stop_flag.load(Ordering::SeqCst),
    }
}

fn emit_stats(app: &AppHandle, state: &ImageQueueState) {
    let _ = app.emit(EVT_STATS, compute_stats(state));
}

fn emit_halted(app: &AppHandle, reason: &str, message: String) {
    let _ = app.emit(
        EVT_HALTED,
        HaltedPayload { reason: reason.to_string(), message },
    );
}

// ------------------------------------------------------------------
// 磁盘水位（Windows GetDiskFreeSpaceExW 直调，零依赖；非 Windows 暂跳过二期补 statvfs）
// ------------------------------------------------------------------

#[cfg(target_os = "windows")]
#[link(name = "kernel32")]
extern "system" {
    fn GetDiskFreeSpaceExW(
        lp_directory_name: *const u16,
        lp_free_bytes_available: *mut u64,
        lp_total_number_of_bytes: *mut u64,
        lp_total_number_of_free_bytes: *mut u64,
    ) -> i32;
}

fn check_disk_space(dir: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let wide: Vec<u16> = dir.to_string_lossy().encode_utf16().chain(std::iter::once(0)).collect();
        let mut free: u64 = 0;
        let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), std::ptr::null_mut(), std::ptr::null_mut(), &mut free) };
        if ok == 0 {
            // 查不到水位不拦路（记日志即可），避免误杀正常任务。
            eprintln!("[image-queue] 磁盘水位查询失败，放行：{}", dir.display());
            return Ok(());
        }
        if free < DISK_WATERLINE_BYTES {
            return Err(format!("磁盘剩余空间不足 500MB（剩余 {}MB），已停止", free / 1024 / 1024));
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        // 二期补 statvfs 封装；一期放行。
        let _ = dir;
        Ok(())
    }
}

// ------------------------------------------------------------------
// 落盘
// ------------------------------------------------------------------

fn ensure_image_dir(app: &AppHandle, input: &str) -> Result<PathBuf, String> {
    let data_dir = super::super::migration::data_dir_for(app)?;
    let dir = normalize_image_dir_for(&data_dir, input)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("目录不存在且无法创建 '{}': {}", dir.display(), e))?;
    let probe = dir.join(".pmf_write_probe.tmp");
    match std::fs::write(&probe, b"probe") {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
        }
        Err(e) => return Err(format!("输出目录不可写 '{}': {}", dir.display(), e)),
    }
    Ok(dir)
}

fn same_day_count(tasks: &HashMap<String, ImageTask>, now_ts: i64) -> usize {
    let day = chrono::DateTime::from_timestamp(now_ts, 0)
        .map(|d| d.date_naive())
        .unwrap_or_else(|| chrono::Utc::now().date_naive());
    tasks
        .values()
        .filter(|t| {
            chrono::DateTime::from_timestamp(t.created_at, 0)
                .map(|d| d.date_naive() == day)
                .unwrap_or(false)
        })
        .count()
}

/// 有界内存累积下载 + 落盘：累积 `Vec<u8>`（复用 100MB 守卫）→ 魔数校验
/// + PNG-iTXt / JPG-COM 内嵌元数据（embed-only，无 sidecar）→ 写 `.tmp` → 原子 rename。
/// 与 API 共用同一 client（保证代理环境一致）。
async fn download_and_persist(
    app: &AppHandle,
    state: &ImageQueueState,
    client: &reqwest::Client,
    cfg: &ImageQueueConfig,
    task: &ImageTask,
    url: &str,
    elapsed_ms: u128,
) -> Result<String, String> {
    let dir = ensure_image_dir(app, &cfg.output_dir).map_err(|e| format!("io:{}", e))?;
    check_disk_space(&dir).map_err(|e| format!("disk:{}", e))?;

    let resp = client.get(url).send().await.map_err(|e| format!("下载请求失败：{}", e))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("图片下载失败（{}）", status.as_u16()));
    }
    let ct = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let ext = ext_for_content_type(&ct).ok_or_else(|| format!("图片响应 content-type 非图片：{}", ct))?;
    if let Some(len) = resp.content_length() {
        if len > MAX_IMAGE_BYTES {
            return Err("图片超过 100MB 上限，已中止".to_string());
        }
    }

    let now_ts = chrono::Utc::now().timestamp();
    let date_prefix = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let seq = {
        let tasks = state.tasks.lock().map_err(|e| format!("任务锁失败：{}", e))?;
        same_day_count(&tasks, now_ts) + 1
    };
    let stem = build_image_filename(&date_prefix, seq, &task.size, &task.ratio, &task.prompt, ext);
    let fname = unique_filename_in(&dir, &stem);
    let tmp_path = dir.join(format!("{}.tmp", fname.to_string_lossy()));
    let final_path = dir.join(&fname);

    // 有界内存累积（futures::StreamExt，reqwest "stream" feature）。
    use futures::StreamExt;
    let mut buf: Vec<u8> = Vec::new();
    let mut stream = resp.bytes_stream();
    let mut total: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("下载中断：{}", e))?;
        total += bytes.len() as u64;
        if total > MAX_IMAGE_BYTES {
            let _ = tokio::fs::remove_file(&tmp_path).await;
            return Err("图片超过 100MB 上限，已中止".to_string());
        }
        buf.extend_from_slice(&bytes);
    }
    if !has_image_magic(&buf[..buf.len().min(16)]) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err("下载内容魔数校验失败（非 PNG/JPEG/GIF/WEBP/BMP）".to_string());
    }
    // 内嵌元数据（仅 png/jpg；失败回退原图，任务仍成功）。
    let meta = serde_json::json!({
        "prompt": task.prompt,
        "irHash": task.ir_hash,
        "size": task.size,
        "ratio": task.ratio,
        "model": AGNES_MODEL,
        "imageUrl": url,
        "elapsedMs": elapsed_ms,
        "createdAt": task.created_at,
        "taskId": task.id,
    });
    let meta_bytes = serde_json::to_string(&meta).unwrap_or_default().into_bytes();
    let out: Vec<u8> = if cfg.embed_meta {
        match ext {
            "png" => embed_png(&buf, &meta_bytes).unwrap_or_else(|e| {
                eprintln!("[image-queue] png 嵌入失败，回退原图：{}", e);
                buf.clone()
            }),
            "jpg" => embed_jpg(&buf, &meta_bytes).unwrap_or_else(|e| {
                eprintln!("[image-queue] jpg 嵌入失败，回退原图：{}", e);
                buf.clone()
            }),
            _ => buf,
        }
    } else {
        buf
    };
    tokio::fs::write(&tmp_path, &out).await.map_err(|e| format!("io:写入失败：{}", e))?;
    std::fs::rename(&tmp_path, &final_path).map_err(|e| format!("io:文件重命名失败：{}", e))?;
    Ok(final_path.to_string_lossy().to_string())
}

// ------------------------------------------------------------------
// 调度循环 + worker
// ------------------------------------------------------------------

/// 顺序取最早 Queued 任务 id（锁内只读，标记在拿到 permit 后做，避免幽灵 Running）。
fn peek_next_queued(state: &ImageQueueState) -> Option<String> {
    let order = state.order.lock().ok()?;
    let tasks = state.tasks.lock().ok()?;
    // 锁顺序：order → tasks（全模块统一）。
    for id in order.iter() {
        if let Some(t) = tasks.get(id) {
            if t.status == TaskStatus::Queued {
                return Some(id.clone());
            }
        }
    }
    None
}

fn count_queued(state: &ImageQueueState) -> usize {
    state.tasks.lock().map(|t| t.values().filter(|x| x.status == TaskStatus::Queued).count()).unwrap_or(0)
}

async fn scheduler_loop(app: AppHandle) {
    let gen: u64 = app.state::<ImageQueueState>().generation.load(Ordering::SeqCst);
    loop {
        // 快照（不跨 await 持锁）。
        let (stopped, cur_gen, loop_enabled, concurrency, running_n, queued_n) = {
            let st = app.state::<ImageQueueState>();
            (
                st.stop_flag.load(Ordering::SeqCst),
                st.generation.load(Ordering::SeqCst),
                st.config.lock().map(|c| c.loop_enabled).unwrap_or(false),
                st.config.lock().map(|c| c.concurrency_capped()).unwrap_or(2),
                st.running.load(Ordering::SeqCst),
                count_queued(&st),
            )
        };
        if stopped || cur_gen != gen {
            break;
        }
        if let Some(task_id) = peek_next_queued(&app.state::<ImageQueueState>()) {
            let sem = {
                let st = app.state::<ImageQueueState>();
                st.semaphore.lock().map(|s| s.clone()).unwrap_or_else(|_| std::sync::Arc::new(tokio::sync::Semaphore::new(2)))
            };
            let permit = match sem.acquire_owned().await {
                Ok(p) => p,
                Err(_) => break, // 信号量关闭
            };
            {
                let st = app.state::<ImageQueueState>();
                if st.stop_flag.load(Ordering::SeqCst) || st.generation.load(Ordering::SeqCst) != gen {
                    drop(permit);
                    break;
                }
                // 拿到 permit 后原子标记 Running（仍为 Queued 才可拿）。
                let taken = {
                    let mut tasks = match st.tasks.lock() {
                        Ok(t) => t,
                        Err(_) => {
                            drop(permit);
                            continue;
                        }
                    };
                    match tasks.get_mut(&task_id) {
                        Some(t) if t.status == TaskStatus::Queued && can_transition(TaskStatus::Queued, TaskStatus::Running) => {
                            t.status = TaskStatus::Running;
                            Some(t.clone())
                        }
                        _ => None,
                    }
                };
                match taken {
                    Some(task) => {
                        st.running.fetch_add(1, Ordering::SeqCst);
                        emit_task(&app, &task);
                        emit_stats(&app, &st);
                        let handle = tokio::spawn(worker(app.clone(), task_id.clone(), permit));
                        if let Ok(mut h) = st.handles.lock() {
                            h.insert(task_id, handle);
                        }
                    }
                    None => {
                        drop(permit);
                        continue;
                    }
                }
            }
        } else {
            // 无 queued：饥饿补货 / 自然结束 / 轮询。
            if loop_enabled && running_n == 0 && queued_n == 0 {
                let want = concurrency.saturating_sub(running_n).max(1);
                let _ = app.emit(EVT_HUNGRY, HungryPayload { want });
                tokio::time::sleep(std::time::Duration::from_millis(800)).await;
            } else if !loop_enabled && running_n == 0 && queued_n == 0 {
                // 自然收尾：emit stats 即可，不 toast 打扰。
                let st = app.state::<ImageQueueState>();
                st.stop_flag.store(true, Ordering::SeqCst);
                emit_stats(&app, &st);
                break;
            } else {
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            }
        }
    }
    // 退出：若 generation 仍是自己，清除 active（halt/stop 已自清，不干扰新循环）。
    {
        let st = app.state::<ImageQueueState>();
        if st.generation.load(Ordering::SeqCst) == gen {
            st.scheduler_active.store(false, Ordering::SeqCst);
        }
    }
}

async fn worker(app: AppHandle, task_id: String, _permit: tokio::sync::OwnedSemaphorePermit) {
    // 快照配置 + client（任务不受中途改配置影响）。
    let (cfg, client_res) = {
        let st = app.state::<ImageQueueState>();
        let cfg = st.config.lock().map(|c| c.clone()).unwrap_or_default();
        let client = st.client_for(&cfg);
        (cfg, client)
    };
    // 任务快照（不存在则直接收尾）。
    let task = {
        let st = app.state::<ImageQueueState>();
        st.tasks.lock().ok().and_then(|t| t.get(&task_id).cloned())
    };
    let Some(task) = task else {
        finish_worker(&app, &task_id);
        return;
    };
    if matches!(client_res, Err(_)) {
        let msg = client_res.unwrap_err();
        eprintln!("[image-queue] client 快照失败（{}）：{}", mask_secret(&task_id), msg);
        fail_task(&app, &task_id, msg, false);
        finish_worker(&app, &task_id);
        return;
    }
    let client = client_res.unwrap();
    if cfg.api_key.trim().is_empty() {
        fail_task(&app, &task_id, "请先配置 API 密钥".to_string(), false);
        finish_worker(&app, &task_id);
        return;
    }

    match generate_one(&client, &cfg.api_base, &cfg.api_key, &task.prompt, &task.size, &task.ratio).await {
        Ok((url, ms)) => {
            let st = app.state::<ImageQueueState>();
            match download_and_persist(&app, &st, &client, &cfg, &task, &url, ms).await {
                Ok(path) => succeed_task(&app, &task_id, url, path, ms),
                Err(e) => {
                    // 下载错误：io:/disk: 前缀不可重试（直接失败）；传输中断可按剩余次数重排。
                    let retryable = !(e.starts_with("io:") || e.starts_with("disk:"));
                    if retryable && task.retry_count < MAX_RETRY {
                        requeue_task(&app, &task_id, &e);
                    } else {
                        fail_task(&app, &task_id, format!("下载/落盘失败：{}", e), false);
                    }
                }
            }
        }
        Err(IqError::Retryable(e)) if task.retry_count < MAX_RETRY => {
            tokio::time::sleep(backoff_for(task.retry_count)).await;
            requeue_task(&app, &task_id, &e);
        }
        Err(IqError::Cancelled) => {
            set_status_if_allowed(&app, &task_id, TaskStatus::Cancelled);
        }
        Err(e) => {
            fail_task(&app, &task_id, e.to_string(), false);
        }
    }
    finish_worker(&app, &task_id);
}

fn set_status_if_allowed(app: &AppHandle, task_id: &str, to: TaskStatus) -> Option<ImageTask> {
    let st = app.state::<ImageQueueState>();
    let mut tasks = st.tasks.lock().ok()?;
    let t = tasks.get_mut(task_id)?;
    if !can_transition(t.status, to) {
        return None;
    }
    t.status = to;
    let cloned = t.clone();
    drop(tasks);
    emit_task(app, &cloned);
    emit_stats(app, &st);
    Some(cloned)
}

fn succeed_task(app: &AppHandle, task_id: &str, url: String, path: String, ms: u128) {
    let st = app.state::<ImageQueueState>();
    let cloned = {
        let mut tasks = match st.tasks.lock() {
            Ok(t) => t,
            Err(_) => return,
        };
        let Some(t) = tasks.get_mut(task_id) else { return };
        t.status = TaskStatus::Succeeded;
        t.image_url = Some(url);
        t.file_path = Some(path);
        t.elapsed_ms = Some(ms);
        t.error = None;
        t.clone()
    };
    st.consec_fail.store(0, Ordering::SeqCst);
    emit_task(app, &cloned);
    emit_stats(app, &st);
}

fn fail_task(app: &AppHandle, task_id: &str, msg: String, _retryable: bool) {
    let st = app.state::<ImageQueueState>();
    let cloned = {
        let mut tasks = match st.tasks.lock() {
            Ok(t) => t,
            Err(_) => return,
        };
        let Some(t) = tasks.get_mut(task_id) else { return };
        // Running → Failed；Queued（下单前校验失败路径）也允许记失败。
        if t.status == TaskStatus::Running {
            t.status = TaskStatus::Failed;
        } else if t.status == TaskStatus::Queued {
            t.status = TaskStatus::Failed;
        } else {
            return;
        }
        t.error = Some(msg);
        t.clone()
    };
    let n = st.consec_fail.fetch_add(1, Ordering::SeqCst) + 1;
    emit_task(app, &cloned);
    emit_stats(app, &st);
    if n >= MAX_CONSEC_FAIL {
        halt_circuit(app, &format!("连续失败 {} 次，已自动停止", n));
    }
}

fn requeue_task(app: &AppHandle, task_id: &str, last_err: &str) {
    let st = app.state::<ImageQueueState>();
    let cloned = {
        let mut tasks = match st.tasks.lock() {
            Ok(t) => t,
            Err(_) => return,
        };
        let Some(t) = tasks.get_mut(task_id) else { return };
        if t.status != TaskStatus::Running {
            return;
        }
        t.retry_count = t.retry_count.saturating_add(1);
        t.status = TaskStatus::Queued;
        t.error = Some(format!("第 {} 次重试（上次：{}）", t.retry_count, last_err));
        t.clone()
    };
    emit_task(app, &cloned);
    emit_stats(app, &st);
}

fn finish_worker(app: &AppHandle, task_id: &str) {
    let st = app.state::<ImageQueueState>();
    if let Ok(mut h) = st.handles.lock() {
        h.remove(task_id);
    }
    st.running.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| v.checked_sub(1)).ok();
    emit_stats(app, &st);
}

/// 熔断：同 stop + `halted{reason:"circuit"}`。
fn halt_circuit(app: &AppHandle, message: &str) {
    let st = app.state::<ImageQueueState>();
    st.stop_flag.store(true, Ordering::SeqCst);
    st.generation.fetch_add(1, Ordering::SeqCst);
    st.scheduler_active.store(false, Ordering::SeqCst);
    if let Ok(mut h) = st.handles.lock() {
        for (_, handle) in h.drain() {
            handle.abort();
        }
    }
    // 在途 Running 保持 Running？不：abort 后 worker 收尾不执行，这里统一置 Cancelled（不计熔断）。
    mark_running_cancelled(app, &st);
    emit_halted(app, "circuit", message.to_string());
    emit_stats(app, &st);
}

fn mark_running_cancelled(app: &AppHandle, st: &ImageQueueState) {
    let changed: Vec<ImageTask> = {
        let mut tasks = match st.tasks.lock() {
            Ok(t) => t,
            Err(_) => return,
        };
        let mut out = Vec::new();
        for t in tasks.values_mut() {
            if t.status == TaskStatus::Running {
                t.status = TaskStatus::Cancelled;
                out.push(t.clone());
            }
        }
        out
    };
    st.running.store(0, Ordering::SeqCst);
    for t in &changed {
        emit_task(app, t);
    }
}

// ------------------------------------------------------------------
// 命令（11 个，`lib.rs` 注册；invoke 参数名以 Rust snake_case 的 camelCase 为准）
// ------------------------------------------------------------------

#[tauri::command]
pub fn iq_set_config(
    state: State<'_, ImageQueueState>,
    app: AppHandle,
    cfg: ImageQueueConfig,
) -> Result<SetConfigResult, String> {
    let mut next = cfg;
    // "__SET__" = 保持原 key / 原代理不变（前端占位回传）。
    {
        let cur = state.config.lock().map_err(|e| format!("配置锁失败：{}", e))?;
        if next.api_key == KEY_SET_PLACEHOLDER {
            next.api_key = cur.api_key.clone();
        }
        if next.proxy_url == KEY_SET_PLACEHOLDER {
            next.proxy_url = cur.proxy_url.clone();
        }
    }
    next.validate_and_normalize()?;
    // 代理构造失败直接 Err，不污染缓存。
    let fp = ClientFingerprint::of(&next);
    build_client(&fp)?;
    // 热更新信号量：在途不重建。
    let new_cap = next.concurrency_capped();
    {
        let mut sem_guard = state.semaphore.lock().map_err(|e| format!("信号量锁失败：{}", e))?;
        if state.running.load(Ordering::SeqCst) == 0 {
            *sem_guard = std::sync::Arc::new(tokio::sync::Semaphore::new(new_cap));
        } else {
            let total = sem_guard.available_permits() + state.running.load(Ordering::SeqCst);
            if new_cap > total {
                sem_guard.add_permits(new_cap - total);
            } else if new_cap < total {
                let diff = (total - new_cap) as u32;
                if let Ok(p) = sem_guard.try_acquire_many(diff) {
                    p.forget();
                }
                // 拿不到（permit 在途）则保持旧容量，等下次 set 收敛；注释记之。
            }
        }
    }
    // 持久化：非敏感必写；敏感按 remember_key 写/删。
    let data_dir = super::super::migration::data_dir_for(&app)?;
    save_config(&data_dir, &next)?;
    if next.remember_key {
        save_secrets(&data_dir, &next.api_key, &next.proxy_url)?;
    } else {
        delete_secrets(&data_dir);
    }
    let view = next.view();
    *state.config.lock().map_err(|e| format!("配置锁失败：{}", e))? = next;
    Ok(SetConfigResult { config: view })
}

#[tauri::command]
pub fn iq_get_config(state: State<'_, ImageQueueState>) -> Result<ImageQueueConfigView, String> {
    Ok(state.config.lock().map_err(|e| format!("配置锁失败：{}", e))?.view())
}

fn stage_of_test_error(msg: &str) -> &'static str {
    if msg.contains("data[0].url") {
        "parse"
    } else if msg.contains("密钥无效") || msg.contains("401") || msg.contains("API 密钥") {
        "auth"
    } else if msg.contains("400") {
        "api"
    } else {
        "connect"
    }
}

#[tauri::command]
pub async fn iq_test_connection(
    state: State<'_, ImageQueueState>,
    _app: AppHandle,
) -> Result<TestConnectionResult, String> {
    let cfg = state.config.lock().map_err(|e| format!("配置锁失败：{}", e))?.clone();
    if cfg.api_key.trim().is_empty() {
        return Ok(TestConnectionResult {
            ok: false,
            elapsed_ms: None,
            stage: Some("auth".to_string()),
            message: Some("请先填写 API 密钥".to_string()),
        });
    }
    let client = state.client_for(&cfg)?;
    // 固定探针（1K/1:1），只解析到 image_url 即成功，不下载图片。
    match generate_one(&client, &cfg.api_base, &cfg.api_key, PROBE_PROMPT, "1K", "1:1").await {
        Ok((_url, ms)) => Ok(TestConnectionResult {
            ok: true,
            elapsed_ms: Some(ms),
            stage: None,
            message: None,
        }),
        Err(IqError::Retryable(e)) => Ok(TestConnectionResult {
            ok: false,
            elapsed_ms: None,
            stage: Some("connect".to_string()),
            message: Some(e),
        }),
        Err(IqError::Cancelled) => Ok(TestConnectionResult {
            ok: false,
            elapsed_ms: None,
            stage: Some("api".to_string()),
            message: Some("请求被取消".to_string()),
        }),
        Err(IqError::Fatal(e)) => {
            let stage = stage_of_test_error(&e).to_string();
            Ok(TestConnectionResult { ok: false, elapsed_ms: None, stage: Some(stage), message: Some(e) })
        }
    }
}

#[tauri::command]
pub fn iq_enqueue(
    state: State<'_, ImageQueueState>,
    app: AppHandle,
    items: Vec<EnqueueItem>,
) -> Result<Vec<EnqueueResult>, String> {
    // 现有键集合（非 Cancelled 才参与去重；锁顺序 order → tasks）。
    let existing: std::collections::HashSet<String> = {
        let _order = state.order.lock().map_err(|e| format!("队列锁失败：{}", e))?;
        let tasks = state.tasks.lock().map_err(|e| format!("任务锁失败：{}", e))?;
        tasks.values().filter(|t| t.status != TaskStatus::Cancelled).map(|t| dedupe_key(t.ir_hash.as_deref(), &t.prompt)).collect()
    };
    let mut seen = existing;
    let (cfg_size, cfg_ratio) = {
        let cfg = state.config.lock().map_err(|e| format!("配置锁失败：{}", e))?;
        (cfg.size.clone(), cfg.ratio.clone())
    };
    let now = chrono::Utc::now().timestamp();
    let mut results = Vec::with_capacity(items.len());
    {
        let _order = state.order.lock().map_err(|e| format!("队列锁失败：{}", e))?;
        let mut tasks = state.tasks.lock().map_err(|e| format!("任务锁失败：{}", e))?;
        // 注：此处为实现简便在持锁期间做 Order 变更判断前先检查总量。
        for item in &items {
            let prompt_trimmed = item.prompt.trim();
            if prompt_trimmed.is_empty() {
                results.push(EnqueueResult { task_id: None, skipped: true });
                continue;
            }
            let key = dedupe_key(item.ir_hash.as_deref(), prompt_trimmed);
            if seen.contains(&key) {
                results.push(EnqueueResult { task_id: None, skipped: true });
                continue;
            }
            if tasks.len() >= MAX_TASKS {
                return Err(format!("队列已满（{} 条），请先清理已完成任务", MAX_TASKS));
            }
            // prompt 截断到 4000 字符（超限记 warning 前缀，不拒绝）。
            let (prompt, warn) = if prompt_trimmed.chars().count() > PROMPT_MAX_CHARS {
                (prompt_trimmed.chars().take(PROMPT_MAX_CHARS).collect::<String>(), true)
            } else {
                (prompt_trimmed.to_string(), false)
            };
            let id = uuid::Uuid::new_v4().to_string();
            // 单条 size/ratio（复用下单带参时采用，非法/缺省回落配置快照）。
            let (size, ratio) =
                resolve_item_size_ratio(item.size.as_deref(), item.ratio.as_deref(), &cfg_size, &cfg_ratio);
            let task = ImageTask {
                id: id.clone(),
                prompt,
                ir_hash: item.ir_hash.clone().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
                size,
                ratio,
                status: TaskStatus::Queued,
                image_url: None,
                file_path: None,
                elapsed_ms: None,
                error: if warn { Some("（warning：prompt 超 4000 字符已截断）".to_string()) } else { None },
                retry_count: 0,
                created_at: now,
            };
            seen.insert(key);
            // order 锁以 _order 持有；此处需可变——改持可写锁。见下：为简单起见此处 drop 读锁写法不可行，
            // 故本函数实际要求 order 可写：上文 _order 为读锁占位，真正 push 在文末统一处理。
            tasks.insert(id.clone(), task);
            results.push(EnqueueResult { task_id: Some(id), skipped: false });
        }
    }
    // 入队顺序追加（与 tasks 插入分两步，单线程命令内无交错；调度循环只读 Queued 状态）。
    {
        let mut order = state.order.lock().map_err(|e| format!("队列锁失败：{}", e))?;
        for r in &results {
            if let Some(id) = &r.task_id {
                if !order.contains(id) {
                    order.push_back(id.clone());
                }
            }
        }
    }
    // 事件：新任务 + stats。
    {
        let tasks = state.tasks.lock().map_err(|e| format!("任务锁失败：{}", e))?;
        for r in &results {
            if let Some(id) = &r.task_id {
                if let Some(t) = tasks.get(id) {
                    emit_task(&app, t);
                }
            }
        }
    }
    emit_stats(&app, &state);
    Ok(results)
}

#[tauri::command]
pub fn iq_start(state: State<'_, ImageQueueState>, app: AppHandle) -> Result<u64, String> {
    if state.scheduler_active.load(Ordering::SeqCst) {
        return Ok(state.generation.load(Ordering::SeqCst));
    }
    state.stop_flag.store(false, Ordering::SeqCst);
    let gen = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    state.scheduler_active.store(true, Ordering::SeqCst);
    tauri::async_runtime::spawn(scheduler_loop(app));
    Ok(gen)
}

#[tauri::command]
pub fn iq_stop(state: State<'_, ImageQueueState>, app: AppHandle) -> Result<(), String> {
    state.stop_flag.store(true, Ordering::SeqCst);
    state.generation.fetch_add(1, Ordering::SeqCst);
    state.scheduler_active.store(false, Ordering::SeqCst);
    if let Ok(mut h) = state.handles.lock() {
        for (_, handle) in h.drain() {
            handle.abort();
        }
    }
    // Running → Cancelled（不计入熔断），queued 保留可续跑。
    mark_running_cancelled(&app, &state);
    emit_halted(&app, "manual", "已手动停止".to_string());
    emit_stats(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn iq_retry(state: State<'_, ImageQueueState>, app: AppHandle, task_id: String) -> Result<(), String> {
    let mut tasks = state.tasks.lock().map_err(|e| format!("任务锁失败：{}", e))?;
    let t = tasks.get_mut(&task_id).ok_or_else(|| "任务不存在".to_string())?;
    if !matches!(t.status, TaskStatus::Failed | TaskStatus::Cancelled) {
        return Err("仅失败/已取消的任务可重试".to_string());
    }
    if !can_transition(t.status, TaskStatus::Queued) {
        return Err("状态变迁不允许".to_string());
    }
    // retry_count 不清零（沿用剩余次数）。
    t.status = TaskStatus::Queued;
    let cloned = t.clone();
    drop(tasks);
    emit_task(&app, &cloned);
    emit_stats(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn iq_remove(
    state: State<'_, ImageQueueState>,
    app: AppHandle,
    task_id: String,
    delete_file: Option<bool>,
) -> Result<(), String> {
    let task = {
        let tasks = state.tasks.lock().map_err(|e| format!("任务锁失败：{}", e))?;
        tasks.get(&task_id).cloned().ok_or_else(|| "任务不存在".to_string())?
    };
    if task.status == TaskStatus::Running {
        return Err("生成中的任务不可删（先停止或等完成）".to_string());
    }
    if delete_file.unwrap_or(false) {
        if let Some(p) = &task.file_path {
            let _ = std::fs::remove_file(p);
            let json_sidecar = PathBuf::from(p).with_extension("json");
            let _ = std::fs::remove_file(json_sidecar);
        }
    }
    {
        // 锁顺序 order → tasks。
        let mut order = state.order.lock().map_err(|e| format!("队列锁失败：{}", e))?;
        let mut tasks = state.tasks.lock().map_err(|e| format!("任务锁失败：{}", e))?;
        tasks.remove(&task_id);
        order.retain(|id| id != &task_id);
    }
    emit_stats(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn iq_clear_finished(
    state: State<'_, ImageQueueState>,
    app: AppHandle,
    only_succeeded: Option<bool>,
) -> Result<u64, String> {
    let only_ok = only_succeeded.unwrap_or(false);
    let removed: Vec<String> = {
        // 锁顺序 order → tasks。
        let mut order = state.order.lock().map_err(|e| format!("队列锁失败：{}", e))?;
        let mut tasks = state.tasks.lock().map_err(|e| format!("任务锁失败：{}", e))?;
        let ids: Vec<String> = tasks
            .values()
            .filter(|t| {
                if only_ok {
                    t.status == TaskStatus::Succeeded
                } else {
                    matches!(t.status, TaskStatus::Succeeded | TaskStatus::Failed | TaskStatus::Cancelled)
                }
            })
            .map(|t| t.id.clone())
            .collect();
        for id in &ids {
            tasks.remove(id);
        }
        order.retain(|id| !ids.contains(id));
        ids
    };
    let n = removed.len() as u64;
    emit_stats(&app, &state);
    Ok(n)
}

#[tauri::command]
pub fn iq_list(
    state: State<'_, ImageQueueState>,
    offset: usize,
    limit: usize,
    status: Option<String>,
) -> Result<ListResult, String> {
    let filter = status.as_deref().and_then(TaskStatus::from_str);
    // 锁顺序 order → tasks。
    let order = state.order.lock().map_err(|e| format!("队列锁失败：{}", e))?;
    let tasks = state.tasks.lock().map_err(|e| format!("任务锁失败：{}", e))?;
    let mut filtered: Vec<&ImageTask> = order
        .iter()
        .filter_map(|id| tasks.get(id))
        .filter(|t| filter.map(|f| t.status == f).unwrap_or(true))
        .collect();
    // order 本身即入队顺序；新任务在尾。F2 队列视图按入队顺序展示。
    let total = filtered.len();
    let _ = &mut filtered;
    let items: Vec<ImageTask> = filtered.into_iter().skip(offset).take(limit.max(1).min(500)).cloned().collect();
    Ok(ListResult { total, items })
}

/// 解析图片内嵌生图参数（need06）：传入图片路径即可读回 `prompt/size/ratio/...`。
/// 无内嵌数据 → `Ok(None)`；格式损坏/超限 → `Err`。
#[tauri::command]
pub fn iq_read_image_meta(file_path: String) -> Result<Option<serde_json::Value>, String> {
    let path = PathBuf::from(&file_path);
    let meta = std::fs::metadata(&path).map_err(|e| format!("读取文件失败：{}", e))?;
    if meta.len() > MAX_IMAGE_BYTES {
        return Err("文件超过 100MB 上限".to_string());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("读取文件失败：{}", e))?;
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let ext = if ext == "jpeg" { "jpg".to_string() } else { ext };
    if ext.is_empty() {
        return Ok(None);
    }
    extract_embedded_meta(&bytes, &ext)
}

// 提供 Agnes provider 复用（test_connection 的解析经 generate_one 内部完成）。
#[allow(dead_code)]
fn _provider() -> AgnesProvider {
    AgnesProvider
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transition_table() {
        use TaskStatus::*;
        assert!(can_transition(Queued, Running));
        assert!(can_transition(Running, Succeeded));
        assert!(can_transition(Running, Failed));
        assert!(can_transition(Running, Cancelled));
        assert!(can_transition(Failed, Queued));
        assert!(can_transition(Cancelled, Queued));
        // 非法变迁拒绝
        assert!(!can_transition(Queued, Succeeded));
        assert!(!can_transition(Succeeded, Queued));
        assert!(!can_transition(Failed, Running));
        assert!(!can_transition(Succeeded, Failed));
        assert!(!can_transition(Running, Queued));
        assert!(!can_transition(Cancelled, Running));
    }

    #[test]
    fn dedupe_key_prefers_hash_and_normalizes_prompt() {
        assert_eq!(dedupe_key(Some("abc"), "  x  "), "hash:abc");
        assert_eq!(dedupe_key(None, "a   cat\t picture"), "prompt:a cat picture");
        assert_eq!(dedupe_key(Some("  "), " a  b "), "prompt:a b");
        assert_eq!(normalize_prompt_key("  hello   world \n"), "hello world");
    }

    #[test]
    fn filename_template_stable() {
        let a = build_image_filename("20260922_120000", 3, "1K", "1:1", "a cat", "png");
        assert_eq!(a, format!("20260922_120000_003_1K_1-1_{}.png", prompt_hash8("a cat")));
        // ratio 冒号转义，prompt 相同则 hash 相同
        assert!(a.contains("1-1"));
        assert_eq!(prompt_hash8("a cat"), prompt_hash8("a cat"));
        assert_ne!(prompt_hash8("a cat"), prompt_hash8("a dog"));
    }

    #[test]
    fn normalize_image_dir_three_states() {
        let data = Path::new("/tmp/pmftest/data");
        assert_eq!(normalize_image_dir_for(data, "").unwrap(), data.join("output").join("images"));
        assert_eq!(normalize_image_dir_for(data, "  ").unwrap(), data.join("output").join("images"));
        assert_eq!(
            normalize_image_dir_for(data, "custom/imgs").unwrap(),
            data.join("custom/imgs")
        );
        // 历史 data/ 前缀 strip
        assert_eq!(
            normalize_image_dir_for(data, "data/output/images").unwrap(),
            data.join("output/images")
        );
        // 绝对路径直用
        #[cfg(target_os = "windows")]
        let abs = "C:/pics";
        #[cfg(not(target_os = "windows"))]
        let abs = "/var/pics";
        assert_eq!(normalize_image_dir_for(data, abs).unwrap(), PathBuf::from(abs));
    }

    #[test]
    fn unique_filename_collision_increments() {
        let dir = std::env::temp_dir().join(format!("pmf_iq_fn_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let stem = "20260922_120000_001_1K_1-1_ab12cd34.png";
        assert_eq!(unique_filename_in(&dir, stem), PathBuf::from(stem));
        std::fs::write(dir.join(stem), b"x").unwrap();
        assert_eq!(
            unique_filename_in(&dir, stem),
            PathBuf::from("20260922_120000_001_1K_1-1_ab12cd34-1.png")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ext_and_magic() {
        assert_eq!(ext_for_content_type("image/png"), Some("png"));
        assert_eq!(ext_for_content_type("image/jpeg; charset=utf-8"), Some("jpg"));
        assert_eq!(ext_for_content_type("application/json"), None);
        assert!(has_image_magic(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
        assert!(has_image_magic(&[0xFF, 0xD8, 0xFF, 0x00]));
        assert!(!has_image_magic(b"{not an image}..."));
    }

    #[test]
    fn resolve_item_size_ratio_prefers_valid_item() {
        // 合法 item 值采用
        assert_eq!(
            resolve_item_size_ratio(Some("2K"), Some("16:9"), "1K", "1:1"),
            ("2K".to_string(), "16:9".to_string())
        );
        // 缺省回落配置
        assert_eq!(
            resolve_item_size_ratio(None, None, "1K", "1:1"),
            ("1K".to_string(), "1:1".to_string())
        );
        // 非法回落配置（旧前端不送字段 / 复用脏数据时行为与 need05 一致）
        assert_eq!(
            resolve_item_size_ratio(Some("8K"), Some("4:5"), "1K", "1:1"),
            ("1K".to_string(), "1:1".to_string())
        );
        // trim 后命中白名单
        assert_eq!(
            resolve_item_size_ratio(Some(" 2K "), Some(" 1:1 "), "1K", "16:9"),
            ("2K".to_string(), "1:1".to_string())
        );
    }

    #[test]
    fn legacy_enqueue_item_without_size_ratio_deserializes() {
        // 回归：need05 旧 payload 无 size/ratio 字段，反序列化应为 None（回落配置快照）。
        let raw = serde_json::json!({ "prompt": "a cat", "irHash": null });
        let item: EnqueueItem = serde_json::from_value(raw).expect("旧入队 payload 应兼容");
        assert!(item.size.is_none() && item.ratio.is_none());
    }

    #[test]
    fn status_roundtrip() {
        assert_eq!(TaskStatus::from_str("queued"), Some(TaskStatus::Queued));
        assert_eq!(TaskStatus::Queued.as_str(), "queued");
        assert_eq!(TaskStatus::from_str("bogus"), None);
        // serde 小写
        let s = serde_json::to_string(&TaskStatus::Succeeded).unwrap();
        assert_eq!(s, "\"succeeded\"");
    }

    #[test]
    fn backoff_steps() {
        assert_eq!(backoff_for(0), std::time::Duration::from_secs(1));
        assert_eq!(backoff_for(1), std::time::Duration::from_secs(3));
    }
}
