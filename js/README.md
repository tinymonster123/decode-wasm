# decode-wasm demo（js/）

浏览器端 demo + Node 端 smoke/bench test，驱动 `decode-core`（Rust → WASM）。核心只吐
`Box<[Change]>`（JSON 序列化给 JS），渲染是 JS 侧的事——这一层是 SPEC §10/§11 锁定的
「端口 + adapter 层」。

## 分层

```
feed(bytes) → Core(wasm) → change 流(JSON) → apply.js(权威 grid) → session.js(编排)
                                                                    ├─ canvas-renderer.js（像素）
                                                                    ├─ dom-renderer.js（元素）
                                                                    ├─ text-renderer.js（ANSI 字符串）
                                                                    └─ webgl/webgpu-renderer.js（v2 桩）
```

## 文件

- `apply.js` — 纯网格模型：把 change 流应用到 JS 网格（无 DOM，浏览器/Node 共用）。**唯一权威 grid 状态。**
- `palette.js` — 颜色编码（256 调色板 / 默认 / truecolor）→ CSS 颜色。
- `renderer.js` — **端口**：`Renderer` 接口契约 + `createRenderer(backend, opts)` 显式 factory（未知 backend 直接 throw，不做隐式 fallback）。
- `session.js` — 端口消费者侧驱动：feed → apply → 判定（blit vs 全量）→ 调 adapter。三 sink 共用。
- `canvas-renderer.js` — CanvasRenderer（全量重绘 + 滚动 blit）。
- `dom-renderer.js` — DOMRenderer（一行一个 `<div>`，retained + 增量 diff）。
- `text-renderer.js` — TextRenderer（渲成 ANSI 字符串，纯文本用于断言/导出）。
- `webgl-renderer.js` / `webgpu-renderer.js` — v2 接口桩（构造即 throw）。
- `perf.js` — 环形缓冲 + 分位数 + 采样器（`performance.now()`，不引依赖）。
- `bench-common.js` — 三轴 bench 负载 + runner（浏览器/Node 共用）。
- `panel.js` — float perf HUD（右上角浮动面板，FPS/帧时间、feed 延迟 p50/p95/p99、change/s、吞吐 MB/s，可导出 JSON/CSV）。
- `main.js` + `index.html` — 浏览器 demo 入口（按 query 切后端/负载）。
- `vim-sequence.js` — 真实 vim 启动字节流（demo / smoke / bench 共用）。
- `smoke.mjs` — Node 端到端 smoke test（canvas 不回归）。
- `adapters.test.mjs` — adapter 层验收（factory 不 fallback + text 与 grid 一致）。
- `bench.mjs` — Node 侧 bench CLI。
- `pkg/` — `wasm-bindgen --target web` 生成的 glue（浏览器）。
- `pkg-node/` — `wasm-bindgen --target nodejs` 生成的 glue（Node）。

## 跑

浏览器 demo（web glue 用 `fetch` 加载 .wasm，不能 `file://` 直开）：

```sh
cd decode_wasm && python3 -m http.server
# 浏览器打开 http://localhost:8000/js/
```

URL query 切后端与负载（同一份代码只换后端）：

```sh
# 默认：canvas + vim demo
http://localhost:8000/js/
# 换后端：dom / text（canvas/webgl/webgpu 同理，webgl/webgpu 是 v2 桩会抛错）
http://localhost:8000/js/?renderer=dom
# 三轴 bench + float panel + 网格尺寸
http://localhost:8000/js/?renderer=canvas&bench=throughput&perf=1&cols=80&rows=200
http://localhost:8000/js/?renderer=text&bench=latency&perf=1
http://localhost:8000/js/?renderer=canvas&bench=scroll&perf=1
```

Node smoke / 验收 / bench（双端同款参数）：

```sh
cd decode_wasm
node js/smoke.mjs            # 端到端 smoke（canvas 路径回归）
node js/adapters.test.mjs    # adapter 层验收
node js/bench.mjs --renderer=text --bench=throughput --cols=80 --rows=24
node js/bench.mjs --renderer=canvas --bench=latency   # Node 无 DOM，只测 core parse
node js/bench.mjs --renderer=text --bench=scroll --json
```

## 重新生成 glue

改 `crates/decode-wasm` 后：

```sh
cargo build --release --target wasm32-unknown-unknown -p decode-wasm
wasm-bindgen target/wasm32-unknown-unknown/release/decode_wasm.wasm --out-dir js/pkg --target web
wasm-bindgen target/wasm32-unknown-unknown/release/decode_wasm.wasm --out-dir js/pkg-node --target nodejs
```
