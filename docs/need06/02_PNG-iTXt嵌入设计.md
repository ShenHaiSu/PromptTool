# 02 PNG 嵌入设计：`iTXt` chunk

## 1. 选型

- 用 `iTXt`（UTF-8 文本块），不用 `tEXt`（latin1，放不下中文 prompt）；
- 不压缩（`compression_flag = 0`）：JSON 通常几 KB（prompt 上限 4000 字符 + 7 个短字段），压缩收益小且增加实现面；
- 单 chunk 即可：`iTXt.data` 长度字段为 `u32`，上限 4GB，不存在 JPG 那样的 64KB 分段问题。

## 2. 数据布局

- keyword：`PromptTool:Meta`（用户已确认；latin1、< 79 字符，符合规范）；
- 插入位置：`签名(8B) + IHDR chunk` **之后**、`IDAT` 之前（规范只要求 `IHDR` 第一，`iTXt` 放第二完全合法；“头部”语义 + 严格解析器兼容）；
- `data = keyword + 0x00 + 0x00(不压缩) + 0x00(压缩方法) + 0x00(language="") + 0x00(translated="") + JSON(UTF-8紧凑串)`；
- chunk 编码：`len(u32 BE, = data.len()) + "iTXt" + data + crc(u32 BE, 对 type+data 的 IEEE CRC32)`。

## 3. 函数签名（纯函数，无 IO，`queue.rs` 内 `mod embed` 或新建 `embed.rs`）

```rust
pub fn embed_png(raw: &[u8], meta_json: &[u8]) -> Result<Vec<u8>, String>;
```

流程：

1. 校验 `raw.len() >= 33` 且前 8 字节为 PNG 签名，否则 `Err("非 PNG")`；
2. 读 `u32 BE(raw[8..12])` 为 `ihdr_len`，校验 `raw[12..16] == b"IHDR"`，否则 `Err("首块非 IHDR")`（回退路径见 §4）；
3. `ihdr_end = 16 + ihdr_len + 4`，越界则 `Err("IHDR 截断")`；
4. 组装 `data`（§2），`out = raw[..ihdr_end] + len + "iTXt" + data + crc + raw[ihdr_end..]`；
5. 返回 `out`。

## 4. 回退条件（任一命中 → 调用方用原图落盘 + `eprintln!`，任务仍成功）

- 前 8 字节非 PNG 签名；
- 首块非 `IHDR`；
- `ihdr_len` 导致 `ihdr_end` 越界。

## 5. CRC32（零依赖，手写表驱动，约 30 行）

```rust
fn crc32_ieee(data: &[u8]) -> u32 {
    let mut table = [0u32; 256];
    for i in 0..256 {
        let mut c = i as u32;
        for _ in 0..8 { c = if c & 1 == 1 { 0xEDB88320 ^ (c >> 1) } else { c >> 1 }; }
        table[i] = c;
    }
    let mut crc = 0xFFFFFFFFu32;
    for b in data { crc = table[((crc ^ (*b as u32)) & 0xFF) as usize] ^ (crc >> 8); }
    crc ^ 0xFFFFFFFF
}
```

`table` 可在首次调用时 `OnceLock` 缓存；单张图只算一次（几 KB），直接现算亦可。

## 6. 单测要求（见 `06`）

- 嵌入后前 8 字节仍为签名，第二块为 `iTXt` 且 keyword 匹配；
- `crc` 自校验通过；
- 用最小 PNG fixture（手写字节或 `include_bytes!`）跑 `embed → extract` roundtrip。
