// Node 端 bench CLI（SPEC §11「启动命令区分」的 Node 端）。
//
// 跑法（在仓库根目录）：
//   node js/bench.mjs --renderer=canvas|dom|text|webgl|webgpu --bench=throughput|latency|scroll \
//        --cols=80 --rows=24 --perf --json
//
// 与浏览器 ?bench= 路径共用 bench-common.js 的同一套负载/runner，保证两边的
// 吞吐/延迟/滚动数字口径一致。Node 无 DOM，只有 text renderer 能实例化，
// 因此 full 档只在 --renderer=text 时测，其余 backend 只测 core parse 档。

import { Core } from './pkg-node/decode_wasm.js';
import { createRenderer, BACKENDS } from './renderer.js';
import { createSession } from './session.js';
import { runBench } from './bench-common.js';

/**
 * 解析 process.argv 里的 --key=value 或 --key value 参数。
 * 布尔键（perf/json）支持裸 flag（--perf 即 true）；数值键（cols/rows）parseInt。
 */
function parseArgs(argv) {
  const opts = {
    renderer: 'canvas',
    bench: 'throughput',
    cols: 80,
    rows: 24,
    perf: false,
    json: false,
  };
  const isBool = (k) => k === 'perf' || k === 'json';
  const isNum = (k) => k === 'cols' || k === 'rows';

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    const eq = body.indexOf('=');
    let key = body;
    let val = null; // null 表示没在 `=` 里显式给值，需从下一个 token 取
    if (eq >= 0) {
      key = body.slice(0, eq);
      val = body.slice(eq + 1);
    }
    if (!(key in opts)) continue; // 未知参数忽略，不炸

    if (isBool(key)) {
      // 裸 flag（--perf）→ true；--perf=false → false
      opts[key] = val === null ? true : val === 'true' || val === '1' || val === 'yes';
    } else if (isNum(key)) {
      opts[key] = parseInt(val === null ? argv[i + 1] : val, 10);
      if (val === null) i++; // 已消费下一个 token 作值
    } else {
      opts[key] = val === null ? argv[i + 1] : val;
      if (val === null) i++;
    }
  }
  return opts;
}

/** 毫秒值 → 2 位小数字符串；NaN/undefined → '--'。 */
function fmtMs(v) {
  return Number.isFinite(v) ? v.toFixed(2) : '--';
}

/**
 * 一组百分位 → 中文文本。p 为 undefined（无 full 档）时标「（无 full 档）」。
 * withPerSec 为真时（滚动轴）再拼上 perSec。
 */
function fmtPct(p, withPerSec) {
  if (!p) return '（无 full 档）';
  let s = 'p50 ' + fmtMs(p.p50) + ' ms, p95 ' + fmtMs(p.p95) + ' ms, p99 ' + fmtMs(p.p99) + ' ms';
  if (withPerSec) {
    s += ', perSec ' + (Number.isFinite(p.perSec) ? p.perSec.toFixed(1) : '--');
  }
  return s;
}

/** 把三种 kind 的结果格式化成对齐的中文可读文本。 */
function format(result) {
  if (result.kind === 'throughput') {
    const mb = (result.bytes / 1e6).toFixed(1);
    const full = Number.isFinite(result.fullMbps) ? result.fullMbps.toFixed(1) + ' MB/s' : '（无 full 档）';
    return '吞吐: core ' + result.coreMbps.toFixed(1) + ' MB/s, full ' + full + ', ' +
      mb + ' MB / ' + result.chunks + ' chunks';
  }
  if (result.kind === 'latency') {
    return '延迟: core ' + fmtPct(result.coreMs) + ', full ' + fmtPct(result.fullMs);
  }
  if (result.kind === 'scroll') {
    return '滚动: core ' + fmtPct(result.coreMs, true) + ', full ' + fmtPct(result.fullMs, true) +
      ', ' + result.lines + ' lines';
  }
  return '';
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  // 端口在 JS 侧、每 renderer 一个 adapter 共享 apply.js 网格（SPEC §10）。Node 无 DOM：
  // 只有 text 能实例化，webgl/webgpu 是 v2 桩会 throw，canvas/dom 需要真实元素。
  const ctx = { makeCore: () => new Core(opts.cols, opts.rows) };

  if (opts.renderer === 'text') {
    ctx.makeSession = () =>
      createSession({
        core: new Core(opts.cols, opts.rows),
        cols: opts.cols,
        rows: opts.rows,
        renderer: createRenderer('text', { cols: opts.cols, rows: opts.rows }),
      });
  } else if (BACKENDS.includes(opts.renderer)) {
    // 已知但非 text 的 backend：Node 无 DOM，只测 core parse（full 档跳过）。
    ctx.makeSession = undefined;
    console.log('note renderer ' + opts.renderer + ' 在 Node 无 DOM，仅测 core parse（full 档跳过）');
  } else {
    // 未知 renderer：交给 factory 抛（adapter 显式声明、不做隐式 fallback）。
    createRenderer(opts.renderer, { cols: opts.cols, rows: opts.rows });
  }

  const result = runBench(opts.bench, ctx, { cols: opts.cols, rows: opts.rows });

  console.log(format(result));
  if (opts.json) console.log(JSON.stringify(result));
  if (opts.perf) console.log('float panel 是浏览器特性，Node 侧无面板；本 CLI 已直接输出百分位');
}

try {
  main();
} catch (err) {
  // runBench 对未知 bench 会 throw；未知 renderer 由 factory throw。统一捕获退出。
  console.error(err && err.message ? err.message : err);
  process.exit(1);
}
