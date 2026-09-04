//! wasm-bindgen 前端：把 decode-core 的 `Terminal` 导出给 JS。
//!
//! 边界职责：core 完全不知道 WASM/JS（决策 #6），这里做 FFI 适配——把
//! `Box<[Change]>` 序列化成 JSON 字符串给 JS。demo 先图可读，零拷贝/typed-array
//! 的性能优化后置（和 core 的 v2 零分配一样，交付优先）。

use decode_core::{Change, Terminal};
use serde_json::{json, Value};
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

    /// 喂一段字节（JS 传 `Uint8Array`），返回本次变更的 JSON 数组字符串。
    pub fn feed(&mut self, bytes: &[u8]) -> String {
        let changes = self.term.feed(bytes);
        let arr: Vec<Value> = changes.iter().map(change_to_value).collect();
        serde_json::to_string(&arr).unwrap_or_else(|_| "[]".to_string())
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

/// 把一个 `Change` 转成 JSON 对象。`t` 是判别 tag，demo 靠它分发。
fn change_to_value(c: &Change) -> Value {
    match c {
        Change::Cell { row, col, cell } => json!({
            "t": "cell",
            "row": row,
            "col": col,
            "ch": cell.ch.to_string(),
            "width": cell.width,
            "fg": cell.fg,
            "bg": cell.bg,
            "attrs": cell.attrs,
        }),
        Change::ScrollUp { top, bottom, count } => json!({
            "t": "scroll_up", "top": top, "bottom": bottom, "count": count,
        }),
        Change::ScrollDown { top, bottom, count } => json!({
            "t": "scroll_down", "top": top, "bottom": bottom, "count": count,
        }),
        Change::Clear { row, col, count } => json!({
            "t": "clear", "row": row, "col": col, "count": count,
        }),
        Change::Cursor { row, col, hidden } => json!({
            "t": "cursor", "row": row, "col": col, "hidden": hidden,
        }),
        Change::Reset => json!({ "t": "reset" }),
    }
}
