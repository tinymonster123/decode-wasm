// 文本 renderer（SPEC §10）：把 apply.js 的网格渲成 ANSI 字符串。
//
// 与 canvas/dom 不同，这个 adapter 不画任何东西——只做纯计算，输出一段带
// ANSI SGR 转义序列的文本，浏览器和 Node 都能用（无 DOM / canvas 依赖）。
// 三个用途：
//   - 断言：stripAnsi(render(grid)) 严格等于 apply.js 的 gridText(grid, cols, rows)，
//     让 change 流 → 网格 → 文本这条链在 Node smoke 里可逐字比对。
//   - 导出：把终端当前屏面 dump 成带颜色的文本（日志 / 快照）。
//   - SSH：远端客户端的粗粒度后备（颜色交给客户端的终端解释）。
//
// 硬约束：颜色直接用 cell 的原始 fg/bg 数值编码，不走 palette.js 的 colorOf
// （那是 CSS 颜色，这里是 ANSI SGR 码）。

const ESC = '\x1b';

// 与 apply.js / palette.js 对齐的哨兵值（颜色编码见 SPEC §4）。
const DEFAULT_FG = 256;       // 默认前景哨兵 → SGR '39'
const DEFAULT_BG = 257;       // 默认背景哨兵 → SGR '49'
const TRUECOLOR_FLAG = 0x01000000; // 高位置位 = truecolor，低 24 位是 RGB

// attrs 位标志 → SGR 码（SPEC §10 映射；位序即输出顺序）。
const ATTR_MAP = [
  [1, '1'],   // BOLD
  [2, '2'],   // DIM
  [4, '3'],   // ITALIC
  [8, '4'],   // UNDERLINE
  [16, '5'],  // BLINK
  [32, '7'],  // INVERSE
  [64, '9'],  // STRIKE
];

/**
 * 单个颜色分量 → SGR 片段。默认哨兵（fg=256 / bg=257）给复位码，
 * 索引色给 `38;5;N` / `48;5;N`，truecolor 给 `38;2;r;g;b` / `48;2;r;g;b`。
 *
 * @param {'fg'|'bg'} kind
 * @param {number} value 原始 fg 或 bg 数值
 * @returns {string}
 */
function colorSeq(kind, value) {
  const isFg = kind === 'fg';
  const def = isFg ? DEFAULT_FG : DEFAULT_BG;
  if (value === def) return isFg ? '39' : '49';
  if (value >= TRUECOLOR_FLAG) {
    const rgb = value & 0xffffff;
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    return `${isFg ? '38' : '48'};2;${r};${g};${b}`;
  }
  return `${isFg ? '38' : '48'};5;${value}`;
}

/**
 * 一个格子的完整 SGR 序列：`\x1b[0;<attrs...>;<fg>;<bg>m`。
 * 开头恒有复位码 `0`，保证上一格样式不会泄漏到本格；即使全默认也输出
 * 一份 SGR，保证 `stripAnsi` 有东西可剥、纯文本仍等于 gridText。
 *
 * @param {number} fg
 * @param {number} bg
 * @param {number} attrs
 * @returns {string}
 */
function buildSgr(fg, bg, attrs) {
  const parts = ['0'];
  for (const [bit, code] of ATTR_MAP) {
    if (attrs & bit) parts.push(code);
  }
  parts.push(colorSeq('fg', fg));
  parts.push(colorSeq('bg', bg));
  return `${ESC}[${parts.join(';')}m`;
}

/**
 * 剥掉所有 SGR 序列，得到纯文本。行尾无额外换行（与 gridText 一致）。
 * 断言前提：render 的字符序列 == gridText 的字符序列，只在字符之间插入 SGR，
 * 因此 stripAnsi(render(...)) === gridText(...) 严格成立。
 *
 * @param {string} s
 * @returns {string}
 */
export function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * 文本 renderer factory（factory 在 renderer.js 里按 `text` dispatch 到这里）。
 *
 * @param {number} cols
 * @param {number} rows
 */
export function createTextRenderer(cols, rows) {
  let latest = null;

  return {
    /**
     * 全量重绘：把网格渲成 ANSI 字符串，存为 latest 并返回。cursor 忽略
     * （纯文本不含光标）。字符序列严格按 gridText 规则产出：每格
     * `width === 0 ? ' ' : ch`，行内直接拼，行间换行，无末尾换行。
     * 相邻格子样式相同时复用上一个 SGR（行程编码），减少输出体积。
     *
     * @param {Array<Array<{ch:string,width:number,fg:number,bg:number,attrs:number}>>} grid
     * @param {{row:number,col:number,hidden:boolean}|null} cursor
     * @returns {string}
     */
    render(grid, cursor) {
      let lastSgr = null; // 上一个已输出格子的 SGR，用于行程编码
      const lines = [];
      for (let r = 0; r < rows; r++) {
        let line = '';
        for (let c = 0; c < cols; c++) {
          const cell = grid[r][c];
          const sgr = buildSgr(cell.fg, cell.bg, cell.attrs);
          if (sgr !== lastSgr) {
            line += sgr;
            lastSgr = sgr;
          }
          line += cell.width === 0 ? ' ' : cell.ch;
        }
        lines.push(line);
      }
      latest = lines.join('\n');
      return latest;
    },

    /**
     * 纯滚动快路径：grid 已是滚动后状态，文本 renderer 没有可 blit 的资源，
     * 直接整帧重导出字符串（与 canvas 的 bitblt 语义对齐：结果一致，只是无优化）。
     */
    blitScroll(dir, top, bottom, count, grid, cursor) {
      return this.render(grid, cursor);
    },

    /** 几何变化：更新列/行数。下次 render 按新尺寸输出。 */
    resize(c, r) {
      cols = c;
      rows = r;
    },

    /** 最近一次 render/blitScroll 产出的 ANSI 字符串（从未渲染过为 null）。 */
    latest() {
      return latest;
    },
  };
}
