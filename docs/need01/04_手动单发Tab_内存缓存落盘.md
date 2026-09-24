# 04 · 手动单发 Tab（内存预览 + 点存落盘）

> 需求4｜改动域：`App.vue` Tabs + 新 `SingleShotPanel` + 后端 `iq_generate_one_preview / iq_save_preview` + ledger 落账

## 1. 位置与形态（定案）

- `App.vue:243-267` 中间栏 Tabs 扩展：`centerTab: 'prompt'|'image'|'single'`，第三个按钮 `data-testid=center-tab-single` 文案“手动单发”，顺序固定在生图队列之后（需求原话）。
- 面板 `v-if="centerTab==='single'"` 按需挂载（同生图面板策略，首屏不预 mount）。
- 新文件 `src/components/SingleShotPanel.vue`（表单+预览区两栏；样式沿用 `BatchFactory` 的卡片+小字号风格，不引入新 UI 库）。

## 2. 表单与链路

表单字段（默认值复用队列配置快照）：`prompt(textarea, 必填≤4000字)` + `size(1K/2K/3K/4K)` + `ratio(8种)` + `保存路径(默认=队列 outputDir 解析值，可改)` + `生成/保存/重来` 三按钮。

```
生成 → invoke iq_generate_one_preview{prompt,size,ratio}
     → 后端 Agnes 直调（复用 AgnesProvider::build_text_to_image + generate_one，不进队列/信号量/熔断）
     → 返回 {imageBase64, mime, elapsedMs, width?, height?} 前端 <img src=data:…> 内存展示（不落盘）
保存 → invoke iq_save_preview{imageBase64, prompt,size,ratio, outputDir?}
     → 后端魔数校验→ build_image_filename(同队列公式)+unique_filename_in 防重名 → embed meta → 原子落盘
     → 返回 {filename, filePath} + 主库 ledger 记一条 source='single'（算一次成功，需求原话）
```

- 未保存切 Tab/关闭：内存丢弃属预期，`prompt` 草稿留 `localStorage(singleShotDraft)`，图片 base64 不持久化。
- 密钥/代理复用队列 `ImageQueueConfig`（无独立密钥配置）；密钥未设则与队列同 toast 拦截。

## 3. 文件名与保存路径

- 文件名同队列公式（`build_image_filename` 共用）+ `unique_filename_in` 防重名（需求“自动防重名随机后缀”即现有 `-1..-99` 后缀；若全撞则毫秒后缀兜底，已有逻辑）。
- 保存路径：默认取 `resolve_image_dir(app, config.output_dir)` 解析结果回显；用户可粘贴绝对/相对路径，后端同 `ensure_image_dir` 校验 + 水位检查；非法路径 toast 不落盘。
- 落盘后提供“定位文件”（`dbRevealInExplorer`）与“复制文件名”。

## 4. 并发/熔断隔离

- 单发**不占用队列信号量**、不计 `running`、不触发 hungry/熔断；队列运行时可并行单发（Agnes 侧限流由后端 reqwest 超时+错误分类承担，失败文案与队列一致 `Fatal/Retryable`）。
- 连续单发：上一次未返回时“生成”按钮 disabled，避免 base64 内存堆积。

## 5. 自测要点

- 生成→预览不落盘（输出目录 mtime/文件数不变）；保存→文件出现且命名合式且 ledger+1；同名连点保存出现 `-1` 后缀。
- 队列运行中做单发互不干扰；4000+ 字 prompt 截断提示与队列一致。
