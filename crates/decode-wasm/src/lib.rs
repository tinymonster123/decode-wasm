//! wasm-bindgen 前端：把 decode-core 的 `Terminal` 导出给 JS。
//!
//! 边界职责：core 完全不知道 WASM/JS（决策 #6），这里做 FFI 适配——把
//! `Box<[Change]>` 编码成紧凑二进制，用 `js_sys::Uint8Array` 零拷贝视图交回 JS（#7 去
//! JSON 化 + 零拷贝）。编码写进 `Core` 复用的缓冲区，既不经 serde_json 字符串、也不做
//! wasm-bindgen 的 `Vec<u8>`→JS 拷贝与每 feed 的 ArrayBuffer 分配。
//!
//! 约定：`feed` 返回的 `Uint8Array` 是线性内存视图，**只在下次 `feed` 前有效**——复用
//! 缓冲区会被下一次 feed 覆盖。JS 消费端（`decode.js`）在同一 tick 内同步读完，满足此约定。

use decode_core::{Change, Terminal};
use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;

/// 一个终端实例，暴露给 JS。
#[wasm_bindgen]
pub struct Core {
    term: Terminal,
    /// 复用的编码缓冲区：`feed` 把二进制写进来、按视图交回，避免每次 feed 重新分配。
    buf: Vec<u8>,
}

#[wasm_bindgen]
impl Core {
    /// 建 `cols × rows` 的空终端。
    #[wasm_bindgen(constructor)]
    pub fn new(cols: u32, rows: u32) -> Core {
        Core {
            term: Terminal::new(cols.min(u16::MAX as u32) as u16, rows.min(u16::MAX as u32) as u16),
            buf: Vec::new(),
        }
    }

    /// 喂一段字节（JS 传 `Uint8Array`），返回本次变更的紧凑二进制（JS 侧是 `Uint8Array`
    /// 零拷贝视图，下次 `feed` 前有效）。
    pub fn feed(&mut self, bytes: &[u8]) -> Uint8Array {
        let changes = self.term.feed(bytes);
        encode_changes_into(&changes, &mut self.buf);
        // SAFETY: 返回的视图指向 `self.buf` 的线性内存，`self.buf` 与实例同生命周期；视图仅在
        // 「下一次 `feed` 前」有效（下次 feed 会 clear + 复用缓冲，可能重分配使旧视图失效），
        // 而 JS 消费端（decode.js）在同一 tick 内同步读完。满足 `view` 的安全契约。
        unsafe { Uint8Array::view(&self.buf) }
    }

    /// 尺寸变化（触发全量重绘）。
    pub fn resize(&mut self, cols: u32, rows: u32) {
        self.term
            .resize(cols.min(u16::MAX as u32) as u16, rows.min(u16::MAX as u32) as u16);
    }

    /// 调试 / demo：可见屏拼成多行字符串。
    pub fn screen_text(&self) -> String {
        self.term.screen_lines().join("\n")
    }

    /// scrollback（历史）行数。
    pub fn scrollback_len(&self) -> u32 {
        self.term.scrollback_len() as u32
    }
}

/// 把一段 `Change` 流编码进 `out`（清空后复用容量），与 `js/src/decode.js` 的 `decodeChanges`
/// 严格对齐。
///
/// 每条 change = 1 字节 tag + 定长载荷，多字节字段全小端（wasm32 宿主即小端）：
///
/// ```text
/// 0 cell        row:u32 col:u16 ch:u32(码点) width:u8 fg:u32 bg:u32 attrs:u16   (22B)
/// 6 cell_run    row:u32 col:u16 count:u16 fg:u32 bg:u32 attrs:u16 + 每格[ch:u32 width:u8]  (19B + 5B×count)
/// 1 scroll_up   top:u16 bottom:u16 count:u16                                    (7B)
/// 2 scroll_down top:u16 bottom:u16 count:u16                                    (7B)
/// 3 clear       row:u32 col:u16 count:u16                                       (9B)
/// 4 cursor      row:u32 col:u16 hidden:u8                                       (8B)
/// 5 reset                                                                        (1B)
/// ```
///
/// tag 0 与 tag 6 都表示格子：连续的 cell 若同 row、col 逐列连续、且 fg/bg/attrs 相同，
/// 合并成一个 `cell_run`（共享样式只存一次，把 13× 膨胀压下去，见 #7 吞吐诊断）；单格
/// 仍走 tag 0（22B 比 run 的 19+5 更省）。run 用「单遍 + count 回填」：每条 cell 只
/// match 一次（既写格、又判断是否续 run），避免「先扫描一遍再写一遍」的两次 match——
/// 诊断显示编码开销由每条的 enum match 主导，非字节量（UTF-8 压字节反而更慢，见 #7）。
/// 合并只动 FFI 编码，不改 decode-core 的 diff。
///
/// tag 用显式 u8 而非 enum discriminant（后者在 Rust 里是 usize，随平台位宽变），
/// 保证二进制与解码端在任何宿主下字节一致。
fn encode_changes_into(changes: &[Change], out: &mut Vec<u8>) {
    out.clear();
    let mut i = 0;
    while i < changes.len() {
        match &changes[i] {
            Change::Cell { row, col, cell } => {
                let row = *row;
                let col = *col;
                let ch = cell.ch;
                let width = cell.width;
                let fg = cell.fg;
                let bg = cell.bg;
                let attrs = cell.attrs;
                // 下一格是否续 run？只对首格多看一次，决定 tag 0（单格）还是 tag 6（run）。
                let cont = i + 1 < changes.len()
                    && matches!(
                        &changes[i + 1],
                        Change::Cell { row: r, col: c, cell: cc }
                            if *r == row && *c as u32 == col as u32 + 1
                                && cc.fg == fg && cc.bg == bg && cc.attrs == attrs
                    );
                if !cont {
                    // 单格：tag 0。
                    out.push(0);
                    out.extend_from_slice(&row.to_le_bytes());
                    out.extend_from_slice(&col.to_le_bytes());
                    out.extend_from_slice(&(ch as u32).to_le_bytes());
                    out.push(width);
                    out.extend_from_slice(&fg.to_le_bytes());
                    out.extend_from_slice(&bg.to_le_bytes());
                    out.extend_from_slice(&attrs.to_le_bytes());
                    i += 1;
                } else {
                    // run：tag 6，单遍——一次 match 既写当前格、又判断下一格是否续 run；
                    // count 先占位、写完回填（避免「先扫描一遍再写一遍」的两次 match）。
                    out.push(6);
                    out.extend_from_slice(&row.to_le_bytes());
                    out.extend_from_slice(&col.to_le_bytes());
                    let count_pos = out.len();
                    out.extend_from_slice(&0u16.to_le_bytes());
                    out.extend_from_slice(&fg.to_le_bytes());
                    out.extend_from_slice(&bg.to_le_bytes());
                    out.extend_from_slice(&attrs.to_le_bytes());
                    let mut count: u16 = 0;
                    let mut expect = col as u32;
                    while i < changes.len() {
                        match &changes[i] {
                            Change::Cell { row: r, col: c, cell: cc }
                                if *r == row && *c as u32 == expect
                                    && cc.fg == fg && cc.bg == bg && cc.attrs == attrs =>
                            {
                                out.extend_from_slice(&(cc.ch as u32).to_le_bytes());
                                out.push(cc.width);
                                count += 1;
                                expect += 1;
                                i += 1;
                            }
                            _ => break,
                        }
                    }
                    out[count_pos..count_pos + 2].copy_from_slice(&count.to_le_bytes());
                }
            }
            Change::ScrollUp { top, bottom, count } => {
                out.push(1);
                out.extend_from_slice(&top.to_le_bytes());
                out.extend_from_slice(&bottom.to_le_bytes());
                out.extend_from_slice(&count.to_le_bytes());
                i += 1;
            }
            Change::ScrollDown { top, bottom, count } => {
                out.push(2);
                out.extend_from_slice(&top.to_le_bytes());
                out.extend_from_slice(&bottom.to_le_bytes());
                out.extend_from_slice(&count.to_le_bytes());
                i += 1;
            }
            Change::Clear { row, col, count } => {
                out.push(3);
                out.extend_from_slice(&row.to_le_bytes());
                out.extend_from_slice(&col.to_le_bytes());
                out.extend_from_slice(&count.to_le_bytes());
                i += 1;
            }
            Change::Cursor { row, col, hidden } => {
                out.push(4);
                out.extend_from_slice(&row.to_le_bytes());
                out.extend_from_slice(&col.to_le_bytes());
                out.push(*hidden as u8);
                i += 1;
            }
            Change::Reset => {
                out.push(5);
                i += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use decode_core::Cell;

    #[test]
    fn encode_cell_and_reset() {
        let cell = Cell { ch: '中', width: 2, fg: 1, bg: 2, attrs: 3 };
        let changes = [
            Change::Cell { row: 0, col: 1, cell },
            Change::Reset,
        ];
        let mut out = Vec::new();
        encode_changes_into(&changes, &mut out);
        assert_eq!(out.len(), 23);
        assert_eq!(out[0], 0); // cell tag
        assert_eq!(&out[1..5], &0u32.to_le_bytes()); // row
        assert_eq!(&out[5..7], &1u16.to_le_bytes()); // col
        assert_eq!(&out[7..11], &('中' as u32).to_le_bytes()); // ch 码点
        assert_eq!(out[11], 2); // width
        assert_eq!(&out[12..16], &1u32.to_le_bytes()); // fg
        assert_eq!(&out[16..20], &2u32.to_le_bytes()); // bg
        assert_eq!(&out[20..22], &3u16.to_le_bytes()); // attrs
        assert_eq!(out[22], 5); // reset tag
    }

    #[test]
    fn encode_reuses_capacity() {
        let cell = Cell { ch: 'a', width: 1, fg: 0, bg: 0, attrs: 0 };
        let mut out = Vec::with_capacity(128);
        encode_changes_into(&[Change::Reset], &mut out);
        let cap = out.capacity();
        encode_changes_into(&[Change::Cell { row: 0, col: 0, cell }], &mut out);
        assert_eq!(out.capacity(), cap, "复用缓冲区不应重分配");
        assert_eq!(out.len(), 22);
    }

    #[test]
    fn encode_coalesces_same_style_run() {
        // 同 row、col 逐列连续、同样式 → 合并成 tag 6，19B 头 + 3×5B 每格 = 34B。
        let mk = |ch, width| Cell { ch, width, fg: 1, bg: 2, attrs: 3 };
        let changes = [
            Change::Cell { row: 2, col: 5, cell: mk('a', 1) },
            Change::Cell { row: 2, col: 6, cell: mk('中', 2) },
            Change::Cell { row: 2, col: 7, cell: mk('b', 1) },
        ];
        let mut out = Vec::new();
        encode_changes_into(&changes, &mut out);
        assert_eq!(out.len(), 34);
        assert_eq!(out[0], 6); // cell_run tag
        assert_eq!(&out[1..5], &2u32.to_le_bytes()); // row
        assert_eq!(&out[5..7], &5u16.to_le_bytes()); // col
        assert_eq!(&out[7..9], &3u16.to_le_bytes()); // count
        assert_eq!(&out[9..13], &1u32.to_le_bytes()); // fg
        assert_eq!(&out[13..17], &2u32.to_le_bytes()); // bg
        assert_eq!(&out[17..19], &3u16.to_le_bytes()); // attrs
        // 格 0: ch 'a' width 1
        assert_eq!(&out[19..23], &('a' as u32).to_le_bytes());
        assert_eq!(out[23], 1);
        // 格 1: ch '中' width 2
        assert_eq!(&out[24..28], &('中' as u32).to_le_bytes());
        assert_eq!(out[28], 2);
        // 格 2: ch 'b' width 1
        assert_eq!(&out[29..33], &('b' as u32).to_le_bytes());
        assert_eq!(out[33], 1);
    }

    #[test]
    fn encode_splits_run_on_style_or_gap() {
        // 样式不同或 col 不连续 → 拆成多个单格 tag 0（各 22B），不跨 run 合并。
        let a = Cell { ch: 'a', width: 1, fg: 1, bg: 2, attrs: 0 };
        let b = Cell { ch: 'b', width: 1, fg: 9, bg: 2, attrs: 0 }; // fg 不同
        let changes = [
            Change::Cell { row: 0, col: 0, cell: a },
            Change::Cell { row: 0, col: 1, cell: b }, // 样式断
            Change::Cell { row: 0, col: 3, cell: a }, // col 3 不连续（跳过 2）
        ];
        let mut out = Vec::new();
        encode_changes_into(&changes, &mut out);
        // 三个单格：22B × 3。
        assert_eq!(out.len(), 66);
        assert_eq!(out[0], 0);
        assert_eq!(out[22], 0);
        assert_eq!(out[44], 0);
    }
}
