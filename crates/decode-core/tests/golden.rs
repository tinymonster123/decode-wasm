//! 黄金快照测试：喂一段字节 → 断言网格状态 / Change 序列。
//!
//! 这是 SPEC 第 8 节的「黄金快照 + vttest 子集」的黄金部分。

use decode_core::{Change, Terminal};

/// 把可见屏渲染成多行字符串（golden snapshot 惯用写法）。
fn snap(t: &Terminal) -> String {
    t.screen_lines().join("\n")
}

#[test]
fn print_basic() {
    let mut t = Terminal::new(10, 3);
    t.feed(b"Hello");
    assert_eq!(snap(&t), "Hello     \n          \n          ");
}

#[test]
fn crlf_moves_to_next_line() {
    let mut t = Terminal::new(10, 3);
    t.feed(b"AB\r\nCD");
    assert_eq!(snap(&t), "AB        \nCD        \n          ");
}

#[test]
fn cup_positions_cursor() {
    let mut t = Terminal::new(10, 3);
    // CUP row2 col3（1-based）→ (1,2) 0-based
    t.feed(b"\x1b[2;3HX");
    assert_eq!(snap(&t), "          \n  X       \n          ");
}

#[test]
fn sgr_red_foreground() {
    let mut t = Terminal::new(5, 2);
    let changes = t.feed(b"\x1b[31mX");
    match &changes[0] {
        Change::Cell { row, col, cell } => {
            assert_eq!((*row, *col), (0, 0));
            assert_eq!(cell.ch, 'X');
            assert_eq!(cell.fg, 1); // NamedColor::Red
            assert_eq!(cell.bg, decode_core::cell::DEFAULT_BG);
        }
        other => panic!("expected Cell change, got {other:?}"),
    }
    // 最后一个 change 是 Cursor
    assert!(matches!(changes.last(), Some(Change::Cursor { .. })));
}

#[test]
fn clear_screen() {
    let mut t = Terminal::new(5, 2);
    t.feed(b"hello");
    t.feed(b"\x1b[2J"); // ED all
    assert_eq!(snap(&t), "     \n     ");
}

#[test]
fn clear_line_right() {
    let mut t = Terminal::new(8, 2);
    t.feed(b"hello");
    t.feed(b"\r\x1b[K"); // CR 到 col0，EL right 清整行
    assert_eq!(snap(&t), "        \n        ");
}

#[test]
fn scroll_full_screen() {
    let mut t = Terminal::new(5, 2);
    t.feed(b"a\r\nb"); // 两行，无多余换行
    assert_eq!(snap(&t), "a    \nb    ");
    assert_eq!(t.scrollback_len(), 0);

    t.feed(b"\r\nc\r\n"); // 换行（滚掉 a）+ c + 换行（滚掉 b）
    assert_eq!(snap(&t), "c    \n     ");
    assert_eq!(t.scrollback_len(), 2);
}

#[test]
fn alt_screen_swap() {
    let mut t = Terminal::new(5, 3);
    t.feed(b"main");
    t.feed(b"\x1b[?1049h"); // 进 alt
    t.feed(b"alt");
    assert_eq!(snap(&t), "alt  \n     \n     ");
    t.feed(b"\x1b[?1049l"); // 回主屏
    assert_eq!(snap(&t), "main \n     \n     ");
}

#[test]
fn wide_char() {
    let mut t = Terminal::new(5, 2);
    let changes = t.feed("你".as_bytes());
    match &changes[0] {
        Change::Cell { row, col, cell } => {
            assert_eq!((*row, *col), (0, 0));
            assert_eq!(cell.ch, '你');
            assert_eq!(cell.width, 2);
        }
        other => panic!("expected wide Cell, got {other:?}"),
    }
    // 第二列是 spacer（width 0）
    match &changes[1] {
        Change::Cell { row, col, cell } => {
            assert_eq!((*row, *col), (0, 1));
            assert_eq!(cell.width, 0);
        }
        other => panic!("expected spacer, got {other:?}"),
    }
}

#[test]
fn scroll_region_decstbm() {
    let mut t = Terminal::new(5, 4);
    // 滚动边距 row2..row3（1-based）→ 0-based 1..=2。row0 不滚。
    t.feed(b"\x1b[2;3r");
    t.feed(b"a\r\nb\r\nc\r\nd\r\n");
    // 结果：row0 固定，region [1,2] 内滚动
    let snap = snap(&t);
    // 直接断言：region 之外的行不该进 scrollback（区域滚动不存历史）
    assert_eq!(t.scrollback_len(), 0);
    // 首行（row0）在 region 外，写 'a' 后不再动
    assert!(snap.starts_with("a    "), "snap = {snap:?}");
}
