# decode_wasm E2E 测试清单（Playwright）

> 面向浏览器 demo（`js/main.js` + `index.html`）的端到端测试。Node 侧已有 `npm test` 覆盖（adapters 19 项 + smoke 762 条 change），本清单只补**浏览器层**。
>
> 前置：`npm run serve`（仓库根，`python3 -m http.server 8000`）→ demo 在 `http://localhost:8000/js/`。web target 的 glue 用 `fetch` 加载 `.wasm`，`file://` 会被 CORS 拦，必须走 http.server。

## 关键事实（写断言用）

- 默认尺寸：`VIM_COLS=60`、`VIM_ROWS=15`（`js/fixtures/vim-start.js`）；canvas 格子 `CW=10`、`CH=20`（`js/src/renderers/canvas.js`）→ 默认 canvas `600×300`。
- URL query（`js/main.js`）：
  - `?renderer=canvas|dom|text`（默认 canvas）
  - `?bench=throughput|latency|scroll`（有则 bench 模式，无则 vim demo）
  - `?perf=1`（float 性能 HUD）
  - `?cols=N&rows=N`（非法/空回退 VIM 60×15；`parseDim` 只认 `>0` 的整数）
- 三后端 DOM 形状：
  - canvas → `#screen > canvas`
  - dom → `#screen > div.dom-screen`，一行一个子 `<div>`（默认 15 行）
  - text → `#screen > pre.text-screen`，`textContent` 是纯文本网格
- 未知 backend → `document.body` 显示 `未知 renderer: "..."` 并 throw（`pageerror` 捕获）。
- bench 模式：结果写 `#result`（`<pre>`），同时 `console.log` 一条。

## Playwright 配置建议

- `baseURL: 'http://localhost:8000'`
- `webServer: { command: 'npm run serve', port: 8000, reuseExistingServer: true }`（省手动起服务）
- 全局监听 `page.on('pageerror')` + `page.on('console', m => m.type()==='error')`，冒烟类断言「零 error」。
- 打 tag：`@smoke` / `@functional` / `@bench` / `@perf` / `@edge`，用 `--grep` 分跑。

## A. 冒烟（@smoke）——三后端无错误渲染

| # | URL | 断言 |
|---|---|---|
| A1 | `/js/?renderer=canvas` | `#screen > canvas` 存在，`width=600, height=300`；零 pageerror |
| A2 | `/js/?renderer=dom` | `#screen > .dom-screen` 存在，子 `<div>` 行数 = 15；零 pageerror |
| A3 | `/js/?renderer=text` | `#screen > pre.text-screen` 存在，`textContent` 含 `fn main`（vim 启动内容）；零 pageerror |

## B. 功能（@functional）

| # | 动作 | 断言 |
|---|---|---|
| B1 | 加载 `/js/?renderer=canvas` | 页面无 `.dom-screen`（一次只装一个 backend） |
| B2 | 加载 `/js/?renderer=dom` | 页面无 `canvas`（同上） |
| B3 | text 页在 `#input` 键入 `a` | `pre.text-screen` 的 `textContent` 发生变化（含 `a`；demo 无真 vim，字节只回显进网格，位置不定，断言「变化 + 含字符」即可） |
| B4 | 键入 `Enter` / `Backspace` / `Tab` / `Escape` | 不抛错（映射 0x0d / 0x08 / 0x09 / 0x1b）；方向键等非单字符键被忽略 |
| B5 | `/js/?renderer=bogus` | `body` 含 `未知 renderer: "bogus"`；`pageerror` 捕获到 throw |

## C. bench 模式（@bench）

| # | URL | 断言 |
|---|---|---|
| C1 | `/js/?bench=throughput&renderer=text` | `#result` 含 `吞吐: core` 与 `MB/s` |
| C2 | `/js/?bench=latency` | `#result` 含 `延迟 core` 与 `p50` / `p95` / `p99` |
| C3 | `/js/?bench=scroll` | `#result` 含 `滚动 core` 与 `scroll/s` |
| C4 | bench 模式（任意） | `#screen` 无 vim 内容（bench 不 feed vim，只出 `#result`） |

## D. perf 面板（@perf）

| # | URL | 断言 |
|---|---|---|
| D1 | `/js/?perf=1` | 出现 float HUD（含 FPS / 帧时间 / feed 延迟 等标签） |
| D2 | `/js/`（无 perf） | 无 float HUD |

## E. 尺寸 / 边界（@edge）

| # | URL | 断言 |
|---|---|---|
| E1 | `/js/?renderer=canvas&cols=80&rows=24` | canvas `800×480`（80×10 × 24×20） |
| E2 | `/js/?renderer=canvas&cols=abc&rows=0` | 回退默认 `600×300`（不崩、不 0 尺寸） |
| E3 | `/js/?renderer=canvas&cols=&rows=` | 回退默认 `600×300` |
| E4 | `/js/?renderer=dom&rows=24` | `.dom-screen` 子 `<div>` 行数 = 24 |

## F. Node 回归（非 Playwright，防手改）

- `npm test` 全绿（adapters 19 项 + smoke 762 条 change）
- `npm run bench -- --renderer=text --bench=throughput` 出数（core/full 双档）
- `npm run build:glue` exit 0，且 `js/pkg-node/package.json` = `{"type": "commonjs"}`（CJS 标记不能丢）
