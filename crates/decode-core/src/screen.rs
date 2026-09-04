//! Screen：持网格 + 光标 + 状态，实现 `vte::ansi::Handler`。
//!
//! vte 把字节流解析成语义回调（`input`/`goto`/`clear_screen`/`terminal_attribute`…），
//! 我们在这里改网格、记录 diff。Parser 的分发表我们完全没手写——这是交付优先的选择。

use unicode_width::UnicodeWidthChar;
use vte::ansi::{
    Attr, ClearMode, Color, Handler, LineClearMode, NamedPrivateMode, PrivateMode, Rgb,
};

use crate::cell::{attr as attrs, Cell, DEFAULT_BG, DEFAULT_FG, TRUECOLOR_FLAG};
use crate::change::Change;
use crate::grid::Grid;

/// 当前 SGR 状态（应用到新写的格子）。
#[derive(Clone, Copy)]
pub struct Sgr {
    pub fg: u32,
    pub bg: u32,
    pub attrs: u16,
}

impl Default for Sgr {
    fn default() -> Sgr {
        Sgr {
            fg: DEFAULT_FG,
            bg: DEFAULT_BG,
            attrs: 0,
        }
    }
}

/// 光标。
#[derive(Clone, Copy)]
pub struct Cursor {
    pub row: usize,
    pub col: usize,
    pub hidden: bool,
}

/// alt screen 期间保存的主屏状态。
struct AltScreen {
    saved_cursor: Cursor,
    saved_sgr: Sgr,
    main_grid: Grid,
    main_scroll: (usize, usize),
}

/// 屏幕。实现 [`Handler`]，是「字节流 → 网格 → diff」的核心。
pub(crate) struct Screen {
    pub cols: usize,
    pub rows: usize,
    pub grid: Grid,
    cursor: Cursor,
    sgr: Sgr,
    scroll_top: usize,
    scroll_bottom: usize,
    saved_cursor: Option<Cursor>,
    wrap_pending: bool,
    alt: Option<AltScreen>,
    changes: Vec<Change>,
}

impl Screen {
    pub fn new(cols: usize, rows: usize) -> Screen {
        Screen {
            cols,
            rows,
            grid: Grid::new(cols, rows),
            cursor: Cursor { row: 0, col: 0, hidden: false },
            sgr: Sgr::default(),
            scroll_top: 0,
            scroll_bottom: rows - 1,
            saved_cursor: None,
            wrap_pending: false,
            alt: None,
            changes: Vec::new(),
        }
    }

    pub fn take_changes(&mut self) -> Vec<Change> {
        std::mem::take(&mut self.changes)
    }

    /// 补最后一个 Cursor 变更（`feed()` 结束时调用，光标盖最上）。
    pub fn push_cursor_change(&mut self) {
        self.changes.push(Change::Cursor {
            row: self.cursor.row as u32,
            col: self.cursor.col as u16,
            hidden: self.cursor.hidden,
        });
    }

    pub fn resize(&mut self, cols: usize, rows: usize) {
        self.cols = cols;
        self.rows = rows;
        self.grid.resize(cols, rows);
        self.cursor.row = self.cursor.row.min(rows - 1);
        self.cursor.col = self.cursor.col.min(cols - 1);
        self.scroll_top = 0;
        self.scroll_bottom = rows - 1;
        self.push_reset();
    }

    /// 把当前可见屏渲染成字符串（供黄金测试 / 调试 / demo 用）。
    pub fn render_lines(&self) -> Vec<String> {
        (0..self.rows)
            .map(|r| {
                (0..self.cols)
                    .map(|c| {
                        let cell = self.grid.cell(r, c);
                        if cell.width == 0 {
                            ' '
                        } else {
                            cell.ch
                        }
                    })
                    .collect()
            })
            .collect()
    }

    // ---- 内部工具 ----

    /// 写一个格子，值没变就不发 diff（去噪）。
    fn write_cell(&mut self, row: usize, col: usize, cell: Cell) {
        if *self.grid.cell(row, col) == cell {
            return;
        }
        *self.grid.cell_mut(row, col) = cell;
        self.changes.push(Change::Cell { row: row as u32, col: col as u16, cell });
    }

    /// 发 `Reset` 并重发所有非空格子（全量重绘）。
    fn push_reset(&mut self) {
        self.changes.push(Change::Reset);
        for r in 0..self.rows {
            for c in 0..self.cols {
                let cell = *self.grid.cell(r, c);
                if cell != Cell::blank() {
                    self.changes.push(Change::Cell { row: r as u32, col: c as u16, cell });
                }
            }
        }
    }

    /// 光标下移一行；到底则滚动区域。不含回车（LF 语义）。
    fn lf_down(&mut self) {
        if self.cursor.row == self.scroll_bottom {
            let (top, bottom) = (self.scroll_top, self.scroll_bottom);
            self.grid.scroll_up(top, bottom, 1);
            self.changes.push(Change::ScrollUp { top: top as u16, bottom: bottom as u16, count: 1 });
        } else {
            self.cursor.row += 1;
        }
    }

    fn enter_alt(&mut self) {
        let main_grid = std::mem::replace(&mut self.grid, Grid::new(self.cols, self.rows));
        self.alt = Some(AltScreen {
            saved_cursor: self.cursor,
            saved_sgr: self.sgr,
            main_grid,
            main_scroll: (self.scroll_top, self.scroll_bottom),
        });
        self.cursor = Cursor { row: 0, col: 0, hidden: self.cursor.hidden };
        self.scroll_top = 0;
        self.scroll_bottom = self.rows - 1;
        self.wrap_pending = false;
        self.push_reset();
    }

    fn exit_alt(&mut self) {
        if let Some(alt) = self.alt.take() {
            self.grid = alt.main_grid;
            self.cursor = alt.saved_cursor;
            self.sgr = alt.saved_sgr;
            self.scroll_top = alt.main_scroll.0;
            self.scroll_bottom = alt.main_scroll.1;
            self.wrap_pending = false;
            self.push_reset();
        }
    }
}

impl Handler for Screen {
    fn input(&mut self, c: char) {
        let width = UnicodeWidthChar::width(c).unwrap_or(0);
        if width == 0 {
            return; // 零宽/组合字符：v1 忽略（grapheme 簇 v2）
        }

        // 自动换行：上一字符写到了行尾
        if self.wrap_pending {
            self.wrap_pending = false;
            self.cursor.col = 0;
            self.lf_down();
        }
        // 宽字符在行尾放不下：先换行
        if width == 2 && self.cursor.col + 1 >= self.cols {
            self.cursor.col = 0;
            self.lf_down();
        }

        let (row, col) = (self.cursor.row, self.cursor.col);
        let cell = Cell {
            ch: c,
            width: width as u8,
            fg: self.sgr.fg,
            bg: self.sgr.bg,
            attrs: self.sgr.attrs,
        };
        self.write_cell(row, col, cell);
        if width == 2 {
            self.write_cell(row, col + 1, Cell::spacer());
        }

        self.cursor.col = (col + width as usize).min(self.cols - 1);
        self.wrap_pending = self.cursor.col + 1 >= self.cols;
    }

    fn goto(&mut self, line: i32, col: usize) {
        self.cursor.row = line.clamp(0, self.rows as i32 - 1) as usize;
        self.cursor.col = col.min(self.cols - 1);
    }

    fn goto_line(&mut self, line: i32) {
        self.cursor.row = line.clamp(0, self.rows as i32 - 1) as usize;
    }

    fn goto_col(&mut self, col: usize) {
        self.cursor.col = col.min(self.cols - 1);
    }

    fn insert_blank(&mut self, count: usize) {
        let (row, col) = (self.cursor.row, self.cursor.col);
        self.grid.shift_row_right(row, col, count);
        for c in col..self.cols {
            let cell = *self.grid.cell(row, c);
            self.changes.push(Change::Cell { row: row as u32, col: c as u16, cell });
        }
    }

    fn delete_chars(&mut self, count: usize) {
        let (row, col) = (self.cursor.row, self.cursor.col);
        self.grid.shift_row_left(row, col, count);
        for c in col..self.cols {
            let cell = *self.grid.cell(row, c);
            self.changes.push(Change::Cell { row: row as u32, col: c as u16, cell });
        }
    }

    fn move_up(&mut self, rows: usize) {
        self.cursor.row = self.cursor.row.saturating_sub(rows);
    }

    fn move_down(&mut self, rows: usize) {
        self.cursor.row = (self.cursor.row + rows).min(self.rows - 1);
    }

    fn move_forward(&mut self, cols: usize) {
        self.cursor.col = (self.cursor.col + cols).min(self.cols - 1);
    }

    fn move_backward(&mut self, cols: usize) {
        self.cursor.col = self.cursor.col.saturating_sub(cols);
    }

    fn move_down_and_cr(&mut self, rows: usize) {
        self.move_down(rows);
        self.cursor.col = 0;
    }

    fn move_up_and_cr(&mut self, rows: usize) {
        self.move_up(rows);
        self.cursor.col = 0;
    }

    fn put_tab(&mut self, count: u16) {
        for _ in 0..count {
            self.cursor.col = ((self.cursor.col / 8) + 1) * 8;
            if self.cursor.col >= self.cols {
                self.cursor.col = self.cols - 1;
                break;
            }
        }
    }

    fn backspace(&mut self) {
        self.cursor.col = self.cursor.col.saturating_sub(1);
    }

    fn carriage_return(&mut self) {
        self.cursor.col = 0;
    }

    fn linefeed(&mut self) {
        self.lf_down();
    }

    fn scroll_up(&mut self, rows: usize) {
        let (top, bottom) = (self.scroll_top, self.scroll_bottom);
        self.grid.scroll_up(top, bottom, rows);
        self.changes.push(Change::ScrollUp {
            top: top as u16,
            bottom: bottom as u16,
            count: rows as u16,
        });
    }

    fn scroll_down(&mut self, rows: usize) {
        let (top, bottom) = (self.scroll_top, self.scroll_bottom);
        self.grid.scroll_down(top, bottom, rows);
        self.changes.push(Change::ScrollDown {
            top: top as u16,
            bottom: bottom as u16,
            count: rows as u16,
        });
    }

    fn insert_blank_lines(&mut self, count: usize) {
        let top = self.cursor.row;
        let bottom = self.scroll_bottom;
        if top <= bottom {
            self.grid.scroll_down(top, bottom, count);
            self.changes.push(Change::ScrollDown {
                top: top as u16,
                bottom: bottom as u16,
                count: count as u16,
            });
        }
    }

    fn delete_lines(&mut self, count: usize) {
        let top = self.cursor.row;
        let bottom = self.scroll_bottom;
        if top <= bottom {
            self.grid.scroll_up(top, bottom, count);
            self.changes.push(Change::ScrollUp {
                top: top as u16,
                bottom: bottom as u16,
                count: count as u16,
            });
        }
    }

    fn erase_chars(&mut self, count: usize) {
        let (row, col) = (self.cursor.row, self.cursor.col);
        let count = count.min(self.cols - col);
        self.grid.clear_range(row, col, count);
        self.changes.push(Change::Clear { row: row as u32, col: col as u16, count: count as u16 });
    }

    fn save_cursor_position(&mut self) {
        self.saved_cursor = Some(self.cursor);
    }

    fn restore_cursor_position(&mut self) {
        if let Some(c) = self.saved_cursor {
            self.cursor = c;
        }
    }

    fn clear_line(&mut self, mode: LineClearMode) {
        let (row, col) = (self.cursor.row, self.cursor.col);
        let (start, count) = match mode {
            LineClearMode::Right => (col, self.cols - col),
            LineClearMode::Left => (0, col + 1),
            LineClearMode::All => (0, self.cols),
        };
        self.grid.clear_range(row, start, count);
        self.changes.push(Change::Clear {
            row: row as u32,
            col: start as u16,
            count: count as u16,
        });
    }

    fn clear_screen(&mut self, mode: ClearMode) {
        match mode {
            ClearMode::Above => {
                for r in 0..self.cursor.row {
                    self.grid.clear_range(r, 0, self.cols);
                    self.changes.push(Change::Clear { row: r as u32, col: 0, count: self.cols as u16 });
                }
                self.grid.clear_range(self.cursor.row, 0, self.cursor.col + 1);
                self.changes.push(Change::Clear {
                    row: self.cursor.row as u32,
                    col: 0,
                    count: (self.cursor.col + 1) as u16,
                });
            }
            ClearMode::Below => {
                self.grid.clear_range(self.cursor.row, self.cursor.col, self.cols - self.cursor.col);
                self.changes.push(Change::Clear {
                    row: self.cursor.row as u32,
                    col: self.cursor.col as u16,
                    count: (self.cols - self.cursor.col) as u16,
                });
                for r in self.cursor.row + 1..self.rows {
                    self.grid.clear_range(r, 0, self.cols);
                    self.changes.push(Change::Clear { row: r as u32, col: 0, count: self.cols as u16 });
                }
            }
            ClearMode::All => {
                for r in 0..self.rows {
                    self.grid.clear_range(r, 0, self.cols);
                    self.changes.push(Change::Clear { row: r as u32, col: 0, count: self.cols as u16 });
                }
            }
            ClearMode::Saved => {
                self.grid.scrollback.clear();
            }
        }
    }

    fn reset_state(&mut self) {
        self.grid.clear_all();
        self.cursor = Cursor { row: 0, col: 0, hidden: false };
        self.sgr = Sgr::default();
        self.scroll_top = 0;
        self.scroll_bottom = self.rows - 1;
        self.saved_cursor = None;
        self.wrap_pending = false;
        self.alt = None;
        self.push_reset();
    }

    fn reverse_index(&mut self) {
        if self.cursor.row == self.scroll_top {
            let (top, bottom) = (self.scroll_top, self.scroll_bottom);
            self.grid.scroll_down(top, bottom, 1);
            self.changes.push(Change::ScrollDown {
                top: top as u16,
                bottom: bottom as u16,
                count: 1,
            });
        } else {
            self.cursor.row = self.cursor.row.saturating_sub(1);
        }
    }

    fn terminal_attribute(&mut self, attr: Attr) {
        match attr {
            Attr::Reset => self.sgr = Sgr::default(),
            Attr::Bold => self.sgr.attrs |= attrs::BOLD,
            Attr::Dim => self.sgr.attrs |= attrs::DIM,
            Attr::Italic => self.sgr.attrs |= attrs::ITALIC,
            Attr::Underline
            | Attr::DoubleUnderline
            | Attr::Undercurl
            | Attr::DottedUnderline
            | Attr::DashedUnderline => self.sgr.attrs |= attrs::UNDERLINE,
            Attr::BlinkSlow | Attr::BlinkFast => self.sgr.attrs |= attrs::BLINK,
            Attr::Reverse => self.sgr.attrs |= attrs::INVERSE,
            Attr::Hidden => {} // v1 忽略隐藏文本
            Attr::Strike => self.sgr.attrs |= attrs::STRIKE,
            Attr::CancelBold => self.sgr.attrs &= !attrs::BOLD,
            Attr::CancelBoldDim => self.sgr.attrs &= !(attrs::BOLD | attrs::DIM),
            Attr::CancelItalic => self.sgr.attrs &= !attrs::ITALIC,
            Attr::CancelUnderline => self.sgr.attrs &= !attrs::UNDERLINE,
            Attr::CancelBlink => self.sgr.attrs &= !attrs::BLINK,
            Attr::CancelReverse => self.sgr.attrs &= !attrs::INVERSE,
            Attr::CancelHidden => {}
            Attr::CancelStrike => self.sgr.attrs &= !attrs::STRIKE,
            Attr::Foreground(c) => self.sgr.fg = color_to_u32(c),
            Attr::Background(c) => self.sgr.bg = color_to_u32(c),
            Attr::UnderlineColor(_) => {} // v1 忽略下划线颜色
        }
    }

    fn set_private_mode(&mut self, mode: PrivateMode) {
        match mode {
            PrivateMode::Named(NamedPrivateMode::ShowCursor) => self.cursor.hidden = false,
            PrivateMode::Named(NamedPrivateMode::SwapScreenAndSetRestoreCursor) => self.enter_alt(),
            _ => {}
        }
    }

    fn unset_private_mode(&mut self, mode: PrivateMode) {
        match mode {
            PrivateMode::Named(NamedPrivateMode::ShowCursor) => self.cursor.hidden = true,
            PrivateMode::Named(NamedPrivateMode::SwapScreenAndSetRestoreCursor) => self.exit_alt(),
            _ => {}
        }
    }

    fn set_scrolling_region(&mut self, top: usize, bottom: Option<usize>) {
        let top = top.saturating_sub(1).min(self.rows - 1);
        let bottom = bottom.unwrap_or(self.rows).saturating_sub(1).min(self.rows - 1);
        self.scroll_top = top;
        self.scroll_bottom = bottom.max(top);
        self.cursor.row = 0;
        self.cursor.col = 0;
    }
}

/// 把 vte 的 `Color` 映射成 Cell 的 u32 颜色编码（调色板索引 / truecolor）。
fn color_to_u32(c: Color) -> u32 {
    match c {
        Color::Named(n) => n as u32,
        Color::Indexed(i) => i as u32,
        Color::Spec(Rgb { r, g, b }) => {
            TRUECOLOR_FLAG | ((r as u32) << 16) | ((g as u32) << 8) | (b as u32)
        }
    }
}
