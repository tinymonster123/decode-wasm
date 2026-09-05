// 浏览器 demo 入口：加载 WASM Core → 按 URL query 选 adapter + bench 负载 → 喂字节 → 画。
//
// SPEC §10/§11：URL query 切 renderer / bench / perf / size，同一份代码只换后端与负载。
//   http://localhost:8000/js/                                    （默认 canvas + vim demo）
//   http://localhost:8000/js/?renderer=dom&bench=throughput&perf=1&size=80x200
// 键面解析/校验走 config.js（决策 #6）；未知 renderer 由 config 直接 throw（不做隐式 fallback）。
//
// web target 的 glue 用 fetch 加载 .wasm，`file://` 下被浏览器 CORS 拦，要用 http.server。

import init, { Core } from './pkg/decode_wasm.js';
import { createRenderer } from './src/renderers/index.js';
import { createSession } from './src/session.js';
import { createPerfSampler, now } from './src/perf.js';
import { runBench } from './src/bench-common.js';
import { createPanel } from './src/panel.js';
import { parseConfig } from './config.js';
import { VIM_COLS, VIM_ROWS, vimStartupBytes } from './fixtures/vim-start.js';

await init();

// 键面解析/校验集中在 config.js：URLSearchParams.entries() 传入，浏览器默认 size 显式
// 一行 = VIM 尺寸（60×15，demo 画面按它调的）。size 只是键面，config 层拆回 cols/rows。
// 报错时把 message 写进页面正文再抛，对齐今天「未知 renderer」的可视行为。
let cfg;
try {
  cfg = parseConfig(new URLSearchParams(location.search).entries(), {
    defaults: { size: `${VIM_COLS}x${VIM_ROWS}` },
  });
} catch (err) {
  document.body.textContent = err.message;
  throw err;
}
const { renderer: backend, bench, perf, cols, rows } = cfg;

// 屏幕容器：按后端建对应元素（canvas / div 行容器 / pre 纯文本）。
const screenEl = document.getElementById('screen');

function mountScreen() {
  screenEl.innerHTML = '';
  if (backend === 'text') {
    const pre = document.createElement('pre');
    pre.className = 'text-screen';
    screenEl.appendChild(pre);
    return { pre };
  }
  if (backend === 'dom') {
    const host = document.createElement('div');
    host.className = 'dom-screen';
    screenEl.appendChild(host);
    return { host };
  }
  const canvas = document.createElement('canvas');
  screenEl.appendChild(canvas);
  return { canvas };
}

// 建一个 raw renderer（factory 显式 dispatch）。
function makeRenderer() {
  const els = mountScreen();
  const opts = { cols, rows };
  if (backend === 'dom') opts.host = els.host;
  else if (backend !== 'text') opts.canvas = els.canvas;
  const renderer = createRenderer(backend, opts);
  if (backend === 'text') {
    // text 是纯字符串：把每次渲染结果写进 <pre> 显示，其余语义不变。
    const pre = els.pre;
    return {
      render: (g, c) => {
        const s = renderer.render(g, c);
        pre.textContent = s;
        return s;
      },
      blitScroll: (...a) => {
        const s = renderer.blitScroll(...a);
        pre.textContent = s;
        return s;
      },
      resize: (c, r) => renderer.resize(c, r),
    };
  }
  return renderer;
}

const sampler = createPerfSampler();
const core = new Core(cols, rows);
let scrollback = 0; // 面板几何指标：demo 用顶层 core、bench 用 full 档 core 的 scrollback

// 包一层 session.feed：记录单次 feed 延迟 + change 数 + 字节数（喂给 float panel 采样器）。
function instrument(session, renderer, core) {
  const feed = session.feed.bind(session);
  session.feed = (bytes) => {
    const t0 = now();
    const changes = feed(bytes);
    sampler.recordFeed(now() - t0, changes.length, bytes.length);
    if (core) scrollback = core.scrollback_len();
    return changes;
  };
  // 计时真实渲染帧（render/blit），喂给面板的帧时间/FPS。rAF 只负责 UI 刷新，
  // 不把 rAF 间隔误当渲染耗时。
  for (const m of ['render', 'blitScroll']) {
    const fn = renderer[m];
    if (typeof fn === 'function') {
      renderer[m] = (...args) => {
        const t0 = now();
        const r = fn.apply(renderer, args);
        sampler.recordFrame(now() - t0);
        return r;
      };
    }
  }
  return session;
}

// float perf HUD（perf=1 时）。
let panel = null;
if (perf) {
  panel = createPanel(document.body, {
    sampler,
    getMeta: () => ({ cols, rows, scrollback, renderer: backend }),
  });
  panel.start();
}

function formatResult(result) {
  const fmt = (m) =>
    `p50 ${m.p50.toFixed(2)}ms / p95 ${m.p95.toFixed(2)}ms / p99 ${m.p99.toFixed(2)}ms (n=${m.n})`;
  switch (result.kind) {
    case 'throughput':
      return [
        `吞吐: core ${result.coreMbps.toFixed(1)} MB/s` +
          (result.fullMbps != null ? `，full ${result.fullMbps.toFixed(1)} MB/s` : ''),
        `${(result.bytes / 1e6).toFixed(1)} MB / ${result.chunks} chunks（core ${result.coreSec.toFixed(3)}s）`,
      ].join('\n');
    case 'latency':
      return [
        `延迟 core: ${fmt(result.coreMs)}`,
        result.fullMs ? `延迟 full: ${fmt(result.fullMs)}` : '（无 full 档）',
      ].join('\n');
    case 'scroll':
      return [
        `滚动 core: ${fmt(result.coreMs)}，${result.coreMs.perSec.toFixed(0)} scroll/s`,
        result.fullMs ? `滚动 full: ${fmt(result.fullMs)}，${result.fullMs.perSec.toFixed(0)} scroll/s` : '',
      ]
        .filter(Boolean)
        .join('\n');
    default:
      return JSON.stringify(result);
  }
}

if (bench) {
  // bench 模式：跑指定负载，结果写到 console + 一个 <pre>。
  const ctx = {
    makeCore: () => new Core(cols, rows),
    makeSession: () => {
      const c = new Core(cols, rows);
      const renderer = makeRenderer();
      return instrument(createSession({ core: c, cols, rows, renderer }), renderer, c);
    },
  };
  const result = runBench(bench, ctx, { cols, rows });
  const text = formatResult(result);
  console.log(text);
  const out = document.createElement('pre');
  out.id = 'result';
  out.textContent = `[bench ${bench}] renderer=${backend} cols=${cols} rows=${rows}\n${text}`;
  document.body.appendChild(out);
} else {
  // 默认 demo：喂 vim 启动流 + 交互输入。
  const renderer = makeRenderer();
  const session = instrument(createSession({ core, cols, rows, renderer }), renderer, core);
  session.feed(vimStartupBytes());

  // 交互：把按键编码成字节再喂回。可打印字符直通，常用控制键映射。
  const input = document.getElementById('input');
  input.addEventListener('keydown', (e) => {
    let bytes;
    if (e.key === 'Enter') bytes = new Uint8Array([0x0d]);
    else if (e.key === 'Backspace') bytes = new Uint8Array([0x08]);
    else if (e.key === 'Tab') bytes = new Uint8Array([0x09]);
    else if (e.key === 'Escape') bytes = new Uint8Array([0x1b]);
    else if (e.key.length === 1) bytes = new TextEncoder().encode(e.key);
    else return; // 方向键等非单字符键，demo 忽略
    e.preventDefault();
    session.feed(bytes);
  });
  input.focus();
}
