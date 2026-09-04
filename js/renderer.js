// 最小 canvas 渲染器：把 apply.js 的网格画到 canvas。
//
// 职责边界（SPEC §1/§2）：core 只报「哪些格子变了」，渲染（像素）是这里的事。
// 这里做两件事：全量重绘（Cell + 光标），和滚动 blit（canvas 整块拷贝 + 只重画新空行）。
// 颜色编码 → CSS 颜色见 palette.js。

import { colorOf } from './palette.js';

const CW = 10; // 每格宽（px）
const CH = 20; // 每格高（px）

export function createRenderer(canvas, cols, rows) {
  const ctx = canvas.getContext('2d');
  canvas.width = cols * CW;
  canvas.height = rows * CH;
  ctx.font = '16px monospace';
  ctx.textBaseline = 'top';

  function drawCell(c, r, cell) {
    const x = c * CW;
    const y = r * CH;
    ctx.fillStyle = colorOf(cell.bg);
    ctx.fillRect(x, y, CW, CH);
    if (cell.width !== 0 && cell.ch !== ' ') {
      ctx.fillStyle = colorOf(cell.fg);
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

  // 全量重绘：清屏 + 逐格画 + 光标。
  function render(grid, cursor) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < rows; r++) drawRow(r, grid[r]);
    drawCursor(cursor);
  }

  // 滚动 blit：canvas 整块拷贝 [top,bottom] 区域，再重画新滚入的空白行 + 光标。
  // 依赖画布仍是滚动前的旧帧，所以调用方要在 applyChanges 之后、下一次 render 之前
  // 调它（见 main.js）。保留行数为 0 时退回全量重绘。
  function blitScroll(dir, top, bottom, count, grid, cursor) {
    const kept = bottom - top + 1 - count;
    if (kept <= 0) {
      render(grid, cursor);
      return;
    }
    const keptH = kept * CH;
    if (dir === 'scroll_up') {
      // [top+count .. bottom] 上移到 [top .. bottom-count]。
      ctx.drawImage(canvas, 0, (top + count) * CH, canvas.width, keptH, 0, top * CH, canvas.width, keptH);
      for (let r = bottom - count + 1; r <= bottom; r++) drawRow(r, grid[r]);
    } else {
      // [top .. bottom-count] 下移到 [top+count .. bottom]。
      ctx.drawImage(canvas, 0, top * CH, canvas.width, keptH, 0, (top + count) * CH, canvas.width, keptH);
      for (let r = top; r < top + count; r++) drawRow(r, grid[r]);
    }
    drawCursor(cursor);
  }

  return { render, blitScroll };
}
