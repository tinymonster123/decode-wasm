// 浏览器 demo 入口：加载 WASM Core → 喂字节 → JSON.parse change 流 → 应用到网格 → 画 canvas。
//
// 跑法：在仓库根 `python3 -m http.server`，浏览器开 http://localhost:8000/js/ 。
// （web target 的 glue 用 fetch 加载 .wasm，`file://` 下会被浏览器 CORS 拦。）

import init, { Core } from './pkg/decode_wasm.js';
import { newGrid, applyChanges } from './apply.js';
import { createRenderer } from './renderer.js';
import { VIM_COLS, VIM_ROWS, vimStartupBytes } from './vim-sequence.js';

await init();

const core = new Core(VIM_COLS, VIM_ROWS);
const grid = newGrid(VIM_COLS, VIM_ROWS);
const renderer = createRenderer(document.getElementById('screen'), VIM_COLS, VIM_ROWS);
let cursor = null;

function feed(bytes) {
  const changes = JSON.parse(core.feed(bytes));
  cursor = applyChanges(grid, VIM_COLS, VIM_ROWS, changes);
  const scrolls = changes.filter((c) => c.t === 'scroll_up' || c.t === 'scroll_down');
  const hasContent = changes.some((c) => c.t === 'cell' || c.t === 'clear' || c.t === 'reset');
  if (scrolls.length && !hasContent) {
    // 纯滚动帧：走 canvas blit 快速路径，不逐格重画。
    const s = scrolls[scrolls.length - 1];
    renderer.blitScroll(s.t, s.top, s.bottom, s.count, grid, cursor);
  } else {
    renderer.render(grid, cursor);
  }
}

// 启动：喂真实 vim 字节流，画出 vim 打开文件的屏幕。
feed(vimStartupBytes());

// 交互：把按键编码成字节再喂回。可打印字符直通，常用控制键映射。
const input = document.getElementById('input');
input.addEventListener('keydown', (e) => {
  let bytes;
  if (e.key === 'Enter') bytes = new Uint8Array([0x0d]);
  else if (e.key === 'Backspace') bytes = new Uint8Array([0x08]);
  else if (e.key === 'Tab') bytes = new Uint8Array([0x09]);
  else if (e.key === 'Escape') bytes = new Uint8Array([0x1b]);
  else if (e.key.length === 1) bytes = new TextEncoder().encode(e.key);
  else return; // 方向键等非单字符键，demo 忽略
  e.preventDefault();
  feed(bytes);
});
input.focus();
