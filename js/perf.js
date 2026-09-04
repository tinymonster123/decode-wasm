// 性能采样：环形缓冲 + 分位数 + 汇总。只用 performance.now()，不引第三方依赖。
//
// 浏览器 float panel（panel.js）和 Node bench（bench.mjs）共用。SPEC §11 三条轴：
//   - 吞吐（core parse）MB/s
//   - 延迟（feed）p50/p95/p99
//   - 帧时间（render/blit）p50/p95 + FPS
// 这里只管「记录样本 → 算分位数/速率」，展示/导出在 panel.js。

/** 定长环形缓冲：满了覆盖最旧，复用底层数组不反复分配。 */
export function createRingBuffer(capacity = 1 << 16) {
  const buf = new Float64Array(capacity);
  let len = 0;
  let head = 0;
  return {
    push(v) {
      buf[head] = v;
      head = (head + 1) % capacity;
      if (len < capacity) len++;
    },
    get length() {
      return len;
    },
    /** 按时间顺序快照（旧→新），供导出原始样本。 */
    values() {
      const out = new Float64Array(len);
      for (let i = 0; i < len; i++) out[i] = buf[(head - len + i + capacity) % capacity];
      return out;
    },
    clear() {
      len = 0;
      head = 0;
    },
  };
}

/** 升序快照数组（分位数输入）。 */
export function sortedAsc(buffer) {
  const a = Array.from(buffer.values());
  a.sort((x, y) => x - y);
  return a;
}

/**
 * nearest-rank 分位数：p ∈ (0,1]，样本升序，取第 ceil(p·n) 个（1-based）。
 * 空样本返回 NaN。
 */
export function percentile(sorted, p) {
  const n = sorted.length;
  if (n === 0) return NaN;
  const idx = Math.max(0, Math.min(n - 1, Math.ceil(p * n) - 1));
  return sorted[idx];
}

/** 统一的计时源：浏览器和 Node 都有 globalThis.performance。 */
export function now() {
  return globalThis.performance.now();
}

/**
 * 一次采样会话：记录 feed 延迟 / 帧时间 / change 数 / 字节数，能汇总出
 * FPS、feed 延迟 p50/p95/p99、change/s、吞吐 MB/s。
 */
export function createPerfSampler() {
  const feedLat = createRingBuffer(); // 单次 feed() 墙钟（ms）
  const frameTime = createRingBuffer(); // 单帧 render/blit 墙钟（ms）
  let bytesTotal = 0;
  let changesTotal = 0;
  let feeds = 0;
  let t0 = now();

  return {
    /** feed 结束时调用：记录延迟 + 吞吐账。 */
    recordFeed(ms, nChanges, nBytes) {
      feedLat.push(ms);
      changesTotal += nChanges;
      bytesTotal += nBytes;
      feeds++;
    },
    /** 单帧渲染完成时调用（panel 的 rAF / scroll bench 打点）。 */
    recordFrame(ms) {
      frameTime.push(ms);
    },
    summary() {
      const fl = sortedAsc(feedLat);
      const ft = sortedAsc(frameTime);
      const seconds = Math.max(now() - t0, 1e-6) / 1000;
      const frameP50 = percentile(ft, 0.5);
      return {
        feed: {
          count: feeds,
          p50: percentile(fl, 0.5),
          p95: percentile(fl, 0.95),
          p99: percentile(fl, 0.99),
          n: fl.length,
        },
        frame: {
          p50: frameP50,
          p95: percentile(ft, 0.95),
          p99: percentile(ft, 0.99),
          fps: Number.isFinite(frameP50) && frameP50 > 0 ? 1000 / frameP50 : NaN,
          n: ft.length,
        },
        changesPerSec: changesTotal / seconds,
        throughputMBps: bytesTotal / 1e6 / seconds,
        bytesTotal,
        changesTotal,
        seconds,
      };
    },
    /** 原始样本 dump（供「导出」JSON/CSV）。 */
    dump() {
      return {
        feedLatencyMs: Array.from(feedLat.values()),
        frameTimeMs: Array.from(frameTime.values()),
        bytesTotal,
        changesTotal,
      };
    },
    reset() {
      feedLat.clear();
      frameTime.clear();
      bytesTotal = changesTotal = feeds = 0;
      t0 = now();
    },
  };
}
