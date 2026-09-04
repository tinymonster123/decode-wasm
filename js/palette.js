// 颜色编码 → CSS 颜色。decode-core 的 Cell.fg / Cell.bg 编码（见 SPEC 第 4 节）：
//   - 0..=255        256 色调色板索引
//   - 256 / 257      默认前景 / 默认背景哨兵
//   - 0x0100_0000|rgb  truecolor（低 24 位 RGB）

const DEFAULT_FG = 256;
const DEFAULT_BG = 257;
const TRUECOLOR_FLAG = 0x01000000;

const DEFAULT_FG_COLOR = '#c0c0c0'; // 浅灰，亮色主题的默认前景
const DEFAULT_BG_COLOR = '#000000'; // 黑，默认背景

// 标准 xterm 256 色调色板：16 基色 + 6×6×6 色立方 + 24 级灰阶。
const palette256 = (() => {
  const base = [
    '#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
    '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
  ];
  const levels = [0, 95, 135, 175, 215, 255];
  const cube = [];
  for (const r of levels) for (const g of levels) for (const b of levels) {
    cube.push(`rgb(${r},${g},${b})`);
  }
  const gray = [];
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    gray.push(`rgb(${v},${v},${v})`);
  }
  return [...base, ...cube, ...gray];
})();

export function colorOf(idx) {
  if (idx === DEFAULT_FG) return DEFAULT_FG_COLOR;
  if (idx === DEFAULT_BG) return DEFAULT_BG_COLOR;
  if (idx >= TRUECOLOR_FLAG) {
    const rgb = idx & 0xffffff;
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    return `rgb(${r},${g},${b})`;
  }
  return palette256[idx] ?? DEFAULT_FG_COLOR;
}
