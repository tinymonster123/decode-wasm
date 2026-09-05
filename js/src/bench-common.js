// 三轴 bench 的负载生成 + 运行逻辑，浏览器（main.js）与 Node（bench.mjs）共用。
//
// SPEC §11：吞吐（core parse）/ 延迟（feed）/ 滚动（render 帧）。启动命令区分：
//   ?bench=throughput|latency|scroll（浏览器 URL query）
//   --bench=throughput|latency|scroll（Node CLI）
// 每轴都分两档测：core-only（core.feed 不渲染，纯 parser）vs full（session.feed 整条链）。

import { vimStartupBytes } from '../fixtures/vim-start.js';

/** 把一段字节重复 n 次拼成新数组。 */
export function repeatBytes(src, n) {
  const out = new Uint8Array(src.length * n);
  for (let i = 0; i < n; i++) out.set(src, i * src.length);
  return out;
}

/** 把 payload 切成 chunkSize 大小的小块（喂给 feed 的现实粒度，如 PTY 4KB read）。 */
export function chunkPayload(payload, chunkSize) {
  const chunks = [];
  for (let i = 0; i < payload.length; i += chunkSize) {
    chunks.push(payload.subarray(i, Math.min(payload.length, i + chunkSize)));
  }
  return chunks;
}

/** 吞吐负载：把 vim 启动流放大到 ~targetBytes（SPEC 点名的「vim 流放大 N 倍」）。 */
export function throughputPayload(targetBytes) {
  const base = vimStartupBytes();
  const n = Math.max(1, Math.ceil(targetBytes / base.length));
  return repeatBytes(base, n);
}

/** 延迟负载：把 vim 启动流切成 ~chunkSize 的小块，逐块 feed 测单次延迟。 */
export function latencyChunks(chunkSize = 64) {
  const base = vimStartupBytes();
  return chunkPayload(base, chunkSize);
}

/** 滚动负载：反复「写满一行 + 换行」，每行触发一次 ScrollUp（内容上移）。 */
export function scrollPayload(cols, rows, lines) {
  // 'x'*cols + '\r\n'：LF 不回列，缺 '\r' 会让每行「阶梯式」跨两行、产生不了每行一次
  // ScrollUp。CRLF 保证写完一整行后回列 0 再换行，屏幕填满后每行触发一次 ScrollUp。
  const line = new Uint8Array(cols + 2);
  line.fill(0x78, 0, cols); // 'x'
  line[cols] = 0x0d; // '\r'
  line[cols + 1] = 0x0a; // '\n'
  return repeatBytes(line, lines);
}

/**
 * 吞吐：core parse MB/s（不渲染）vs full pipeline MB/s（session.feed）。
 * 两档各用一个独立 core（喂字节会推进状态，不能重复喂同一个）。
 */
export function runThroughput(ctx, { targetBytes = 8 << 20, chunkSize = 4096 } = {}) {
  const payload = throughputPayload(targetBytes);
  const chunks = chunkPayload(payload, chunkSize);

  const core = ctx.makeCore();
  let t0 = performance.now();
  for (const c of chunks) core.feed(c);
  const coreSec = (performance.now() - t0) / 1000;

  let fullSec = NaN;
  if (ctx.makeSession) {
    const session = ctx.makeSession();
    t0 = performance.now();
    for (const c of chunks) session.feed(c);
    fullSec = (performance.now() - t0) / 1000;
  }

  return {
    kind: 'throughput',
    bytes: payload.length,
    chunks: chunks.length,
    coreMbps: payload.length / 1e6 / coreSec,
    fullMbps: Number.isFinite(fullSec) ? payload.length / 1e6 / fullSec : undefined,
    coreSec,
    fullSec: Number.isFinite(fullSec) ? fullSec : undefined,
  };
}

/** 延迟：单次 feed 的 p50/p95/p99（ms），core-only 与 full 两档。 */
export function runLatency(ctx, { chunkSize = 64 } = {}) {
  const chunks = latencyChunks(chunkSize);
  const time = (fn) => {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  };

  const coreLat = [];
  {
    const core = ctx.makeCore();
    for (const c of chunks) coreLat.push(time(() => core.feed(c)));
  }

  let fullLat = undefined;
  if (ctx.makeSession) {
    const session = ctx.makeSession();
    fullLat = [];
    for (const c of chunks) fullLat.push(time(() => session.feed(c)));
  }

  const p = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const q = (x) => (s.length ? s[Math.min(s.length - 1, Math.ceil(x * s.length) - 1)] : NaN);
    return { p50: q(0.5), p95: q(0.95), p99: q(0.99), n: s.length };
  };

  return {
    kind: 'latency',
    chunks: chunks.length,
    coreMs: p(coreLat),
    fullMs: fullLat ? p(fullLat) : undefined,
  };
}

/** 滚动：每行一次 ScrollUp 的 feed 墙钟（含 render/blit），core-only 与 full 两档。 */
export function runScroll(ctx, { cols, rows, lines = 2000 } = {}) {
  const payload = scrollPayload(cols, rows, lines);
  const lineLen = cols + 2;
  const n = Math.floor(payload.length / lineLen);
  const time = (fn) => {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  };

  const coreLat = [];
  {
    const core = ctx.makeCore();
    for (let i = 0; i < n; i++) coreLat.push(time(() => core.feed(payload.subarray(i * lineLen, (i + 1) * lineLen))));
  }

  let fullLat = undefined;
  if (ctx.makeSession) {
    const session = ctx.makeSession();
    fullLat = [];
    for (let i = 0; i < n; i++) fullLat.push(time(() => session.feed(payload.subarray(i * lineLen, (i + 1) * lineLen))));
  }

  const p = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const q = (x) => (s.length ? s[Math.min(s.length - 1, Math.ceil(x * s.length) - 1)] : NaN);
    const sum = s.reduce((a, b) => a + b, 0);
    return {
      p50: q(0.5),
      p95: q(0.95),
      p99: q(0.99),
      n: s.length,
      perSec: (sum / 1000) > 0 ? s.length / (sum / 1000) : NaN,
    };
  };

  return {
    kind: 'scroll',
    lines: n,
    cols,
    rows,
    coreMs: p(coreLat),
    fullMs: fullLat ? p(fullLat) : undefined,
  };
}

const RUNNERS = { throughput: runThroughput, latency: runLatency, scroll: runScroll };

/**
 * 统一入口。ctx 提供：
 *   - makeCore(): 新 Core 实例
 *   - makeSession?(): 新 session（可选；不给则只测 core-only 档）
 * opts 里 cols/rows 给 scroll 负载用。
 */
export function runBench(kind, ctx, opts = {}) {
  const runner = RUNNERS[kind];
  if (!runner) {
    throw new Error(`未知 bench: "${kind}"（可选 ${Object.keys(RUNNERS).join('|')}）`);
  }
  return runner(ctx, opts);
}
