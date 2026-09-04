//! vttest 向量：SPEC 第 6 节决策「黄金快照 + vttest」的 vttest 那半。
//!
//! 覆盖 issue #4 点名的四类序列：`?2004` bracketed paste、DECSTBM + SU/SD、
//! ICH/DCH/IL/DL 编辑序列、宽字符行尾边界。外加 `?7` DECAWM 的开关行为。
//! 写法同 `golden.rs`：喂字节 → 断言网格状态（必要时断言 Change）。

use decode_core::{Change, Terminal};

/// 把可见屏渲染成多行字符串。
fn snap(t: &Terminal) -> String {
    t.screen_lines().join("\n")
}

// ---- ?7 DECAWM（自动换行）----

#[test]
fn autowrap_on_wraps_at_line_end() {
    // 默认 autowrap 开：写满一行（光标停在最后一列）后，下一字符换行。
    let mut t = Terminal::new(5, 2);
    t.feed(b"abcde");
    t.feed(b"X");
    assert_eq!(snap(&t), "abcde\nX    ");
}

#[test]
fn autowrap_off_overwrites_last_cell() {
    // ?7l 关 autowrap：行尾不换行，直接覆盖最后一格。
    let mut t = Terminal::new(5, 2);
    t.feed(b"\x1b[?7l");
    t.feed(b"abcde");
    t.feed(b"X");
    assert_eq!(snap(&t), "abcdX\n     ");
}

#[test]
fn autowrap_off_wide_char_truncates() {
    // 关 autowrap 时宽字符在最后一列放不下：截断为单宽，覆盖最后一格。
    let mut t = Terminal::new(5, 2);
    t.feed(b"\x1b[?7l");
    t.feed(b"abcd"); // 光标到最后一列（col 4）
    let changes = t.feed("你".as_bytes());
    assert_eq!(snap(&t), "abcd你\n     ");
    // 断言该格 width 被截断为 1（无 spacer，宽字符单格呈现）
    let cell_change = changes
        .iter()
        .find(|c| matches!(c, Change::Cell { .. }))
        .expect("expected a Cell change for the truncated wide char");
    if let Change::Cell { row, col, cell } = cell_change {
        assert_eq!((*row, *col), (0, 4));
        assert_eq!(cell.ch, '你');
        assert_eq!(cell.width, 1);
    }
}

#[test]
fn autowrap_reenable_wraps_again() {
    // 关 → 开：wrap_pending 在关闭期间仍被记录，重开后下一字符换行。
    let mut t = Terminal::new(5, 2);
    t.feed(b"\x1b[?7l");
    t.feed(b"abcde");
    t.feed(b"X"); // 关：覆盖最后一格
    assert_eq!(snap(&t), "abcdX\n     ");
    t.feed(b"\x1b[?7h");
    t.feed(b"Y"); // 开：挂起的换行生效
    assert_eq!(snap(&t), "abcdX\nY    ");
}

#[test]
fn ris_resets_autowrap() {
    // ?7l 关 autowrap → RIS（ESC c）软复位把 autowrap 重新置回开。
    let mut t = Terminal::new(5, 2);
    t.feed(b"\x1b[?7l");
    t.feed(b"\x1bc"); // RIS：清屏 + autowrap=true + 光标回 (0,0)
    t.feed(b"abcde");
    t.feed(b"X"); // 复位后 autowrap 开：X 换行到下一行
    assert_eq!(snap(&t), "abcde\nX    ");
}

#[test]
fn autowrap_persists_across_alt_screen() {
    // DECAWM 是全局模式：?1049 进 alt screen 不清除 autowrap 状态。
    let mut t = Terminal::new(5, 2);
    t.feed(b"\x1b[?7l");
    t.feed(b"\x1b[?1049h"); // 进 alt screen（enter_alt 不碰 autowrap）
    t.feed(b"abcde");
    t.feed(b"X"); // autowrap 仍关：X 覆盖最后一格，不换行
    assert_eq!(snap(&t), "abcdX\n     ");
}

#[test]
fn resize_clears_pending_wrap() {
    // 写满最后列后放大宽度：resize 必须清掉挂起的自动换行，否则下一字符会
    // 错误地换到下一行。简单 resize 不回流（v2），光标仍钳在 col 4，X 覆盖 'e'。
    let mut t = Terminal::new(5, 2);
    t.feed(b"abcde"); // wrap_pending=true，光标停在 col 4
    t.resize(10, 2);
    t.feed(b"X"); // 应留在第 0 行，而不是换到第 1 行
    assert_eq!(snap(&t), "abcdX     \n          ");
}

// ---- 宽字符行尾边界（issue #4：width 2 放不下 → 换行）----

#[test]
fn wide_char_at_line_end_wraps() {
    // autowrap 开：宽字符在最后一列放不下 → 换行到下一行。
    let mut t = Terminal::new(5, 2);
    t.feed(b"abcd"); // 光标到最后一列（col 4）
    t.feed("你".as_bytes());
    assert_eq!(snap(&t), "abcd \n你    ");
}

#[test]
fn wide_char_at_last_col_no_pending_wraps() {
    // 覆盖 `input()` 里 width==2 且无挂起换行的分支：光标经 CHA 直接停在最后一列
    // （wrap_pending 已被 goto_col 清除），宽字符仍要换行，不能只覆盖最后一格。
    let mut t = Terminal::new(5, 2);
    t.feed(b"\x1b[5G"); // CHA：光标到 col 5（1-based）→ 0-based col 4
    t.feed("你".as_bytes());
    assert_eq!(snap(&t), "     \n你    ");
}

// ---- ?2004 bracketed paste（vim 默认开启，v1 只接受不实现）----

#[test]
fn bracketed_paste_mode_accepted() {
    // vim 启动会 ?2004h、退出会 ?2004l。核心不实现 paste 括起来（那是输入侧
    // 的职责），但必须接受这个模式、不 panic、不产生任何格子/滚动副作用。
    let mut t = Terminal::new(10, 2);
    let changes = t.feed(b"\x1b[?2004h\x1b[?2004l");
    // 唯一副作用是 feed 末尾补的那个 Cursor 变更——不能有 Cell/Scroll/Reset。
    assert!(
        changes.iter().all(|c| matches!(c, Change::Cursor { .. })),
        "?2004 应被接受为 no-op，却产生了格子/滚动变更: {changes:?}"
    );
    t.feed(b"hello");
    assert_eq!(snap(&t), "hello     \n          ");
}

// ---- DECSTBM 区域滚动 + SU/SD（S/T）----

#[test]
fn decstbm_su_scrolls_region_up() {
    let mut t = Terminal::new(5, 4);
    // 滚动边距 row2..row3（1-based）→ 0-based 1..=2。
    t.feed(b"\x1b[2;3r");
    // 用 CUP 定位写四行，避开 LF 触发的区域滚动，逐行铺满。
    t.feed(b"\x1b[1;1HAAAA"); // row0（region 外）
    t.feed(b"\x1b[2;1HBBBB"); // row1（region 顶）
    t.feed(b"\x1b[3;1HCCCC"); // row2（region 底）
    t.feed(b"\x1b[4;1HDDDD"); // row3（region 外）
    assert_eq!(snap(&t), "AAAA \nBBBB \nCCCC \nDDDD ");
    // SU：region [1,2] 向上滚 1 行，region 外的 row0 / row3 不动。
    t.feed(b"\x1b[S");
    assert_eq!(snap(&t), "AAAA \nCCCC \n     \nDDDD ");
}

#[test]
fn decstbm_sd_scrolls_region_down() {
    let mut t = Terminal::new(5, 4);
    t.feed(b"\x1b[2;3r");
    t.feed(b"\x1b[1;1HAAAA");
    t.feed(b"\x1b[2;1HBBBB");
    t.feed(b"\x1b[3;1HCCCC");
    t.feed(b"\x1b[4;1HDDDD");
    // SD：region [1,2] 向下滚 1 行，顶部补空行，row0 / row3 不动。
    t.feed(b"\x1b[T");
    assert_eq!(snap(&t), "AAAA \n     \nBBBB \nDDDD ");
}

// ---- ICH @ / DCH P / IL L / DL M 编辑序列 ----

#[test]
fn ich_inserts_blank_chars() {
    let mut t = Terminal::new(8, 2);
    t.feed(b"hello");
    t.feed(b"\x1b[2G"); // CHA：光标到 col 2（1-based）→ 0-based col 1
    t.feed(b"\x1b[2@"); // ICH 2：在 col 1 插 2 空格，右侧右移
    assert_eq!(snap(&t), "h  ello \n        ");
}

#[test]
fn dch_deletes_chars() {
    let mut t = Terminal::new(8, 2);
    t.feed(b"hello");
    t.feed(b"\r"); // 回 col 0
    t.feed(b"\x1b[2P"); // DCH 2：删 col 0 起 2 字符，右侧左移
    assert_eq!(snap(&t), "llo     \n        ");
}

#[test]
fn il_inserts_blank_lines() {
    let mut t = Terminal::new(5, 3);
    t.feed(b"111\r\n222\r\n333");
    assert_eq!(snap(&t), "111  \n222  \n333  ");
    t.feed(b"\x1b[2;1H"); // CUP：光标 row2 col1 → (1,0)
    t.feed(b"\x1b[L"); // IL 1：在 row1 插空行，region 内下滚（row2 的 333 滚出）
    assert_eq!(snap(&t), "111  \n     \n222  ");
}

#[test]
fn dl_deletes_lines() {
    let mut t = Terminal::new(5, 3);
    t.feed(b"111\r\n222\r\n333");
    t.feed(b"\x1b[1;1H"); // CUP：光标 (0,0)
    t.feed(b"\x1b[M"); // DL 1：删 row0，全屏上滚（111 进 scrollback）
    assert_eq!(snap(&t), "222  \n333  \n     ");
    assert_eq!(t.scrollback_len(), 1);
}
