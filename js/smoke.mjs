// Node 端到端 smoke test：把一段真实 vim 启动字节喂进编译好的 WASM Core，
// 用 apply.js 把 change 流应用到 JS 网格，断言最终屏幕和 change 类型都正确。
//
// 跑法：node js/smoke.mjs  （在仓库根目录）
// 依赖 js/pkg-node（wasm-bindgen --target nodejs 生成的 glue）。
import assert from 'node:assert/strict';
import { Core } from './pkg-node/decode_wasm.js';
import { newGrid, applyChanges, gridText } from './apply.js';
import { VIM_COLS, VIM_ROWS, vimStartupBytes } from './vim-sequence.js';

const core = new Core(VIM_COLS, VIM_ROWS);
const grid = newGrid(VIM_COLS, VIM_ROWS);

const changes = JSON.parse(core.feed(vimStartupBytes()));
const cursor = applyChanges(grid, VIM_COLS, VIM_ROWS, changes);

// 1) change 流只报「变更」：有 cell/clear/cursor/reset，无滚动（3 行文件不滚动）。
const tags = new Set(changes.map((c) => c.t));
for (const t of ['cell', 'clear', 'cursor', 'reset']) {
  assert.ok(tags.has(t), `change 流应含 ${t}，实际 tags: ${[...tags].join(',')}`);
}
assert.ok(!tags.has('scroll_up') && !tags.has('scroll_down'),
  `小文件不应触发滚动，实际 tags: ${[...tags].join(',')}`);

// 2) 最终屏幕 = vim 打开的 3 行文件 + 编辑（G → i → x → Esc 在 `}` 前插了 x）。
//    行都右填充到 60 列，只去尾部空白，保留 Rust 缩进。
const trimEnd = (s) => s.replace(/\s+$/, '');
const rows = gridText(grid, VIM_COLS, VIM_ROWS).split('\n');
assert.equal(trimEnd(rows[0]), 'fn main() {');
assert.equal(trimEnd(rows[1]), '    println!("hello");');
assert.equal(trimEnd(rows[2]), 'x}', '插入模式应把 x 插到 `}` 行首');
for (let r = 3; r <= 13; r++) {
  assert.equal(trimEnd(rows[r]), '~', `空行 row${r} 应显示 ~`);
}
assert.equal(trimEnd(rows[14]), '', '底部状态行应为空（Esc 已退出插入模式）');

// 3) 光标落在被编辑的行（row 2），可见。
assert.equal(cursor.row, 2, `光标应在编辑行，实际 ${JSON.stringify(cursor)}`);
assert.equal(cursor.hidden, false);

console.log(`✅ smoke 通过：${changes.length} 条 change，tags=[${[...tags].join(',')}]`);
console.log(gridText(grid, VIM_COLS, VIM_ROWS));
