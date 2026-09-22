# 03 JPG 嵌入设计：`COM` 段 + 分段协议

## 1. 选型

- 用 `COM(FF FE)` 段，不用 `APPn`：`COM` 是基线 JPEG 必识段，无应用 اختصاص 冲突；`APP13/APP1` 多被 Photoshop/EXIF 占用，易被第三方工具改写或剥离；
- `COM` 段内数据按长度跳过，不做熵编码转义，JSON 原字节直接放即可。

## 2. 插入点扫描算法

目标：`SOI` 之后，**跳过全部 `APPn(FF E0–EF)`**（保留 `APP0/JFIF` 首位兼容性），在第一个非 `APPn` 段（通常 `DQT/SOF`）之前插入；绝不在 `SOS(FF DA)` 之后插入。

```rust
pos = 2; // 跳过 SOI
loop {
    require raw[pos] == 0xFF, 否则 Err("marker 错位");
    m = raw[pos + 1];
    if m == 0xDA { break; }                        // SOS：插入点即此处
    if (0xE0..=0xEF).contains(m) {                 // APPn：按长度跳过
        len = u16 BE(raw[pos+2..pos+4]) as usize;  // 含自身 2 字节
        if len < 2 || pos + 2 + len > raw.len() { return Err("段长度越界"); }
        pos += 2 + len; continue;
    }
    if m == 0xD8 || (0xD0..=0xD7).contains(m) || m == 0x01 {
        pos += 2; continue;                        // SOI/RSTn/TEM：无长度
    }
    break;                                         // DQT/DHT/SOF/SOS 等：插入点
}
out = raw[..pos] + COM段… + raw[pos..];
```

注意：`0xFF` 填充字节（`FF FF …`）在 SOS 之前理论上只出现在 marker 头；若 `raw[pos] != 0xFF` 即判错位回退，不硬容错。

## 3. 分段协议（用户已确认“分段接受”）

- 单 `COM` 段 `len` 为 `u16`（含自身 2 字节）→ payload 上限 `65533`；取切片 `60000` 留余量；
- `payload = MAGIC(5B) + index(u8) + total(u8) + json_slice`，其中 `MAGIC = b"PMF1\x00"`（用户已确认前缀语义，名字沿用 `PromptTool:Meta` 体系）；
- `chunks = meta_json.chunks(60000)`，`total = chunks.len()`；`total == 1` 为常态（prompt 上限 4000 字符时 JSON 约 5–8KB）；
- `total > 255` 理论上不可能（需 15MB JSON，远超 `MAX_IMAGE_BYTES` 场景），实现中 `> 255` 则 `Err` 回退原图；
- 每段编码：`FF FE + (payload.len()+2) u16 BE + payload`。

## 4. 函数签名（纯函数，无 IO）

```rust
pub fn embed_jpg(raw: &[u8], meta_json: &[u8]) -> Result<Vec<u8>, String>;
```

## 5. 回退条件（任一命中 → 原图落盘 + `eprintln!`，任务仍成功）

- 前 2 字节非 `FF D8`；
- marker 错位（`raw[pos] != 0xFF`）；
- 段长度 `< 2` 或越界；
- `total > 255`。

## 6. 单测要求（见 `06`）

- 嵌入后前 2 字节仍为 `FF D8`，`APP0`(如有) 仍在 `COM` 之前；
- `embed → extract` roundtrip（含构造 `> 60000` 字节 JSON 的多段拼回）；
- 畸形 JPEG（无 SOI / 段长度越界）返回 `Err`。
