// 端口（port）：JS 侧 `Renderer` 接口 + 显式 factory。
//
// SPEC §10（决策 #13/#14/#16）锁定：
//   - 端口在 JS 侧，不是 Rust trait——Rust 侧 trait 会把 draw 调用推过 WASM 边界、
//     把核心耦到渲染抽象。数据端口（Change 流）已经存在，端口 = 它的消费者侧接口。
//   - 共享网格模型是 grid.js（唯一权威状态）；每个 adapter 只读它、只自管绘制资源，
//     不复刻网格副本。
//   - grid 即共享表示，不引入中间 scene/几何层（不采用 d3gl 式设计）。
//
// 每个 adapter 必须实现这个形状（SPEC §10 的接口，无运行时类型，靠约定 + 本注释锁定）：
//
//   render(grid, cursor)
//     全量重绘（init / reset / 有内容变更时）。grid 是 grid.js 的网格
//     （Cell = { ch, width, fg, bg, attrs }），cursor 是 { row, col, hidden } | null。
//
//   blitScroll(dir, top, bottom, count, grid, cursor)
//     纯滚动快路径。调用时机：一次 feed() 只产生 scroll_up/scroll_down、
//     没有 cell/clear/reset（见 session.js 的判定）。grid 已经是滚动后的状态。
//       dir: 'up'   = 内容上移（对应 change tag 'scroll_up'，底部补 count 空白行）
//       dir: 'down' = 内容下移（对应 change tag 'scroll_down'，顶部补 count 空白行）
//       [top, bottom] 是滚动边距（含端点），count 是滚的行数。
//
//   resize?(cols, rows)
//     可选：几何变化。canvas/DOM 要重建绘制资源，text 要重置列数。
//
// retained vs immediate（SPEC §10）：DOM 是 retained（内部 diff 决定改哪些节点），
// canvas/WebGL/WebGPU 是 immediate（整帧/blit）。所以接口只暴露「渲染这个网格状态」，
// 不暴露逐格 drawCell——DOM adapter 内部自己 diff。
//
// 硬约束：adapter 显式声明、一次只装一个；factory 遇未知 backend 直接 throw，
// 禁止像 xterm.js 那样悄悄 fallback 到 DOM renderer（WebGL 失败会被 DOM 掩盖，问题查不到）。

import { createCanvasRenderer } from './canvas.js';
import { createDOMRenderer } from './dom.js';
import { createTextRenderer } from './text.js';
import { createWebGLRenderer } from './webgl.js';
import { createWebGPURenderer } from './webgpu.js';

/** 可选 backend（与 SPEC §10 适配器清单对齐；webgl/webgpu 是 v2 接口桩）。 */
export const BACKENDS = ['canvas', 'dom', 'text', 'webgl', 'webgpu'];

/**
 * 显式 dispatch：按 backend 选一个 adapter。未知 backend → throw（不做隐式 fallback）。
 *
 * @param {'canvas'|'dom'|'text'|'webgl'|'webgpu'} backend
 * @param {{canvas?: HTMLCanvasElement, host?: HTMLElement, cols?: number, rows?: number}} [opts]
 *   - canvas / webgl / webgpu 需要 `opts.canvas`
 *   - dom 需要 `opts.host`（挂载行 div 的容器）
 *   - text 不需要元素（纯字符串）
 */
export function createRenderer(backend, opts = {}) {
  switch (backend) {
    case 'canvas':
      return createCanvasRenderer(opts.canvas, opts.cols, opts.rows);
    case 'dom':
      return createDOMRenderer(opts.host, opts.cols, opts.rows);
    case 'text':
      return createTextRenderer(opts.cols, opts.rows);
    case 'webgl':
      return createWebGLRenderer(opts.canvas, opts.cols, opts.rows);
    case 'webgpu':
      return createWebGPURenderer(opts.canvas, opts.cols, opts.rows);
    default:
      throw new Error(
        `未知 renderer: "${backend}"（可选 ${BACKENDS.join('|')}）。adapter 显式声明、不做隐式 fallback。`
      );
  }
}
