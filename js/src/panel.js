// 浮动性能面板（float perf HUD，SPEC §11）。
//
// demo 页右上角半透明浮动面板：采样期间实时显示 FPS / 帧时间 / feed 延迟 / 吞吐 / 几何，
// 带「导出 JSON / 导出 CSV」按钮把原始样本 dump 成文件。只依赖 performance.now() +
// requestAnimationFrame + perf.js 的环形缓冲，不引第三方依赖。
//
// 分层（SPEC §10/§11，决策 #13/#14/#16）：面板是纯观测者——只读 perf.js 的
// createPerfSampler() 实例（summary()/dump()），不触碰 grid.js 网格、不介入渲染路径。
// 所有 DOM / window / requestAnimationFrame 访问都在 createPanel 函数体内，
// 保证 Node `import './panel.js'` 不崩（模块顶层零 DOM 引用）。

/** 数字格式化：非有限值（NaN/±Infinity，空样本分位数）打占位符，其余保留指定小数位。 */
function fmt(x, digits = 1) {
  return Number.isFinite(x) ? x.toFixed(digits) : '—';
}

/** ms → µs（整数精度）。非有限值同样打占位符。 */
function usOf(ms) {
  return Number.isFinite(ms) ? `${Math.round(ms * 1000)}µs` : '—';
}

/**
 * 在 container 里挂一个浮动性能面板，返回控制句柄。
 *
 * @param {HTMLElement} container  挂载容器（面板绝对定位到它的右上角）。
 * @param {{ sampler: object, getMeta: () => ({ cols, rows, scrollback, renderer }) }} opts
 *   - sampler：perf.js 的 createPerfSampler() 实例（recordFeed/recordFrame/summary/dump/reset）
 *   - getMeta：回调，返回网格/滚动几何元信息（来自 core.scrollback_len() 与 cols/rows）
 */
export function createPanel(container, { sampler, getMeta }) {
  // —— DOM 元素（函数体内才碰 document，Node import 走不到这里）——
  const doc = (container && container.ownerDocument) || globalThis.document;

  const el = doc.createElement('div');
  el.style.cssText = [
    'position:absolute; top:8px; right:8px;',
    'background:rgba(0,0,0,0.6); color:#e0e0e0;',
    'font:11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;',
    'padding:8px 10px; border-radius:6px;',
    'z-index:9999;',
    'white-space:pre;',
    'pointer-events:none;', // 面板本体不挡交互；导出按钮单独覆盖为 auto
  ].join('');

  const pre = doc.createElement('pre');
  pre.style.cssText = 'margin:0 0 6px;';
  el.appendChild(pre);

  // 导出工具栏：覆盖面板的 pointer-events:none，让两个按钮可点。
  const bar = doc.createElement('div');
  bar.style.cssText = 'display:flex; gap:6px; pointer-events:auto;';
  bar.appendChild(makeButton(doc, '导出 JSON', exportJSON));
  bar.appendChild(makeButton(doc, '导出 CSV', exportCSV));
  el.appendChild(bar);

  container.appendChild(el);

  // —— rAF 采样循环 ——
  let rafId = 0;
  let running = false;

  function tick() {
    // 帧时间由 render/blit 路径记录（main.js 的 instrument 包裹 renderer 计时）；
    // rAF 只负责刷新 UI，不把 rAF 间隔误当渲染帧耗时。
    refresh();
    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
    running = true;
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
  }

  /** 读 summary() + getMeta()，把指标写进 <pre>（等宽对齐，FPS 1 位小数、µs 整数精度）。 */
  function refresh() {
    const s = sampler.summary();
    const m = getMeta();

    const f = (x) => fmt(x, 1); // FPS / 速率，1 位小数
    const ms = (x) => fmt(x, 2); // 延迟，2 位小数（ms）
    const row = (label, value) => `${label} ${value}\n`;

    let text = '';
    text += row('FPS       ', f(s.frame.fps));
    text += row('帧 p50/p95/p99', `${ms(s.frame.p50)} / ${ms(s.frame.p95)} / ${ms(s.frame.p99)} ms`);
    text += row('feed p50  ', `${ms(s.feed.p50)} ms  ${usOf(s.feed.p50)}`);
    text += row('feed p95  ', `${ms(s.feed.p95)} ms  ${usOf(s.feed.p95)}`);
    text += row('feed p99  ', `${ms(s.feed.p99)} ms  ${usOf(s.feed.p99)}`);
    text += row('change/s  ', f(s.changesPerSec));
    text += row('吞吐      ', `${f(s.throughputMBps)} MB/s`);
    text += row(
      '网格      ',
      `${m.cols}×${m.rows}  滚动 ${m.scrollback} 行  renderer ${m.renderer}`
    );
    text += row('采样      ', `feed ${s.feed.count} / frame ${s.frame.n}`);

    pre.textContent = text;
  }

  /** 序列化 meta + summary + 原始样本，触发浏览器下载。 */
  function exportJSON() {
    const payload = {
      meta: getMeta(),
      summary: sampler.summary(),
      samples: sampler.dump(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlob(doc, blob, `perf-${Date.now()}.json`);
  }

  /** feed 延迟 / 帧时间各一列（行数取 max，短的尾部留空），第一行表头。 */
  function exportCSV() {
    const { feedLatencyMs, frameTimeMs } = sampler.dump();
    const n = Math.max(feedLatencyMs.length, frameTimeMs.length);
    const lines = ['feedLatencyMs,frameTimeMs'];
    for (let i = 0; i < n; i++) {
      const f = i < feedLatencyMs.length ? feedLatencyMs[i] : '';
      const t = i < frameTimeMs.length ? frameTimeMs[i] : '';
      lines.push(`${f},${t}`);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    downloadBlob(doc, blob, `perf-${Date.now()}.csv`);
  }

  return { start, stop, refresh, exportJSON, exportCSV, el };
}

/** 造一个小按钮（等宽小字号，与面板风格一致）。 */
function makeButton(doc, label, onClick) {
  const b = doc.createElement('button');
  b.textContent = label;
  b.style.cssText = [
    'font:11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;',
    'background:#333; color:#e0e0e0; border:1px solid #555; border-radius:3px;',
    'padding:1px 6px; cursor:pointer;',
  ].join('');
  b.addEventListener('click', onClick);
  return b;
}

/** Blob + URL.createObjectURL + <a download> 触发下载（延迟回收 objectURL）。 */
function downloadBlob(doc, blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = filename;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
