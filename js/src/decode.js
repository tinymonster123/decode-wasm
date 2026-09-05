// FFI 二进制解码器：把 `Core.feed()` 返回的紧凑 `Uint8Array` 解码成与旧 JSON 同形的
// change 对象数组（#7 去 JSON 化）。输出对象形状与 grid.js 的 `applyChanges` 对齐，
// 所以网格/渲染/session 的编排逻辑一行不改。
//
// 二进制格式（与 crates/decode-wasm/src/lib.rs 的 `encode_changes` 严格对齐，小端）：
//   每条 change = 1 字节 tag + 定长载荷：
//     0 cell        row:u32 col:u16 ch:u32(码点) width:u8 fg:u32 bg:u32 attrs:u16   (22B)
//     1 scroll_up   top:u16 bottom:u16 count:u16                                    (7B)
//     2 scroll_down top:u16 bottom:u16 count:u16                                    (7B)
//     3 clear       row:u32 col:u16 count:u16                                       (9B)
//     4 cursor      row:u32 col:u16 hidden:u8                                       (8B)
//     5 reset                                                                        (1B)
//
// 用 DataView 按 byteOffset/byteLength 读，兼容 `Uint8Array` 子视图（wasm-bindgen 返回
// 或调用方 subarray 切出来的）。

export function decodeChanges(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  let i = 0;
  while (i < bytes.byteLength) {
    const tag = view.getUint8(i);
    i += 1;
    switch (tag) {
      case 0: {
        // cell
        const row = view.getUint32(i, true); i += 4;
        const col = view.getUint16(i, true); i += 2;
        const ch = String.fromCodePoint(view.getUint32(i, true)); i += 4;
        const width = view.getUint8(i); i += 1;
        const fg = view.getUint32(i, true); i += 4;
        const bg = view.getUint32(i, true); i += 4;
        const attrs = view.getUint16(i, true); i += 2;
        out.push({ t: 'cell', row, col, ch, width, fg, bg, attrs });
        break;
      }
      case 1:
      case 2: {
        // scroll_up / scroll_down
        const top = view.getUint16(i, true); i += 2;
        const bottom = view.getUint16(i, true); i += 2;
        const count = view.getUint16(i, true); i += 2;
        out.push({ t: tag === 1 ? 'scroll_up' : 'scroll_down', top, bottom, count });
        break;
      }
      case 3: {
        // clear
        const row = view.getUint32(i, true); i += 4;
        const col = view.getUint16(i, true); i += 2;
        const count = view.getUint16(i, true); i += 2;
        out.push({ t: 'clear', row, col, count });
        break;
      }
      case 4: {
        // cursor
        const row = view.getUint32(i, true); i += 4;
        const col = view.getUint16(i, true); i += 2;
        const hidden = view.getUint8(i) !== 0; i += 1;
        out.push({ t: 'cursor', row, col, hidden });
        break;
      }
      case 5:
        out.push({ t: 'reset' });
        break;
      default:
        throw new Error(`未知 change tag: ${tag}（偏移 ${i - 1}）——decode.js 与 lib.rs 版本不一致？`);
    }
  }
  return out;
}
