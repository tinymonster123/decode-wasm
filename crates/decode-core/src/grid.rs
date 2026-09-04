//! 活跃屏：rows × cols 的平网格 + 滚出的行进 scrollback。
//!
//! **纯数据 + 几何操作，不记录 diff**（diff 由 `Screen` 层负责）。这样
//! alt screen 切换（替换整个 Grid）时，已积累的 diff 不会跟着 Grid 一起被换掉。

use std::collections::VecDeque;

use crate::cell::Cell;

pub type Row = Vec<Cell>;

/// 活跃屏。决策 #2：flat（不是 block-list），滚出去的行进 `VecDeque`。
///
/// `row` 0 是 viewport 顶部；`scrollback` 里旧的行在前（index 0 最老）。
#[derive(Debug)]
pub struct Grid {
    pub cols: usize,
    pub rows: usize,
    /// 活跃屏，`cells[r][c]`。
    pub cells: Vec<Row>,
    /// 滚出的行（历史）。
    pub scrollback: VecDeque<Row>,
}

impl Grid {
    pub fn new(cols: usize, rows: usize) -> Grid {
        Grid {
            cols,
            rows,
            cells: (0..rows).map(|_| vec![Cell::blank(); cols]).collect(),
            scrollback: VecDeque::new(),
        }
    }

    #[inline]
    pub fn cell(&self, row: usize, col: usize) -> &Cell {
        &self.cells[row][col]
    }

    #[inline]
    pub fn cell_mut(&mut self, row: usize, col: usize) -> &mut Cell {
        &mut self.cells[row][col]
    }

    /// 把 `top..=bottom`（含）向上滚 `count` 行：顶部滚出的行进 scrollback
    /// （仅全屏滚动时），底部补空白行。纯几何。
    pub fn scroll_up(&mut self, top: usize, bottom: usize, count: usize) {
        let count = count.min(bottom - top + 1);
        let full_screen = top == 0 && bottom == self.rows - 1;
        for _ in 0..count {
            let row = self.cells.remove(top);
            self.cells.insert(bottom, vec![Cell::blank(); self.cols]);
            // 只有全屏滚动（滚出 viewport 顶部）才进 scrollback；
            // 区域滚动（DECSTBM 子区间）滚出的行直接丢弃。
            if full_screen {
                self.scrollback.push_back(row);
            }
        }
    }

    /// `top..=bottom` 向下滚 `count` 行：底部滚出丢弃，顶部补空白行。纯几何。
    pub fn scroll_down(&mut self, top: usize, bottom: usize, count: usize) {
        let count = count.min(bottom - top + 1);
        for _ in 0..count {
            self.cells.remove(bottom);
            self.cells.insert(top, vec![Cell::blank(); self.cols]);
        }
    }

    /// 清 `(row, col)` 起 `count` 个格子为 blank。纯几何。
    pub fn clear_range(&mut self, row: usize, col: usize, count: usize) {
        let end = (col + count).min(self.cols);
        for c in col..end {
            self.cells[row][c] = Cell::blank();
        }
    }

    /// 在 `(row, col)` 处插入 `count` 空格，右侧右移、行尾丢弃（ICH 的几何）。
    pub fn shift_row_right(&mut self, row: usize, col: usize, count: usize) {
        let count = count.min(self.cols - col);
        if count == 0 {
            return;
        }
        let row_data = &mut self.cells[row];
        for c in (col + count..self.cols).rev() {
            row_data[c] = row_data[c - count];
        }
        for c in col..col + count {
            row_data[c] = Cell::blank();
        }
    }

    /// 删除 `(row, col)` 起 `count` 个格子，右侧左移、行尾补 blank（DCH 的几何）。
    pub fn shift_row_left(&mut self, row: usize, col: usize, count: usize) {
        let count = count.min(self.cols - col);
        if count == 0 {
            return;
        }
        let row_data = &mut self.cells[row];
        for c in col..self.cols - count {
            row_data[c] = row_data[c + count];
        }
        for c in self.cols - count..self.cols {
            row_data[c] = Cell::blank();
        }
    }

    /// 全部清空（含 scrollback）。用于 RIS / alt 切换。
    pub fn clear_all(&mut self) {
        for row in self.cells.iter_mut() {
            row.fill(Cell::blank());
        }
        self.scrollback.clear();
    }

    /// 尺寸变化。v1 只做截断/补行；回流留 v1.1。
    pub fn resize(&mut self, cols: usize, rows: usize) {
        self.cols = cols;
        self.rows = rows;
        self.cells.truncate(rows);
        for row in self.cells.iter_mut() {
            row.resize(cols, Cell::blank());
        }
        while self.cells.len() < rows {
            self.cells.push(vec![Cell::blank(); cols]);
        }
    }
}
