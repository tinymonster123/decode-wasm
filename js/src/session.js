// 端口消费者侧的共享驱动器：feed → applyChanges → 判定（blit vs 全量）→ 调 adapter。
//
// 这是「核心 ↔ 渲染器」之间唯一的一份编排逻辑，浏览器 demo（main.js）和
// Node（smoke.mjs / bench.mjs）共用，保证三个 sink 消费的是同一份网格、同一套
// blit 判定——这就是「?renderer=canvas|dom|text 输出一致」的结构性前提。
//
// 它不引入 scene/几何层（决策 #16）：只持有 grid.js 的权威网格 + 光标，
// 直接把它喂给 adapter。

import { newGrid, applyChanges } from './grid.js';
import { decodeChanges } from './decode.js';

/**
 * @param {{
 *   core: any,                 // decode-wasm 的 Core（feed(Uint8Array) -> JSON string）
 *   cols: number, rows: number,
 *   renderer: object,          // Renderer 接口（render / blitScroll / resize?）
 *   onFrame?: (changes: any[], cursor: any) => void,
 * }} opts
 */
export function createSession({ core, cols, rows, renderer, onFrame }) {
  let grid = newGrid(cols, rows);
  let cursor = null;

  /**
   * 喂一段字节：core 解析 → 应用 change 流 → 判定滚动快路径还是全量重绘。
   * 返回本次解析出的 change 数组（供采样统计 change 数/字节数）。
   */
  function feed(bytes) {
    const changes = decodeChanges(core.feed(bytes));
    cursor = applyChanges(grid, cols, rows, changes);

    const scrolls = changes.filter((c) => c.t === 'scroll_up' || c.t === 'scroll_down');
    const hasContent = changes.some((c) => c.t === 'cell' || c.t === 'clear' || c.t === 'reset');
    if (scrolls.length === 1 && !hasContent) {
      // 纯滚动帧：走 blit 快路径，不逐格重画。
      // 注意：一次 feed 可能含多条 scroll（如一次喂入多个裸换行，core 每个 LF 各推一条
      // ScrollUp）。那种情况 blit 搬移量 ≠ 网格总滚动量，canvas 会永久错位，必须回退全量 render。
      const s = scrolls[0];
      renderer.blitScroll(
        s.t === 'scroll_up' ? 'up' : 'down',
        s.top, s.bottom, s.count, grid, cursor
      );
    } else {
      renderer.render(grid, cursor);
    }

    if (onFrame) onFrame(changes, cursor);
    return changes;
  }

  /**
   * 几何变化：core.resize 会把 reset + 全量重绘推入内部 changes 队列，
   * feed 一段空字节把它带出来应用（只走公开 API，不动 Rust 核心）。
   */
  function resize(c, r) {
    cols = c;
    rows = r;
    grid = newGrid(c, r);
    core.resize(c, r);
    const changes = decodeChanges(core.feed(new Uint8Array(0)));
    cursor = applyChanges(grid, cols, rows, changes);
    if (renderer.resize) renderer.resize(c, r);
    renderer.render(grid, cursor);
  }

  return {
    feed,
    resize,
    get grid() {
      return grid;
    },
    get cursor() {
      return cursor;
    },
  };
}
