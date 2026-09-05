# decode-wasm demo（js/）

浏览器端 demo + Node 端 smoke/bench test，驱动 `decode-core`（Rust → WASM）。核心只吐
`Box<[Change]>`（编码成紧凑二进制 `Uint8Array` 给 JS，见 #7 去 JSON 化），渲染是 JS 侧的
事——这一层是 SPEC §10/§11 锁定的「端口 + adapter 层」。

## 分层

```
feed(bytes) → Core(wasm) → change 流(二进制) → src/decode.js(解码) → src/grid.js(权威 grid) → src/session.js(编排)
                                                                       ├─ src/renderers/canvas.js（像素）
                                                                       ├─ src/renderers/dom.js（元素）
                                                                       ├─ src/renderers/text.js（ANSI 字符串）
                                                                       └─ src/renderers/webgl.js / webgpu.js（v2 桩）
```

## 目录（按角色分目录，目录自解释）

```
js/
├── index.html                      # 浏览器 demo 页（URL 保持 /js/）
├── main.js                         # 浏览器唯一入口；唯一 import ./pkg 的源文件
├── src/                            # 双端共用产品代码；禁止 import pkg / pkg-node
│   ├── decode.js                   # FFI 二进制解码：Core.feed() 的 Uint8Array → change 对象数组（与 lib.rs encode_changes 对齐）
│   ├── session.js                  # 编排：feed → apply → 判定（blit vs 全量）→ 调 adapter
│   ├── grid.js                     # 共享表示：newGrid / applyChanges / gridText。**唯一权威 grid 状态。**
│   ├── palette.js                  # 颜色编码（256 调色板 / 默认 / truecolor）→ CSS 颜色
│   ├── perf.js                     # 环形缓冲 + 分位数 + 采样器（`performance.now()`，不引依赖）
│   ├── bench-common.js             # 三轴 bench 负载 + runner（浏览器/Node 共用）
│   ├── panel.js                    # float perf HUD（FPS/帧时间、feed 延迟 p50/p95/p99、change/s、吞吐 MB/s）
│   └── renderers/                  # 端口 + adapter 层（SPEC §10 的 seam）
│       ├── index.js                # **端口**：`Renderer` 契约 + `createRenderer(backend, opts)` 显式 factory（未知 backend 直接 throw，不做隐式 fallback）
│       ├── canvas.js               # CanvasRenderer（全量重绘 + 滚动 blit）
│       ├── dom.js                  # DOMRenderer（一行一个 `<div>`，retained + 增量 diff）
│       ├── text.js                 # TextRenderer（渲成 ANSI 字符串，纯文本用于断言/导出）
│       └── webgl.js / webgpu.js    # v2 接口桩（构造即 throw）
├── fixtures/
│   └── vim-start.js                # 真实 vim 启动字节流（demo / smoke / bench 共用）
├── test/                           # Node 验收入口（允许 import ./pkg-node）
│   ├── decode.test.mjs             # FFI 二进制解码器单元测试（锁格式 + Core.feed 往返）
│   ├── adapters.test.mjs           # adapter 层验收（factory 不 fallback + text 与 grid 一致）
│   ├── smoke.mjs                   # Node 端到端 smoke test（canvas 不回归）
│   └── strip-ansi.js               # 测试工具：剥 SGR 序列（从 text renderer 迁出，不属端口）
├── cli/                            # Node 工具入口（允许 import ./pkg-node）
│   └── bench.mjs                   # Node 侧 bench CLI
├── pkg/                            # 生成物（wasm-bindgen --target web，浏览器）
└── pkg-node/                       # 生成物（wasm-bindgen --target nodejs，Node）
```

## 跑

浏览器 demo（web glue 用 `fetch` 加载 .wasm，不能 `file://` 直开）：

```sh
cd decode_wasm && python3 -m http.server
# 浏览器打开 http://localhost:8000/js/
```

URL query 切后端与负载（同一份代码只换后端；键面 renderer / bench / perf / size）：

```sh
# 默认：canvas + vim demo
http://localhost:8000/js/
# 换后端：dom / text（canvas/webgl/webgpu 同理，webgl/webgpu 是 v2 桩会抛错）
http://localhost:8000/js/?renderer=dom
# 三轴 bench + float panel + 网格尺寸（size=COLSxROWS）
http://localhost:8000/js/?renderer=canvas&bench=throughput&perf=1&size=80x200
http://localhost:8000/js/?renderer=text&bench=latency&perf=1
http://localhost:8000/js/?renderer=canvas&bench=scroll&perf=1
```

Node smoke / 验收 / bench（双端同款参数；`npm test` / `npm run bench` 为标准入口）：

```sh
cd decode_wasm
npm test                          # config + adapters.test + smoke（等价于下面几条 node 命令）
node js/test/config.test.mjs      # 启动配置解析/校验
node js/test/smoke.mjs            # 端到端 smoke（canvas 路径回归）
node js/test/adapters.test.mjs    # adapter 层验收
node js/cli/bench.mjs --renderer=text --bench=throughput --size=80x24
node js/cli/bench.mjs --renderer=canvas --bench=latency   # Node 无 DOM，只测 core parse
node js/cli/bench.mjs --renderer=text --bench=scroll --json
```

Node 无面板：浏览器 `perf=1` 的 float panel 只存在于 demo 页；bench CLI 直接输出百分位，
不提供 `--perf` 旗标。

### cross-engine 对比（bench:compare）

三轴对比 decode-wasm（WASM + 紧凑二进制 FFI）vs xterm.js（headless core），量化 #7「桥接去
JSON 化」的收益。依赖 devDependency `@xterm/headless`（`npm install` 即装）：

```sh
npm run bench:compare                       # 80×24 表格
npm run bench:compare -- --size=120x40 --json   # 自定义尺寸 + 机器可读
```

纯 core 上限（native release，去掉序列化后的理论上限）：

```sh
cargo run --release --example throughput    # decode-core 纯解析（无序列化）
```

## 重新生成 glue

改 `crates/decode-wasm` 后，一条命令重建（`pkg/`、`pkg-node/` 为生成物，不在 git 里）：

```sh
npm run build:glue
```

fresh clone 先跑一次 `npm run build:glue` 生成 glue，`npm test` / demo 才能跑。
