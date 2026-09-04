# decode-wasm demo（js/）

浏览器端最小 canvas 渲染器 + Node 端到端 smoke test，驱动 `decode-core`（Rust → WASM）。

## 文件

- `apply.js` — 纯网格模型：把 `Core.feed()` 的 change 流应用到 JS 网格（无 DOM，浏览器/Node 共用）。
- `palette.js` — 颜色编码（256 调色板 / 默认 / truecolor）→ CSS 颜色。
- `renderer.js` — canvas 渲染：全量重绘 + 滚动 blit。
- `main.js` + `index.html` — 浏览器 demo 入口。
- `vim-sequence.js` — 一段真实 vim 启动字节流（pty 抓取），demo 和 smoke 共用。
- `smoke.mjs` — Node 端到端 smoke test。
- `pkg/` — `wasm-bindgen --target web` 生成的 glue（浏览器）。
- `pkg-node/` — `wasm-bindgen --target nodejs` 生成的 glue（Node smoke test）。

## 跑

浏览器 demo（web glue 用 `fetch` 加载 .wasm，不能 `file://` 直开）：

```sh
cd decode_wasm && python3 -m http.server
# 浏览器打开 http://localhost:8000/js/
```

Node smoke test：

```sh
cd decode_wasm && node js/smoke.mjs
```

## 重新生成 glue

改 `crates/decode-wasm` 后：

```sh
cargo build --release --target wasm32-unknown-unknown -p decode-wasm
wasm-bindgen target/wasm32-unknown-unknown/release/decode_wasm.wasm --out-dir js/pkg --target web
wasm-bindgen target/wasm32-unknown-unknown/release/decode_wasm.wasm --out-dir js/pkg-node --target nodejs
```
