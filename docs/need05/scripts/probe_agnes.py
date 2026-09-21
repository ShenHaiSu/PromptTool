"""Agnes Image 2.5 Flash 协议探测脚本.
只做最小文生图验证: POST /v1/images/generations, 不落盘大图, 只打印结构与耗时.
API Key 从 ../apikey.txt 读取, 绝不打印完整 key.
用法: python probe_agnes.py [--api-base URL] [--proxy URL] [--no-generate]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error


DEFAULT_BASE = "https://apihub.agnes-ai.com"


def load_key() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    p = os.path.join(here, "..", "apikey.txt")
    with open(p, "r", encoding="utf-8") as f:
        return f.read().strip()


def mask(k: str) -> str:
    if len(k) <= 10:
        return "***"
    return k[:5] + "***" + k[-4:]


def post_json(url: str, payload: dict, key: str, proxy: str | None, timeout: int) -> tuple[int, dict | str]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    if proxy:
        req.set_proxy(proxy, "https")
        req.set_proxy(proxy, "http")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
            try:
                return resp.status, json.loads(body)
            except json.JSONDecodeError:
                return resp.status, body[:2000]
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")[:3000]
        return e.code, {"http_error": e.code, "body": raw}
    except Exception as e:
        return -1, {"transport_error": f"{type(e).__name__}: {e}"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", default=os.environ.get("AGNES_API_BASE", DEFAULT_BASE))
    ap.add_argument("--proxy", default=os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY") or None)
    ap.add_argument("--timeout", type=int, default=180)
    ap.add_argument("--no-generate", action="store_true", help="只打印将要发送的 payload, 不发请求")
    args = ap.parse_args()

    key = load_key()
    print(f"[probe] base={args.api_base} key={mask(key)} proxy={args.proxy or '(none)'} timeout={args.timeout}s")

    payload = {
        "model": "agnes-image-2.5-flash",
        "prompt": "a small glass cube on a white studio background, soft shadows, high detail",
        "size": "1K",
        "ratio": "1:1",
        "extra_body": {"response_format": "url"},
    }
    print("[probe] payload=" + json.dumps(payload, ensure_ascii=False))
    if args.no_generate:
        return 0

    url = args.api_base.rstrip("/") + "/v1/images/generations"
    t0 = time.time()
    status, resp = post_json(url, payload, key, args.proxy, args.timeout)
    dt = time.time() - t0
    print(f"[probe] status={status} elapsed={dt:.1f}s")

    if isinstance(resp, dict) and "data" in resp:
        items = resp.get("data") or []
        print(f"[probe] data_len={len(items)} created={resp.get('created')}")
        if items:
            first = items[0]
            keys = list(first.keys()) if isinstance(first, dict) else type(first).__name__
            print(f"[probe] data[0].keys={keys}")
            if isinstance(first, dict):
                u = first.get("url")
                b = first.get("b64_json")
                print(f"[probe] url_len={len(u) if u else 0} b64_len={len(b) if b else 0}")
                if u:
                    print(f"[probe] url_prefix={str(u)[:80]}")
    else:
        print("[probe] resp=" + json.dumps(resp, ensure_ascii=False)[:3000])
    return 0 if status == 200 else 2


if __name__ == "__main__":
    raise SystemExit(main())
