//! 一个格子的完整状态：字形 + 样式 + 颜色。
//!
//! `Cell` 是 `Copy` 值类型（决策 #11：单码点 + width）。颜色存的是
//! **调色板索引**（决策 #7），RGB 归一化交给 JS 渲染器。

/// SGR 样式位标志。
pub mod attr {
    pub const BOLD: u16 = 1 << 0;
    pub const DIM: u16 = 1 << 1;
    pub const ITALIC: u16 = 1 << 2;
    pub const UNDERLINE: u16 = 1 << 3;
    pub const BLINK: u16 = 1 << 4;
    pub const INVERSE: u16 = 1 << 5;
    pub const STRIKE: u16 = 1 << 6;
}

/// 默认前景 / 默认背景的哨兵索引（在 256 色表之外）。
pub const DEFAULT_FG: u32 = 256;
pub const DEFAULT_BG: u32 = 257;

/// truecolor 标记位：置位时低 24 位是 RGB。
pub const TRUECOLOR_FLAG: u32 = 0x0100_0000;

#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Cell {
    /// 码点（grapheme 簇留到 v2）。
    pub ch: char,
    /// 显示宽度：1 或 2（CJK 等宽字符）。
    pub width: u8,
    /// 前景色：调色板索引 `0..=255`，或 `DEFAULT_FG`，或 `TRUECOLOR_FLAG | rgb`。
    pub fg: u32,
    /// 背景色：同上。
    pub bg: u32,
    /// 样式位标志（`attr::*`）。
    pub attrs: u16,
}

impl Cell {
    /// 空白格子（空格 + 默认样式）。
    pub fn blank() -> Cell {
        Cell {
            ch: ' ',
            width: 1,
            fg: DEFAULT_FG,
            bg: DEFAULT_BG,
            attrs: 0,
        }
    }

    /// 宽字符占两列时，第二列的占位标记（`width == 0`，渲染器跳过）。
    pub fn spacer() -> Cell {
        Cell {
            ch: '\0',
            width: 0,
            fg: DEFAULT_FG,
            bg: DEFAULT_BG,
            attrs: 0,
        }
    }
}
