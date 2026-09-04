//! `feed()` 的输出：类型化的「哪些格子变了」。
//!
//! 变更按发生顺序排列；`Cursor` 放最后（光标盖最上，渲染器据此画光标）。

use crate::cell::Cell;

#[derive(Clone, Debug, PartialEq)]
pub enum Change {
    /// 某个格子变成 `cell`（自带完整字形 + 样式，渲染器无需回溯）。
    Cell { row: u32, col: u16, cell: Cell },
    /// 滚动边距内向上滚 `count` 行（DECSTBM 区域）。
    ScrollUp { top: u16, bottom: u16, count: u16 },
    /// 滚动边距内向下滚 `count` 行。
    ScrollDown { top: u16, bottom: u16, count: u16 },
    /// 从 (row, col) 起清 `count` 个格子为默认。
    Clear { row: u32, col: u16, count: u16 },
    /// 光标位置 / 可见性。
    Cursor { row: u32, col: u16, hidden: bool },
    /// 全量重绘（alt screen 切换、RIS 复位等）。
    Reset,
}
