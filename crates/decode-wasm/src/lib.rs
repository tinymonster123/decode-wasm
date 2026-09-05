//! wasm-bindgen 前端：把 decode-core 的 `Terminal` 导出给 JS。
//!
//! 边界职责：core 完全不知道 WASM/JS（决策 #6），这里做 FFI 适配——把
//! `Box<[Change]>` 编码成紧凑二进制 `Vec<u8>`，JS 侧用 `Uint8Array` 直读（#7 去 JSON 化）。
//! 不再经过 serde_json 字符串 + wasm-bindgen 的 UTF-8→UTF-16 拷贝，两处开销一并省掉。

use decode_core::{Change, Terminal};
use wasm_bindgen::prelude::*;

/// 一个终端实例，暴露给 JS。
#[wasm_bindgen]
pub struct Core {
    term: Terminal,
}

#[wasm_bindgen]
impl Core {
    /// 建 `cols × rows` 的空终端。
    #[wasm_bindgen(constructor)]
    pub fn new(cols: u32, rows: u32) -> Core {
        Core {
            term: Terminal::new(cols.min(u16::MAX as u32) as u16, rows.min(u16::MAX as u32) as u16),
        }
    }

    /// 喂一段字节（JS 传 `Uint8Array`），返回本次变更的紧凑二进制（JS 侧是 `Uint8Array`）。
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<u8> {
        let changes = self.term.feed(bytes);
        encode_changes(&changes)
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

/// 把一段 `Change` 流编码成紧凑二进制（与 `js/src/decode.js` 的 `decodeChanges` 严格对齐）。
///
/// 每条 change = 1 字节 tag + 定长载荷，多字节字段全小端（wasm32 宿主即小端）：
///
/// ```text
/// 0 cell        row:u32 col:u16 ch:u32(码点) width:u8 fg:u32 bg:u32 attrs:u16   (22B)
/// 1 scroll_up   top:u16 bottom:u16 count:u16                                    (7B)
/// 2 scroll_down top:u16 bottom:u16 count:u16                                    (7B)
/// 3 clear       row:u32 col:u16 count:u16                                       (9B)
/// 4 cursor      row:u32 col:u16 hidden:u8                                       (8B)
/// 5 reset                                                                        (1B)
/// ```
///
/// tag 用显式 u8 而非 enum discriminant（后者在 Rust 里是 usize，随平台位宽变），
/// 保证二进制与解码端在任何宿主下字节一致。
fn encode_changes(changes: &[Change]) -> Vec<u8> {
    let mut out = Vec::new();
    for c in changes {
        match c {
            Change::Cell { row, col, cell } => {
                out.push(0);
                out.extend_from_slice(&row.to_le_bytes());
                out.extend_from_slice(&col.to_le_bytes());
                out.extend_from_slice(&(cell.ch as u32).to_le_bytes());
                out.push(cell.width);
                out.extend_from_slice(&cell.fg.to_le_bytes());
                out.extend_from_slice(&cell.bg.to_le_bytes());
                out.extend_from_slice(&cell.attrs.to_le_bytes());
            }
            Change::ScrollUp { top, bottom, count } => {
                out.push(1);
                out.extend_from_slice(&top.to_le_bytes());
                out.extend_from_slice(&bottom.to_le_bytes());
                out.extend_from_slice(&count.to_le_bytes());
            }
            Change::ScrollDown { top, bottom, count } => {
                out.push(2);
                out.extend_from_slice(&top.to_le_bytes());
                out.extend_from_slice(&bottom.to_le_bytes());
                out.extend_from_slice(&count.to_le_bytes());
            }
            Change::Clear { row, col, count } => {
                out.push(3);
                out.extend_from_slice(&row.to_le_bytes());
                out.extend_from_slice(&col.to_le_bytes());
                out.extend_from_slice(&count.to_le_bytes());
            }
            Change::Cursor { row, col, hidden } => {
                out.push(4);
                out.extend_from_slice(&row.to_le_bytes());
                out.extend_from_slice(&col.to_le_bytes());
                out.push(*hidden as u8);
            }
            Change::Reset => out.push(5),
        }
    }
    out
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
        let bytes = encode_changes(&changes);
        assert_eq!(bytes.len(), 23);
        assert_eq!(bytes[0], 0); // cell tag
        assert_eq!(&bytes[1..5], &0u32.to_le_bytes()); // row
        assert_eq!(&bytes[5..7], &1u16.to_le_bytes()); // col
        assert_eq!(&bytes[7..11], &('中' as u32).to_le_bytes()); // ch 码点
        assert_eq!(bytes[11], 2); // width
        assert_eq!(&bytes[12..16], &1u32.to_le_bytes()); // fg
        assert_eq!(&bytes[16..20], &2u32.to_le_bytes()); // bg
        assert_eq!(&bytes[20..22], &3u16.to_le_bytes()); // attrs
        assert_eq!(bytes[22], 5); // reset tag
    }
}
