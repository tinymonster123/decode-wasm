//! decode-core 纯解析吞吐（无 JSON 序列化）——`feed()` 到 `Box<[Change]>` 的墙上限。
//!
//! 这是「#7 桥接去 JSON 化」的量化锚点：`bench:compare` 里 decode-wasm 的 3.8 MB/s 是
//! feed() 在 FFI 边界做 serde_json 序列化后的实况；本例去掉序列化，只测 core 本身的
//! parse + diff 收集，给出「去 JSON 化后理论上限」。与 `bench:compare` 用同一份 vim 启动流。
//!
//! 跑法（在仓库根）：
//!   cargo run --release --example throughput
//!
//! 注意：这是 native（非 WASM）release 构建，代表解析器上限；WASM 目标通常再打 1.5–2× 折。
//! 若 `js/fixtures/vim-start.js` 的字节流有变，需同步重生成下方 `VIM` 字面量。

// 与 js/fixtures/vim-start.js 的 vimStartupBytes() 字节级一致（1247B）。
const VIM: &[u8] = b"\x1b[?1049h\x1b[>4;2m\x1b[?1h\x1b=\x1b[?2004h\x1b[?1004h\x1b[1;15r\x1b[?12h\x1b[?12l\x1b[22;2t\x1b[22;1t\x1b[27m\x1b[23m\x1b[29m\x1b[m\x1b[H\x1b[2J\x1b[?25l\x1b[15;1H\"/tmp/vimcap_target.rs\" 3L, 37B\x1b[2;1H\xe2\x96\xbd\x1b[6n\x1b[2;1H  \x1b[3;1H\x1bPzz\x1b\\\x1b[0%m\x1b[6n\x1b[3;1H           \x1b[1;1H\x1b[>c\x1b[1;1Hfn main() {\x0d\x0a    println!(\"hello\");\x1b[2;23H\x1b[K\x1b[3;1H}\x1b[3;2H\x1b[K\x1b[4;1H\x1b[94m~                                                           \x1b[5;1H~                                                           \x1b[6;1H~                                                           \x1b[7;1H~                                                           \x1b[8;1H~                                                           \x1b[9;1H~                                                           \x1b[10;1H~                                                           \x1b[11;1H~                                                           \x1b[12;1H~                                                           \x1b[13;1H~                                                           \x1b[14;1H~                                                           \x1b[1;1H\x1b[?25h\x1b[?4m\x1b[?25l\x1b[m\x1b[15;50HG\x1b[1;1H\x1b[15;50H \x1b[3;1H\x1b[?25h\x1b[?25l\x1b[15;50Hi\x1b[3;1H\x1b[15;50H \x1b[3;1H\x1b[15;1H\x1b[1m-- INSERT --\x1b[m\x1b[15;13H\x1b[K\x1b[3;1H\x1b[?25h\x1b[?25lx}\x08\x1b[?25h\x1b[15;1H\x1b[K\x1b[3;1H\x1b[?25l\x1b[15;50H^[\x1b[3;1H\x1b[?25h\x1b[?25l\x1b[15;50H  \x1b[3;2H\x08\x1b[?25h";

use std::hint::black_box;
use std::time::Instant;

fn main() {
    let cols = 80u16;
    let rows = 24u16;

    // 吞吐：vim 流放大到 ~8MB，4KB chunk（与 bench:compare 同负载）
    let target = 8usize << 20;
    let n = (target / VIM.len()).max(1);
    let mut payload = Vec::with_capacity(VIM.len() * n);
    for _ in 0..n {
        payload.extend_from_slice(VIM);
    }

    {
        let mut t = decode_core::Terminal::new(cols, rows);
        for c in payload.chunks(4096).take(64) {
            black_box(t.feed(c));
        }
    }

    let mut mbps: Vec<f64> = Vec::with_capacity(3);
    for _ in 0..3 {
        let mut t = decode_core::Terminal::new(cols, rows);
        let t0 = Instant::now();
        for c in payload.chunks(4096) {
            black_box(t.feed(c));
        }
        mbps.push(payload.len() as f64 / 1e6 / t0.elapsed().as_secs_f64());
    }
    mbps.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!(
        "rust-core throughput MB/s median={:.2} min={:.2} max={:.2} bytes={}",
        mbps[1], mbps[0], mbps[2], payload.len()
    );

    // 滚动：2000 行 'x'*cols + CRLF
    let mut line = vec![b'x'; cols as usize + 2];
    line[cols as usize] = b'\r';
    line[cols as usize + 1] = b'\n';
    let lines = 2000usize;
    {
        let mut t = decode_core::Terminal::new(cols, rows);
        let t0 = Instant::now();
        for _ in 0..lines {
            black_box(t.feed(&line));
        }
        let sec = t0.elapsed().as_secs_f64();
        println!("rust-core scroll rows/s {:.0} ({} lines)", lines as f64 / sec, lines);
    }
}
