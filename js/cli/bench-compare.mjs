// 三轴 cross-engine 对比：decode-wasm（WASM + JSON FFI）vs xterm.js（headless core）。
//
// 同一份 vim 启动字节流、同一网格尺寸、同一 chunking，两引擎各自同步喂字节：
//   decode_wasm: Core.feed(bytes)                      → Rust parse + 网格 + diff + JSON 序列化（返回 JSON 字符串）
//   xterm.js   : Terminal._inputHandler.parse(bytes)   → JS parse + buffer 更新（无 diff、无序列化）
// 注意不对称：decode_wasm 的 feed() 含 JSON diff 序列化（#7 待去除）；xterm.js 无此成本。
//
// 用法：
//   npm run bench:compare                 # 80×24，表格输出
//   npm run bench:compare -- --size=120x40 --json   # 自定义尺寸 + 机器可读
//
// 前置：npm install（devDependency @xterm/headless）。
// xterm.js 公开 write() 是异步的（排到宏任务才 flush），故用其同步入口 _inputHandler.parse()
// 做公平的 core-to-core 对比。
import { Core } from '../pkg-node/decode_wasm.js';
import { vimStartupBytes } from '../fixtures/vim-start.js';

const ARGV = process.argv.slice(2);
const sizeArg = ARGV.find((a) => a.startsWith('--size='));
const json = ARGV.includes('--json');
let COLS = 80, ROWS = 24;
if (sizeArg) {
  const m = /^--size=(\d+)[xX](\d+)$/.exec(sizeArg);
  if (!m || !(+m[1] > 0 && +m[2] > 0)) {
    console.error(`未知 size: "${sizeArg}"（格式 --size=COLSxROWS，如 80x24）`);
    process.exit(1);
  }
  COLS = +m[1]; ROWS = +m[2];
}

const repeatBytes = (src, n) => { const o = new Uint8Array(src.length * n); for (let i = 0; i < n; i++) o.set(src, i * src.length); return o; };
const chunk = (p, s) => { const r = []; for (let i = 0; i < p.length; i += s) r.push(p.subarray(i, Math.min(p.length, i + s))); return r; };
const pct = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const q = (x) => (s.length ? s[Math.min(s.length - 1, Math.ceil(x * s.length) - 1)] : NaN);
  return { p50: q(0.5), p95: q(0.95), p99: q(0.99), n: s.length };
};

function engines(Terminal) {
  return {
    decode_wasm: {
      make: () => new Core(COLS, ROWS),
      feed: (c, b) => { c.feed(b); },
    },
    'xterm.js': {
      make: () => new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true, scrollback: 10000 }),
      feed: (t, b) => { t._core._inputHandler.parse(b); },
    },
  };
}

// 吞吐：~8MB vim 流放大，4KB chunk，3 次取中位 MB/s
function benchThroughput(eng) {
  const base = vimStartupBytes();
  const payload = repeatBytes(base, Math.ceil((8 << 20) / base.length));
  const chunks = chunk(payload, 4096);
  { const c = eng.make(); for (let i = 0; i < 64; i++) eng.feed(c, chunks[i]); } // 预热
  const mbps = [];
  for (let r = 0; r < 3; r++) {
    const c = eng.make();
    const t0 = performance.now();
    for (const ch of chunks) eng.feed(c, ch);
    mbps.push(payload.length / 1e6 / ((performance.now() - t0) / 1000));
  }
  mbps.sort((a, b) => a - b);
  return { bytes: payload.length, mbpsMedian: mbps[1], mbpsMin: mbps[0], mbpsMax: mbps[2] };
}

// 延迟：vim 流放大到 ~64KB，切成 64B 块 → ~1024 次 feed，取 p50/p95/p99 ms
function benchLatency(eng) {
  const base = vimStartupBytes();
  const payload = repeatBytes(base, Math.ceil((64 << 10) / base.length));
  const chunks = chunk(payload, 64);
  const c = eng.make();
  const lats = [];
  for (const ch of chunks) { const t0 = performance.now(); eng.feed(c, ch); lats.push(performance.now() - t0); }
  return { n: chunks.length, ms: pct(lats) };
}

// 滚动：2000 行 'x'*cols + CRLF，逐行 feed，取 p50 ms + 行/s
function benchScroll(eng) {
  const lines = 2000;
  const line = new Uint8Array(COLS + 2); line.fill(0x78, 0, COLS); line[COLS] = 0x0d; line[COLS + 1] = 0x0a;
  const payload = repeatBytes(line, lines);
  const c = eng.make();
  const lats = [];
  for (let i = 0; i < lines; i++) { const t0 = performance.now(); eng.feed(c, payload.subarray(i * (COLS + 2), (i + 1) * (COLS + 2))); lats.push(performance.now() - t0); }
  const p = pct(lats);
  const sum = lats.reduce((a, b) => a + b, 0);
  return { lines, ms: p, rowsPerSec: sum > 0 ? lines / (sum / 1000) : NaN };
}

async function main() {
  let xtermPkg;
  try { xtermPkg = await import('@xterm/headless'); }
  catch { console.error('缺少 @xterm/headless —— 先跑 `npm install`（它已列为 devDependency）。'); process.exit(1); }
  const { Terminal } = xtermPkg.default ?? xtermPkg;

  const ENG = engines(Terminal);
  const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');

  // JSON 膨胀：feed 一次 vim 流，量 JSON 输出/输入比（#7 量化依据）
  const base = vimStartupBytes();
  const core = new Core(COLS, ROWS);
  const jsonOut = core.feed(base).length;
  const amplification = jsonOut / base.length;

  const rowsT = [], rowsL = [], rowsS = [];
  if (!json) {
    console.log(`=== 三轴对比（${COLS}x${ROWS}）===`);
    console.log('吞吐（MB/s，越大越好）');
  }
  for (const [name, eng] of Object.entries(ENG)) {
    const r = benchThroughput(eng); rowsT.push({ name, ...r });
    if (!json) console.log(`  ${name.padEnd(12)} 中位 ${fmt(r.mbpsMedian, 2)}  [min ${fmt(r.mbpsMin, 2)} / max ${fmt(r.mbpsMax, 2)}]`);
  }
  if (!json) console.log('\n延迟（ms/次 feed，越小越好）');
  for (const [name, eng] of Object.entries(ENG)) {
    const r = benchLatency(eng); rowsL.push({ name, ...r });
    if (!json) console.log(`  ${name.padEnd(12)} p50 ${fmt(r.ms.p50, 3)}  p95 ${fmt(r.ms.p95, 3)}  p99 ${fmt(r.ms.p99, 3)}  (n=${r.n})`);
  }
  if (!json) console.log('\n滚动（行/s 越大越好 / p50 ms 越小越好）');
  for (const [name, eng] of Object.entries(ENG)) {
    const r = benchScroll(eng); rowsS.push({ name, ...r });
    if (!json) console.log(`  ${name.padEnd(12)} ${fmt(r.rowsPerSec, 0).padStart(7)} 行/s   p50 ${fmt(r.ms.p50, 3)} ms  (${r.lines} 行)`);
  }
  if (!json) console.log(`\nJSON 膨胀：${base.length}B 输入 → ${jsonOut}B JSON（${amplification.toFixed(1)}×）——decode_wasm feed 的序列化开销（#7 待去除）`);

  if (json) console.log(JSON.stringify({
    size: `${COLS}x${ROWS}`,
    jsonAmplification: amplification,
    throughput: Object.fromEntries(rowsT.map(r => [r.name, { mbpsMedian: r.mbpsMedian, mbpsMin: r.mbpsMin, mbpsMax: r.mbpsMax, bytes: r.bytes }])),
    latency: Object.fromEntries(rowsL.map(r => [r.name, r.ms])),
    scroll: Object.fromEntries(rowsS.map(r => [r.name, { rowsPerSec: r.rowsPerSec, p50ms: r.ms.p50 }])),
  }, null, 2));
}

main();
