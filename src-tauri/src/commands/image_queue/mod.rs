//! 生图队列模块根（need05 B1/B2）：Agnes 协议接入 + 配置/密钥 + 队列调度与落盘。
//!
//! 对外 re-export：`ImageQueueState`（`lib.rs` 做 `app.manage`）、10 个 `iq_*` 命令。

pub mod agnes;
pub mod config;
pub mod queue;

pub use queue::ImageQueueState;
