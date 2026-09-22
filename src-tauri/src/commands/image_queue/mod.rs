//! 生图队列模块根（need05 B1/B2）：Agnes 协议接入 + 配置/密钥 + 队列调度与落盘。
//!
//! 对外 re-export：`ImageQueueState`（`lib.rs` 做 `app.manage`）、11 个 `iq_*` 命令（need05 10 个 + need06 `iq_read_image_meta`）。

pub mod agnes;
pub mod config;
pub mod embed;
pub mod queue;

pub use queue::ImageQueueState;
