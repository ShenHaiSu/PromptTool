# scripts 说明

- `probe_agnes.py`：Agnes Image 2.5 Flash 最小文生图探测。
  Key 固定从 `../apikey.txt` 读取，控制台只打印掩码。
  `--no-generate` 仅打印 payload 不发请求；默认发 1K/1:1/URL 单次探测。
  已验证结论沉淀在 `../01_协议调研结论.md`，后续实现回归时可重跑：

```powershell
python docs/need05/scripts/probe_agnes.py --no-generate
python docs/need05/scripts/probe_agnes.py
```
