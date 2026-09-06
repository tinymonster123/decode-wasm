# decode_wasm — 终端仿真器核心 spec

> 这是 wayfinder map 的目的地交付物。所有架构决策在此锁定，照着写代码即可、无需再想。
> 定稿日期：2026-09-04。

## 1. 这是什么

decode_wasm 是一个 **Rust → WASM 的终端仿真器核心库**，负责六步链中的「仿真器读 → 网格」这一格：

```
程序 → 字节流 → PTY → [decode_wasm] → 网格 → 像素(渲染器，本库不做)
```

它吃 PTY 输出的字节，吐「哪些格子变了」。**完全不知道 Canvas/WebGL/DOM 的存在**——纯计算，所以能编译成 WASM。

价值主张：`feed()` 返回的是「只变更的格子 diff」，这是「丝滑滚动」的必要前提——渲染器拿到 diff 后只需重画变化的格子、滚动时只需 blit，不必每次全量重绘。

## 2. 目标 & 非目标

**目标（v1）：**

- 一个能跑通「字节流 → 网格 → diff」的核心，喂给 JS 渲染器。
- 验收标准：跑一个全屏 TUI（vim 开文件）输出正确变更。
- 交付优先：先正确、可验证，再谈优化。

**非目标（out of scope）：**

- 渲染器（Canvas/WebGL）**本体**——「等图形学懂了」那个项目。（「核心 ↔ 渲染器」之间的**端口 + adapter 层**进 scope，见 §10。）
- Warp block-list 虚拟化滚动——渲染层/视图层的事。
- 「丝滑滚动」blit——渲染器的事；核心只交付「只报变更」的 diff 前提。
- PTY/进程 spawn——核心是字节流进，不含取字节。
- grapheme 簇（ZWJ emoji、组合字符）——v2。

## 3. 架构：四块

```
feed(bytes) ──► [Parser] ──► [Handler] ──► [Grid] ──► 输出 Box<[Change]>
                 (vte)       (vte::Perform)  (flat+scrollback)  (diff)
```

1. **Parser** = `vte` crate（Alacritty 的解析器，Warp 也用它）。不手写 ECMA-48 状态机。
2. **Handler** = 我们实现的 `vte::Perform`：vte 解析出 token，回调我们的 Perform 方法，我们据此改 Grid 并记录变更。
3. **Grid** = flat grid（rows × cols 的 Cell）+ 旋转 scrollback（`VecDeque<Row>`）。
4. **Diff** = `feed()` 的返回值：一批类型化的 `Change`。

## 4. 公共接口

```rust
pub struct Terminal { /* vte::Parser + Screen */ }

impl Terminal {
    pub fn new(cols: u16, rows: u16) -> Terminal;
    pub fn feed(&mut self, bytes: &[u8]) -> Box<[Change]>; // 核心方法
    pub fn resize(&mut self, cols: u16, rows: u16);         // 几何变化 → 全量重绘
}
```

`feed()` 返回 `Box<[Change]>`：内部 `Vec<Change>` 收集 → `into_boxed_slice()` 丢掉 capacity 字段（24B → 16B，Cloudflare 思想）。WASM 前端 `decode-wasm` 用 wasm-bindgen 把同样的接口导出给 JS（结构体名 `Core`）。

### Cell

```rust
#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub struct Cell {
    pub ch: char,    // 码点（grapheme 簇留 v2）
    pub width: u8,   // 显示宽度 1|2（CJK 等宽字符）
    pub fg: u32,     // 调色板索引（决策 #7：传索引，不归一化 RGB）
    pub bg: u32,
    pub attrs: u16,  // 位标志：BOLD|DIM|ITALIC|UNDERLINE|BLINK|INVERSE|STRIKE
}
```

`fg`/`bg` 存**调色板索引**：

- `0..=255`：256 色表索引。
- `256` / `257`：默认前景 / 默认背景哨兵。
- `0x0100_0000 | rgb`：truecolor（24 位 RGB，位 24 置位）。

RGB 归一化交给 JS 渲染器（支持主题重映射），核心不绑定配色。

### Change

```rust
pub enum Change {
    Cell       { row: u32, col: u16, cell: Cell },   // 内容变更，自带完整字形+样式
    ScrollUp   { top: u16, bottom: u16, count: u16 }, // 区域滚动（DECSTBM）
    ScrollDown { top: u16, bottom: u16, count: u16 },
    Clear      { row: u32, col: u16, count: u16 },    // 清 count 个格子为默认
    Cursor     { row: u32, col: u16, hidden: bool },  // 放最后，光标盖最上
    Reset,                                             // 全量重绘（alt screen 切换等）
}
```

寻址：**viewport 相对**（`row` 是可见区内的行，非 scrollback 绝对行）。scrollback 走单独 getter（v1 不做渲染）。

## 5. 数据模型

- **Cell**：一个格子（见上）。
- **Grid**：`rows × cols` 的 Cell + 滚动边距 + scrollback（`VecDeque<Row>`）。
- **Scrollback**：滚动时活跃屏滚出的行 push 进去，旧的在 `index 0`。
- **Alt screen**：v1 支持 alt screen（vim/htop 用），切换时主屏与 alt 屏各自持有网格。

## 6. 锁定决策（wayfinder map 的结论）

| # | 决策 | 选择 |
|---|---|---|
| 1 | 解析器 | `vte`（不手写） |
| 2 | 网格模型 | flat + 旋转 scrollback |
| 3 | I/O 契约 | `feed() -> Box<[Change]>` |
| 4 | 工具链 | wasm-bindgen + workspace |
| 5 | MVP | alt screen + 宽字符 |
| 6 | 测试 | 黄金快照 + vttest |
| 7 | 调色板 | 传索引 |
| 8 | 寻址 | viewport 相对 |
| 9 | scrollback 渲染 | v1 不做 |
| 10 | 区域滚动 | 进 v1（DECSTBM） |
| 11 | 格子粒度 | 单码点 + width |
| 12 | 零分配路径 | v2 |
| 13 | 端口位置 | JS 侧 `Renderer` 接口（非 Rust trait） |
| 14 | adapter 形态 | 每 renderer 一个适配器，共享 grid-model |
| 15 | 性能采样 | 三轴：吞吐 / 延迟 / 帧时间；bench 用启动命令区分 |
| 16 | 中间表示 | grid 即共享表示，不引入额外 scene/几何层（不采用 d3gl 式） |

## 7. MVP 范围（v1 Handler 实现的序列清单）

（这是 ticket「锁定 v1 Handler 的转义序列范围」的结论，折叠进 spec。）

**C0 控制码**（`execute`）：`BS(0x08)` 左移、`TAB(0x09)` 制表、`LF(0x0A)`/`VT(0x0B)`/`FF(0x0C)` 换行、`CR(0x0D)` 回行首；其余（BEL/NUL/SO/SI）忽略。

**ESC 序列**（`esc_dispatch`）：`7/8` 存/取光标、`D` 向下滚一行、`E` 下一行、`M` 反向索引（向上滚）、`c` 全复位（RIS）、`=`/`>` 键区模式（忽略）。字符集切换 `(`/`)` 忽略（UTF-8 直通）。

**CSI**（`csi_dispatch`）：

- 光标：`A/B/C/D`（上下左右）、`H/f`（CUP/HVP 定位）、`G`（CHA 列）、`d`（VPA 行）。
- 编辑：`J`（ED 清屏 0/1/2/3）、`K`（EL 清行 0/1/2）、`X`（ECH 清格）、`@`（ICH 插格）、`P`（DCH 删格）、`L`（IL 插行）、`M`（DL 删行）。
- 样式：`m`（SGR）——0 复位、1 粗、2 暗、3 斜、4 下划线、5/6 闪烁、7 反显、9 删除线、22/23/24/25/27 复位、30-37/90-97 前景、40-47/100-107 背景、38/48 扩展色（256 + truecolor）、39/49 默认。
- 滚动：`r`（DECSTBM 边距）、`S`/`T`（SU/SD 滚动）。
- 模式：`h/l`（SM/RM）——`?1049`（alt screen）、`?25`（光标显隐）、`?7`（自动换行）、`?2004`（bracketed paste，只接受不实现——粘贴括起是输入侧）。
- 存/取光标：`s/u`。

**OSC**（`osc_dispatch`）：v1 全部忽略（标题/调色板是渲染器的事）。

**v1.1 新增**（本票结论）：alt-screen 变体 `?47`（DECSC）/ `?1047` 与存/取光标 `?1048`——复用 `?1049` 的 enter/exit_alt 路径（含存光标，语义细分留 v2）；实现另开票。

**推迟 v2**：resize/回流、grapheme 簇、完整 OSC（标题 / OSC 8 超链接 / OSC 52）、鼠标。

## 8. 验证 harness（ticket「设计最小 demo/验证 harness」的结论）

- 核心的正确性靠 **黄金快照测试**（`decode-core` 内 `cargo test`）：喂一段字节 → 断言 Grid 状态 + Change 序列。
- 端到端「肉眼看得见」靠 **最小 canvas 渲染器**（`js/` 目录，后续）：只画 Cell + 光标 + 处理 Scroll blit，跑 vim 能看到屏幕。
- 两者都做：测试保正确，demo 保「交付可见」。

## 9. 项目布局

```
decode_wasm/
├── Cargo.toml           (workspace)
├── SPEC.md
├── crates/
│   ├── decode-core/     (纯 Rust 核心，无 wasm 依赖，可 cargo test)
│   └── decode-wasm/     (wasm-bindgen 前端，导出给 JS)
└── js/                  (最小 canvas 渲染器 demo，后续)
```

## 10. adapter 层（端口与适配器）

渲染器本体仍 out of scope（§2），但「核心 ↔ 渲染器」之间那条缝进 scope：**一个稳定端口 + 每个 renderer 一个适配器**。依赖方向锁定为 `renderer → 端口 → core`，绝不反向——这就是「渲染无关」从口号变成工程约束。

### 端口：JS 侧的 `Renderer` 接口

核心继续只吐 `Box<[Change]>`，Rust 一行不动。端口是消费者侧的一个接口，把现在 `js/src/renderers/index.js` 的方法显式化：

```ts
interface Renderer {
  render(grid: Grid, cursor: Cursor | null): void;                    // 全量重绘（init/reset）
  blitScroll(dir: 'up'|'down', top: number, bottom: number,
             count: number, grid: Grid, cursor: Cursor | null): void; // 纯滚动快路径
  resize?(cols: number, rows: number): void;                          // 可选
}
```

关键约束（就是这一层的决策）：

- **端口在 JS 侧，不是 Rust `trait Renderer`**。Rust 侧 trait 会把 draw 调用推过 WASM 边界、把核心耦到渲染抽象，破坏「渲染无关」。数据端口（Change 流）已经存在，端口 = 它的消费者侧接口。
- **共享网格模型** `grid-model`（现在的 `js/src/grid.js`）是唯一权威状态；每个 adapter 只读它、只自管绘制资源，**不复刻网格副本**。
- **retained vs immediate**：DOM 是 retained（增量改节点），canvas/WebGL/WebGPU 是 immediate（整帧/blit）。所以 `Renderer` 只暴露「渲染这个网格状态」，不暴露「逐格 drawCell」——DOM adapter 内部自己 diff 决定改哪些节点。
- **不许隐式回退**：adapter 显式声明、一次只装一个；禁止像 xterm.js 那样悄悄 fallback 到 DOM renderer（WebGL 失败会被 DOM 掩盖，问题查不到）。

### 适配器清单（v1）

- `CanvasRenderer`——现有 `js/src/renderers/index.js` 抽成实现（像素）。
- `DOMRenderer`——一行一个 `<div>`，增量改 `textContent`/`style`（元素，最简单、最易维护）。
- `TextRenderer`——把网格渲成 ANSI 字符串（纯文本，用于断言 / 导出 / SSH）。
- `WebGLRenderer` / `WebGPURenderer`——纹理图集 + instanced quad（v2，为丝滑滚动铺路）。

渲染后端性能序（社区共识，供选型参考）：**WebGL > Canvas > SVG ≥ DOM**；代价序相反：DOM 实现最便宜、WebGL 最贵（xterm.js 就因 canvas/WebGL 维护成本高而贡献者少）。所以 v1 先落 canvas/DOM/text 三条「便宜且能证明端口通用」的线，WebGL/WebGPU 只留接口。

### 参考项目与取舍

| 项目 | 借鉴点 |
|---|---|
| xterm.js | `IRenderer` + Dom/Canvas/WebGL 可选 addon；脏行追踪（`RenderService`） |
| ratatui | `Backend` trait + crossterm/termion/termwiz 三 adapter（push 原语粒度） |
| wezterm | `front_end` 配置选前端（Software / WebGpu / OpenGL），GPU 不可用自动回退 |
| beamterm | WebGL2 单次 instanced draw、45k 格 <1ms（WebGL adapter 参考实现） |
| d3gl | **不采用**（见下） |

**不采用 d3gl 式设计**：d3gl 把数据先投影/细分成一个 backend 无关的中间 Scene，再让各 backend 渲染它。我们不需要这层中间抽象——`grid-model`（权威网格）本身就是那个「建一次的共享表示」，每个 renderer 直接读它；再往上叠一层 scene 是纯冗余。

**v2 展望**：端口粒度从「整网格 `render(grid)` + `blitScroll`」升级为**脏行追踪**（只重画变化的行），对标 xterm.js 的 `RenderService`。

## 11. 性能采样 harness

目标：同一份字节流，分别量化「核心解析」与「渲染」两条链，且不同 renderer 可横向对比。

### 采样指标（对齐社区方法）

社区把终端性能拆成三条轴（kitty docs：能耗 / 键到屏延迟 / 吞吐），我们采样三组：

1. **吞吐（core parse）**：`feed()` 处理速度（MB/s）。喂一大段字节（`seq` 输出或 vim 启动流放大 N 倍）测 wall time。注意 kitty `--render` 的语义：**不渲染 = 纯 parser 速度**，我们分两档测。
2. **延迟（feed）**：单次 `feed()` 的 p50/p95/p99（µs），用 `performance.now()` 包住 `core.feed()`。参考：Alacritty Typometer 4.2ms、xterm 3.5ms（整条链含键盘/显示；我们只测 core↔adapter 这一格，会小 1~2 个数量级）。
3. **帧时间（render）**：单帧 `render`/`blitScroll` 的 p50/p95（µs）+ 滚动 FPS（rAF 打点）。参考：WezTerm paint p50 921µs / p95 2.06ms；Metalterm GPU 0.22ms/帧。

### 启动命令区分（bench 模式）

demo 用 URL query 切模式，同一页面同一份代码，只换 renderer/负载。键面解析/校验收敛到
共享 `js/config.js`（决策 #6）：浏览器传 URLSearchParams、Node 传 argv→键值对，解析/校验只此一份。

- `?renderer=canvas|dom|text|webgl|webgpu`——选 adapter（默认 canvas）。
- `?bench=throughput|latency|scroll`——选采样负载（demo/bench 切换保持隐式：`?bench=` 存在即 bench）。
- `?perf=1`——开 float panel + 记录（浏览器面专属）。
- `?size=COLSxROWS`——网格尺寸（如 `?size=80x200`）；浏览器默认 60×15（VIM 尺寸），Node 默认 80×24。

Node 侧同款参数：`node js/cli/bench.mjs --renderer=canvas --bench=throughput --size=80x24`
（Node 面无面板、无 `--perf`；`--json` 输出机器可读结果）。

### float panel（浮动性能面板）

demo 页右上角一个半透明浮动面板（perf HUD），采样期间实时显示并记录：

- FPS / 帧时间（p50 p95 p99，滚动窗口）
- `feed()` 延迟 p50/p95/p99
- change 数/秒（diff 密度）
- 本次会话吞吐 MB/s + 内存（grid 行数 / scrollback 行数）

面板带「导出」按钮，把滚动窗口原始样本 dump 成 JSON/CSV 供离线对比。实现只用 `performance.now()` + 环形缓冲，不引第三方依赖。
