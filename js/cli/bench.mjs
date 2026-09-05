// Node 端 bench CLI（SPEC §11「启动命令区分」的 Node 端）。
//
// 跑法（在仓库根目录）：
//   node js/cli/bench.mjs --renderer=canvas|dom|text|webgl|webgpu --bench=throughput|latency|scroll \
//        --size=80x24 --json
//
// 键面解析/校验走 config.js（决策 #6）。与浏览器 ?bench= 路径共用 bench-common.js 的
// 同一套负载/runner，保证两边的吞吐/延迟/滚动数字口径一致。Node 无 DOM，只有 text
// renderer 能实例化，因此 full 档只在 --renderer=text 时测，其余 backend 只测 core parse 档。
// （Node 无面板；浏览器 perf=1 的 float panel 不适用于本 CLI。）

import { Core } from '../pkg-node/decode_wasm.js';
import { createRenderer } from '../src/renderers/index.js';
import { createSession } from '../src/session.js';
import { runBench } from '../src/bench-common.js';
import { parseConfig } from '../config.js';

/**
 * process.argv → 键值对（~10 行）：`--key=value` → [key, value]；裸 `--key`（布尔键）→ [key, null]。
 * 解析/校验交给 config.js 的 parseConfig，这里只做机械转换。
 */
function argvPairs(argv) {
  const pairs = [];
  for (const token of argv) {
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    const eq = body.indexOf('=');
    pairs.push(eq >= 0 ? [body.slice(0, eq), body.slice(eq + 1)] : [body, null]);
  }
  return pairs;
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
  // Node 默认 size 显式一行 = 80×24；bench 默认 = throughput（Node 无 demo 模式）。
  const cfg = parseConfig(argvPairs(process.argv.slice(2)), {
    defaults: { size: '80x24', bench: 'throughput' },
  });
  const { renderer, bench, cols, rows, json } = cfg;

  // 端口在 JS 侧、每 renderer 一个 adapter 共享 grid.js 网格（SPEC §10）。Node 无 DOM：
  // 只有 text 能实例化，webgl/webgpu 是 v2 桩会 throw，canvas/dom 需要真实元素。
  // renderer 的合法性已由 config.js 校验（未知直接 throw），此处只需区分 text vs 其余。
  const ctx = { makeCore: () => new Core(cols, rows) };

  if (renderer === 'text') {
    ctx.makeSession = () =>
      createSession({
        core: new Core(cols, rows),
        cols,
        rows,
        renderer: createRenderer('text', { cols, rows }),
      });
  } else {
    // 已知但非 text 的 backend：Node 无 DOM，只测 core parse（full 档跳过）。
    ctx.makeSession = undefined;
    console.log('note renderer ' + renderer + ' 在 Node 无 DOM，仅测 core parse（full 档跳过）');
  }

  const result = runBench(bench, ctx, { cols, rows });

  console.log(format(result));
  if (json) console.log(JSON.stringify(result));
}

try {
  main();
} catch (err) {
  // runBench 对未知 bench 会 throw；未知 renderer 由 factory throw。统一捕获退出。
  console.error(err && err.message ? err.message : err);
  process.exit(1);
}
