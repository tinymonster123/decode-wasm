// CanvasRenderer（SPEC §10）：immediate 渲染器，直接往 2D canvas 画整个网格状态。
//
// 端口在 JS 侧、每 renderer 一个 adapter 共享 grid-model（apply.js）；grid 即共享
// 表示，不引入 scene/几何层（决策 #13/#14/#16）。本 adapter 只读 apply.js 喂进来的
// 网格，自管 canvas/ctx 绘制资源，不复刻网格副本。
//
// 实现 Renderer 接口（见 renderer.js 注释）：
//   - render(grid, cursor)                      全量重绘
//   - blitScroll(dir, top, bottom, count, ...)  纯滚动快路径（dir: 'up'/'down'）
//   - resize(cols, rows)                        几何变化：重设 canvas 尺寸
//
// canvas 是 immediate 模式（整帧/blit），不暴露逐格 drawCell 给调用方。
// 模块顶层不碰 document/window，DOM 访问全部在 factory 函数体内（Node import 安全）。

import { colorOf } from './palette.js';

const CW = 10; // 每格宽（px）
const CH = 20; // 每格高（px）

const INVERSE = 32; // attrs 位标志（与 decode-core 对齐）

/** 创建 CanvasRenderer adapter。canvas/ctx 属于本 adapter 私有的绘制资源。 */
export function createCanvasRenderer(canvas, cols, rows) {
  const ctx = canvas.getContext('2d');
  canvas.width = cols * CW;
  canvas.height = rows * CH;
  ctx.font = '16px monospace';
  ctx.textBaseline = 'top';

  function drawCell(c, r, cell) {
    const x = c * CW;
    const y = r * CH;
    // INVERSE 交换前后景（与 dom/text adapter 一致）；其余 attrs（BOLD/DIM/…）留 v2。
    const fg = cell.attrs & INVERSE ? cell.bg : cell.fg;
    const bg = cell.attrs & INVERSE ? cell.fg : cell.bg;
    ctx.fillStyle = colorOf(bg);
    ctx.fillRect(x, y, CW, CH);
    if (cell.width !== 0 && cell.ch !== ' ') {
      ctx.fillStyle = colorOf(fg);
      ctx.fillText(cell.ch, x, y + 2);
    }
  }

  function drawRow(r, row) {
    ctx.fillStyle = colorOf(row[0].bg); // 先清背景
    ctx.fillRect(0, r * CH, cols * CW, CH);
    for (let c = 0; c < cols; c++) drawCell(c, r, row[c]);
  }

  function drawCursor(cursor) {
    if (!cursor || cursor.hidden) return;
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(cursor.col * CW, cursor.row * CH, CW, CH);
  }

  function render(grid, cursor) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < rows; r++) drawRow(r, grid[r]);
    drawCursor(cursor);
  }

  function blitScroll(dir, top, bottom, count, grid, cursor) {
    const kept = bottom - top + 1 - count;
    if (kept <= 0) {
      render(grid, cursor);
      return;
    }
    const keptH = kept * CH;
    if (dir === 'up') {
      // 内容上移（对应 change tag 'scroll_up'）：底部补 count 空白行。
      ctx.drawImage(canvas, 0, (top + count) * CH, canvas.width, keptH, 0, top * CH, canvas.width, keptH);
      for (let r = bottom - count + 1; r <= bottom; r++) drawRow(r, grid[r]);
    } else {
      // 内容下移（对应 change tag 'scroll_down'）：顶部补 count 空白行。
      ctx.drawImage(canvas, 0, top * CH, canvas.width, keptH, 0, (top + count) * CH, canvas.width, keptH);
      for (let r = top; r < top + count; r++) drawRow(r, grid[r]);
    }
    drawCursor(cursor);
  }

  function resize(c, r) {
    cols = c;
    rows = r;
    canvas.width = cols * CW;
    canvas.height = rows * CH;
  }

  return { render, blitScroll, resize };
}
