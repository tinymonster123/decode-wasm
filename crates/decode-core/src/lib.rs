//! decode_wasm 核心：字节流 → 网格 → diff。
//!
//! 完全不知道 Canvas/WebGL/DOM 的存在——纯计算，所以能编译成 WASM。
//!
//! 入口是 [`Terminal`]：`feed()` 吃字节、吐 `Box<[Change]>`。

pub mod cell;
pub mod change;
pub mod grid;
mod screen;

pub use cell::Cell;
pub use change::Change;
pub use grid::Grid;

use screen::Screen;

/// 终端仿真器核心。`vte::ansi::Processor` + [`Screen`]。
pub struct Terminal {
    processor: vte::ansi::Processor,
    screen: Screen,
}

impl Terminal {
    /// 建一个 `cols × rows` 的空终端。
    pub fn new(cols: u16, rows: u16) -> Terminal {
        Terminal {
            processor: vte::ansi::Processor::new(),
            screen: Screen::new(cols as usize, rows as usize),
        }
    }

    /// 喂一段字节，返回这次导致的「格子变更」diff。
    ///
    /// 内部 `Vec<Change>` 收集 → `into_boxed_slice()` 丢掉 capacity 字段
    /// （24B → 16B，Cloudflare 思想）。
    pub fn feed(&mut self, bytes: &[u8]) -> Box<[Change]> {
        self.processor.advance(&mut self.screen, bytes);
        self.screen.push_cursor_change();
        self.screen.take_changes().into_boxed_slice()
    }

    /// 尺寸变化（触发全量重绘）。
    pub fn resize(&mut self, cols: u16, rows: u16) {
        self.screen.resize(cols as usize, rows as usize);
    }

    /// 把当前可见屏渲染成字符串（每行一个 String），供黄金测试 / 调试 / demo 用。
    pub fn screen_lines(&self) -> Vec<String> {
        self.screen.render_lines()
    }

    /// scrollback（历史）里的行数。
    pub fn scrollback_len(&self) -> usize {
        self.screen.grid.scrollback.len()
    }
}
