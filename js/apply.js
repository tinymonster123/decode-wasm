// 纯网格模型：把 `Core.feed()` 返回的 change 流应用到 JS 侧网格。
//
// 无 DOM / canvas 依赖，浏览器渲染器和 Node smoke test 共用同一份逻辑，
// 保证「change 流 → 网格」这条路在两边一致。一个格 = { ch, width, fg, bg, attrs }，
// 与 decode-core 的 `Cell` 一一对应；颜色编码见 palette.js。

const DEFAULT_FG = 256;
const DEFAULT_BG = 257;

export function blankCell() {
  return { ch: ' ', width: 1, fg: DEFAULT_FG, bg: DEFAULT_BG, attrs: 0 };
}

export function blankRow(cols) {
  return Array.from({ length: cols }, blankCell);
}

export function newGrid(cols, rows) {
  return Array.from({ length: rows }, () => blankRow(cols));
}

// 把一段 change 数组原地应用到 grid，返回最新光标（或 null）。
//
// change 的 `t` 判别 tag 与 decode-wasm 的 `change_to_value` 对齐：
// cell / scroll_up / scroll_down / clear / cursor / reset。
export function applyChanges(grid, cols, rows, changes) {
  let cursor = null;
  for (const c of changes) {
    switch (c.t) {
      case 'cell':
        grid[c.row][c.col] = { ch: c.ch, width: c.width, fg: c.fg, bg: c.bg, attrs: c.attrs };
        break;
      case 'clear':
        for (let i = 0; i < c.count && c.col + i < cols; i++) {
          grid[c.row][c.col + i] = blankCell();
        }
        break;
      case 'scroll_up':
        // 与 decode-core grid.scroll_up 的 remove(top)+insert(bottom,blank) 一致。
        for (let k = 0; k < c.count; k++) {
          grid.splice(c.top, 1);
          grid.splice(c.bottom, 0, blankRow(cols));
        }
        break;
      case 'scroll_down':
        // 与 decode-core grid.scroll_down 的 remove(bottom)+insert(top,blank) 一致。
        for (let k = 0; k < c.count; k++) {
          grid.splice(c.bottom, 1);
          grid.splice(c.top, 0, blankRow(cols));
        }
        break;
      case 'cursor':
        cursor = { row: c.row, col: c.col, hidden: c.hidden };
        break;
      case 'reset':
        // 全量重绘：清空网格，后续 cell 变更会把非空格重新画回来。
        for (let r = 0; r < rows; r++) grid[r] = blankRow(cols);
        break;
    }
  }
  return cursor;
}

// 把网格渲染成多行字符串（与 decode-core 的 `screen_lines` 对齐，供测试对照）。
export function gridText(grid, cols, rows) {
  return grid
    .map((row) => row.map((cell) => (cell.width === 0 ? ' ' : cell.ch)).join(''))
    .join('\n');
}
