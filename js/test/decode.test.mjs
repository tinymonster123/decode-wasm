// decode.js 解码器单元测试：锁二进制格式（与 lib.rs encode_changes 对齐），
// 并用真实 Core.feed() 做一次往返，确认 FFI 二进制 → 对象形状与旧 JSON 完全同形。
//
// 跑法：node js/test/decode.test.mjs  （在仓库根目录）
// 依赖 js/pkg-node（wasm-bindgen --target nodejs 生成的 glue）。
import assert from 'node:assert/strict';
import { decodeChanges } from '../src/decode.js';
import { Core } from '../pkg-node/decode_wasm.js';
import { VIM_COLS, VIM_ROWS, vimStartupBytes } from '../fixtures/vim-start.js';

// 1) 手工拼一段二进制：cell('中', width2, fg1, bg2, attrs3, row0, col1) + reset。
const cell = new Uint8Array(22);
cell[0] = 0;                                    // tag cell
new DataView(cell.buffer).setUint32(1, 0, true);     // row
new DataView(cell.buffer).setUint16(5, 1, true);     // col
new DataView(cell.buffer).setUint32(7, 0x4e2d, true); // ch '中'
cell[11] = 2;                                   // width
new DataView(cell.buffer).setUint32(12, 1, true);    // fg
new DataView(cell.buffer).setUint32(16, 2, true);    // bg
new DataView(cell.buffer).setUint16(20, 3, true);    // attrs
const reset = new Uint8Array([5]);
const bytes = new Uint8Array([...cell, ...reset]);

const changes = decodeChanges(bytes);
assert.equal(changes.length, 2);
assert.deepEqual(changes[0], { t: 'cell', row: 0, col: 1, ch: '中', width: 2, fg: 1, bg: 2, attrs: 3 });
assert.deepEqual(changes[1], { t: 'reset' });

// 1b) cell_run：3 格同样式（fg1 bg2 attrs3，row2 起始 col5）→ 展开成 3 个逐格 cell。
// tag(1) + row:u32 + col:u16 + count:u16 + fg:u32 + bg:u32 + attrs:u16 = 19B，加 3×5=15B。
const run = new Uint8Array(34);
const rv = new DataView(run.buffer);
run[0] = 6;                                      // tag cell_run
rv.setUint32(1, 2, true);                        // row
rv.setUint16(5, 5, true);                        // col
rv.setUint16(7, 3, true);                        // count
rv.setUint32(9, 1, true);                        // fg
rv.setUint32(13, 2, true);                       // bg
rv.setUint16(17, 3, true);                       // attrs
// 格 0：ch 'a'(0x61) width 1
rv.setUint32(19, 0x61, true); run[23] = 1;
// 格 1：ch '中'(0x4e2d) width 2
rv.setUint32(24, 0x4e2d, true); run[28] = 2;
// 格 2：ch 'b'(0x62) width 1
rv.setUint32(29, 0x62, true); run[33] = 1;
assert.deepEqual(decodeChanges(run), [
  { t: 'cell', row: 2, col: 5, ch: 'a', width: 1, fg: 1, bg: 2, attrs: 3 },
  { t: 'cell', row: 2, col: 6, ch: '中', width: 2, fg: 1, bg: 2, attrs: 3 },
  { t: 'cell', row: 2, col: 7, ch: 'b', width: 1, fg: 1, bg: 2, attrs: 3 },
]);

// 2) 真实 Core.feed 往返：vim 流 → 二进制 → 解码，tags 与旧 JSON 一致。
const core = new Core(VIM_COLS, VIM_ROWS);
const decoded = decodeChanges(core.feed(vimStartupBytes()));
const tags = new Set(decoded.map((c) => c.t));
for (const t of ['cell', 'clear', 'cursor', 'reset']) assert.ok(tags.has(t), t);
assert.ok(!tags.has('scroll_up') && !tags.has('scroll_down'));

// 3) 空 feed（resize 会 feed 空字节拉出 reset + 光标）→ 解码出 [reset, cursor] 而非崩。
const core2 = new Core(VIM_COLS, VIM_ROWS);
core2.resize(VIM_COLS, VIM_ROWS);
assert.deepEqual(decodeChanges(core2.feed(new Uint8Array(0))), [
  { t: 'reset' },
  { t: 'cursor', row: 0, col: 0, hidden: false },
]);

console.log(`✅ decode 通过：手工 2 条 + vim 往返 ${decoded.length} 条，tags=[${[...tags].join(',')}]`);
