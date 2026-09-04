// DOM renderer（SPEC §10 适配器清单）：一行一个 <div class="row">，每格一个 <span class="cell">。
//
// retained 策略（与 renderer.js 顶注释锁定的一致）：apply.js 的网格（Cell = { ch, width,
// fg, bg, attrs }）是唯一权威，这里只维护「上次已渲染的 cell」副本（state[r][c]）+ 行/格
// DOM 节点，逐帧 diff，只有 cell 的 ch/fg/bg/attrs/width 变了才改对应 span 的
// textContent / style，其余跳过——这就是 retained 与 immediate 的区别（DOM 是 retained，
// 内部自己决定改哪些节点，不暴露逐格 drawCell）。
//
// blitScroll 用「物理搬移 retained 行节点」实现增量滚动：把滚出屏幕的 count 个行 div
// 搬到区域另一头当新滚入的空白行，不重建整树；再 diff 整个区域，搬移后的行 state 已与
// grid 对齐（零重写），只有新滚入的空白行有差异会被重写。
//
// 硬约束：模块顶层不访问 document/window/requestAnimationFrame（Node import 不崩），
// 所有 DOM 操作都在函数体内；只 import palette.js 的 colorOf；ESM export。

import { colorOf } from './palette.js';

// 与 decode-core Cell 的颜色编码对齐（见 palette.js 顶部注释）。
const DEFAULT_FG = 256;
const DEFAULT_BG = 257;

// attrs 位标志（与 decode-core 对齐，见 SPEC 第 4 节）。
const BOLD = 1;
const DIM = 2;
const ITALIC = 4;
const UNDERLINE = 8;
const BLINK = 16; // DOM 不做动画，忽略
const INVERSE = 32;
const STRIKE = 64;

/**
 * 创建一个 retained DOM 渲染器（显式 adapter，不做隐式 fallback）。
 *
 * @param {HTMLElement} host 挂载容器（renderer 负责清空并 append 每行一个 <div>）
 * @param {number} cols 列数
 * @param {number} rows 行数
 */
export function createDOMRenderer(host, cols, rows) {
  if (!host) {
    throw new Error('DOMRenderer 需要 opts.host（挂载行 div 的容器），不能为 null/undefined。');
  }

  let w = cols;
  let h = rows;

  let rowsDivs = []; // rowsDivs[r] = 第 r 行的 <div class="row">
  let spans = [];    // spans[r][c]   = 第 r 行第 c 列的 <span class="cell">
  let state = [];    // state[r][c]   = 上次渲染的 cell 副本（null = 从未渲染）
  let cursorSpan = null; // 当前带 .cursor 的 span（移动光标时移除旧 class）

  // 行的基础内联样式：块级逐行堆叠 + monospace + 保留空白（white-space 会继承给 span）。
  function applyRowStyle(rowDiv) {
    const s = rowDiv.style;
    s.display = 'block';
    s.whiteSpace = 'pre';
    s.fontFamily = 'monospace';
    s.lineHeight = '1.2';
  }

  // 格的基础内联样式：显式保留空白，保证单独一个空格也能占位渲染。
  function applyCellBaseStyle(span) {
    span.style.whiteSpace = 'pre';
  }

  // 把网格里一个 cell 的属性写进 span（textContent + style）。只在 cell 变化时调用。
  function applyCellStyle(span, cell) {
    const { ch, width, fg, bg, attrs } = cell;

    // 文本：width===0 是宽字符第二列的占位 spacer。宽字符本身在 monospace 下已占 2 列，
    // 若 spacer 再画一个空格（1 列）会让其后每一列右移 1 格，故渲成空串（0 列）。
    span.textContent = width === 0 ? '' : ch;

    const style = span.style;

    // 空白格：ch===' ' 且无属性且 fg/bg 是默认哨兵 → 单空格、不设背景（省 DOM 样式）。
    const isBlank = ch === ' ' && attrs === 0 && fg === DEFAULT_FG && bg === DEFAULT_BG;

    // INVERSE 交换前后景：先算有效颜色再设。
    let effFg = fg;
    let effBg = bg;
    if (attrs & INVERSE) {
      effFg = bg;
      effBg = fg;
    }

    if (isBlank) {
      style.color = '';
      style.backgroundColor = '';
    } else {
      style.color = colorOf(effFg);
      style.backgroundColor = colorOf(effBg);
    }

    // 属性位标志 → 样式。
    style.fontWeight = attrs & BOLD ? 'bold' : '';
    style.opacity = attrs & DIM ? '0.6' : '';
    style.fontStyle = attrs & ITALIC ? 'italic' : '';

    // 下划线 / 删除线可同时存在，拼成一条 text-decoration。
    const deco = [];
    if (attrs & UNDERLINE) deco.push('underline');
    if (attrs & STRIKE) deco.push('line-through');
    style.textDecoration = deco.join(' ');

    // BLINK 忽略（不做动画）。
  }

  function copyCell(cell) {
    return { ch: cell.ch, width: cell.width, fg: cell.fg, bg: cell.bg, attrs: cell.attrs };
  }

  function cellEquals(a, b) {
    return (
      a.ch === b.ch &&
      a.width === b.width &&
      a.fg === b.fg &&
      a.bg === b.bg &&
      a.attrs === b.attrs
    );
  }

  // 重建所有行/格节点（init / resize）。清空 host 后用一个 fragment 一次性 append，减少回流。
  function build() {
    host.textContent = '';
    const frag = document.createDocumentFragment();
    rowsDivs = new Array(h);
    spans = new Array(h);
    state = new Array(h);
    cursorSpan = null;

    for (let r = 0; r < h; r++) {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'row';
      applyRowStyle(rowDiv);

      const rowSpans = new Array(w);
      const rowState = new Array(w).fill(null);
      for (let c = 0; c < w; c++) {
        const span = document.createElement('span');
        span.className = 'cell';
        applyCellBaseStyle(span);
        rowSpans[c] = span;
        rowDiv.appendChild(span);
      }

      rowsDivs[r] = rowDiv;
      spans[r] = rowSpans;
      state[r] = rowState;
      frag.appendChild(rowDiv);
    }
    host.appendChild(frag);
  }

  // 对第 r 行逐格 diff：只有 cell 变化才写 span，否则跳过（retained 的意义所在）。
  function diffRow(r, rowCells) {
    const rowState = state[r];
    const rowSpans = spans[r];
    for (let c = 0; c < w; c++) {
      const cell = rowCells[c];
      const prev = rowState[c];
      if (prev && cellEquals(prev, cell)) continue;
      applyCellStyle(rowSpans[c], cell);
      rowState[c] = copyCell(cell);
    }
  }

  // 更新光标：移除上一个光标 span 的 class / outline，给新位置加上；hidden 或 null 不显示。
  function updateCursor(cursor) {
    if (cursorSpan) {
      cursorSpan.classList.remove('cursor');
      cursorSpan.style.outline = '';
      cursorSpan.style.outlineOffset = '';
      cursorSpan = null;
    }
    if (cursor && !cursor.hidden) {
      const { row, col } = cursor;
      if (row >= 0 && row < h && col >= 0 && col < w) {
        cursorSpan = spans[row][col];
        cursorSpan.classList.add('cursor');
        cursorSpan.style.outline = '1px solid #ffffff';
        cursorSpan.style.outlineOffset = '-1px';
      }
    }
  }

  // 把三个并行数组（rowsDivs / spans / state）在 [top, bottom] 内左旋 k 位。
  function rotateLeft(arr, top, bottom, k) {
    const slice = arr.slice(top, top + k);
    for (let i = top; i <= bottom - k; i++) arr[i] = arr[i + k];
    for (let i = 0; i < k; i++) arr[bottom - k + 1 + i] = slice[i];
  }

  // 把三个并行数组（rowsDivs / spans / state）在 [top, bottom] 内右旋 k 位。
  function rotateRight(arr, top, bottom, k) {
    const slice = arr.slice(bottom - k + 1, bottom + 1);
    for (let i = bottom; i >= top + k; i--) arr[i] = arr[i - k];
    for (let i = 0; i < k; i++) arr[top + i] = slice[i];
  }

  // 全量渲染：逐行 diff（内部对每个 cell 与上次已渲染状态比较，只改变化的节点）。
  function render(grid, cursor) {
    for (let r = 0; r < h; r++) diffRow(r, grid[r]);
    updateCursor(cursor);
  }

  // 纯滚动快路径：物理搬移 retained 行节点 + diff 新滚入的空白行 + 更新光标。
  //
  // dir='up'   = 内容上移（scroll_up，底部补 count 空白行）
  // dir='down' = 内容下移（scroll_down，顶部补 count 空白行）
  // [top, bottom] 是滚动边距（含端点），count 是滚的行数。grid 已经是滚动后的状态。
  function blitScroll(dir, top, bottom, count, grid, cursor) {
    const regionLen = bottom - top + 1;

    // 滚动量 >= 区域高度：区域内容整体滚出、只剩空白行。节点顺序不变，直接 diff 区域。
    if (count >= regionLen) {
      for (let r = top; r <= bottom; r++) diffRow(r, grid[r]);
      updateCursor(cursor);
      return;
    }

    const k = count;
    if (dir === 'up') {
      // 内容上移：区域头 k 行滚出屏幕，搬到区域尾成为新滚入的空白行。
      const anchor = bottom + 1 < h ? rowsDivs[bottom + 1] : null;
      const moved = rowsDivs.slice(top, top + k);
      for (const div of moved) host.insertBefore(div, anchor);
      rotateLeft(rowsDivs, top, bottom, k);
      rotateLeft(spans, top, bottom, k);
      rotateLeft(state, top, bottom, k);
    } else {
      // 内容下移：区域尾 k 行滚出屏幕，搬到区域头成为新滚入的空白行。
      const topAnchor = rowsDivs[top];
      const moved = rowsDivs.slice(bottom - k + 1, bottom + 1);
      for (const div of moved) host.insertBefore(div, topAnchor);
      rotateRight(rowsDivs, top, bottom, k);
      rotateRight(spans, top, bottom, k);
      rotateRight(state, top, bottom, k);
    }

    // diff 整个区域：搬移后的行 state 已与 grid 对齐（cellEquals 跳过、零重写），
    // 只有新滚入的空白行有差异会被重写。
    for (let r = top; r <= bottom; r++) diffRow(r, grid[r]);
    updateCursor(cursor);
  }

  // 几何变化：重建所有行/格节点。render() 随后会用 diff 把非空格重新画回来。
  function resize(c, r) {
    w = c;
    h = r;
    build();
  }

  build();

  return { render, blitScroll, resize };
}
