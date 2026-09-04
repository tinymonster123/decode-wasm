// adapter 层验收测试（Node）：验证 SPEC §10/§11 的两条硬约束——
//   1) 端口 factory 显式 dispatch、不做隐式 fallback；
//   2) 同一份 vim 启动字节流，text sink 的纯文本输出与权威 gridText 严格一致
//      （canvas/dom 是像素/节点，不能在此断言；三者由 session.js 保证消费同一份网格）。
//
// 跑法：node js/adapters.test.mjs  （在仓库根目录）
import assert from 'node:assert/strict';
import { Core } from './pkg-node/decode_wasm.js';
import { createRenderer, BACKENDS } from './renderer.js';
import { createSession } from './session.js';
import { gridText } from './apply.js';
import { stripAnsi } from './text-renderer.js';
import { runBench, throughputPayload, scrollPayload, latencyChunks } from './bench-common.js';
import { VIM_COLS, VIM_ROWS, vimStartupBytes } from './vim-sequence.js';

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('adapter 层验收：');

// ---- 1) factory 显式 dispatch、禁止隐式 fallback ----
console.log('factory：');
ok('text backend 返回完整接口', () => {
  const r = createRenderer('text', { cols: 10, rows: 5 });
  assert.equal(typeof r.render, 'function');
  assert.equal(typeof r.blitScroll, 'function');
  assert.equal(typeof r.resize, 'function');
  assert.equal(typeof r.latest, 'function');
});
ok('未知 backend 直接 throw（不 fallback）', () => {
  assert.throws(() => createRenderer('bogus'), /未知 renderer/);
});
ok('webgl/webgpu 是 v2 桩，构造即 throw', () => {
  assert.throws(() => createRenderer('webgl', { canvas: {}, cols: 10, rows: 5 }), /v2|未实现/);
  assert.throws(() => createRenderer('webgpu', { canvas: {}, cols: 10, rows: 5 }), /v2|未实现/);
});
ok('BACKENDS 覆盖 SPEC §10 五个后端', () => {
  assert.deepEqual(BACKENDS, ['canvas', 'dom', 'text', 'webgl', 'webgpu']);
});

// ---- 2) 三 sink 一致性：text 纯文本 === gridText ----
console.log('text sink 一致性：');
{
  const core = new Core(VIM_COLS, VIM_ROWS);
  const renderer = createRenderer('text', { cols: VIM_COLS, rows: VIM_ROWS });
  const session = createSession({ core, cols: VIM_COLS, rows: VIM_ROWS, renderer });
  const changes = session.feed(vimStartupBytes());

  ok('text 输出 strip ANSI 后严格等于 gridText', () => {
    assert.equal(stripAnsi(renderer.latest()), gridText(session.grid, VIM_COLS, VIM_ROWS));
  });
  ok('text 输出含 SGR 转义（vim 有配色）', () => {
    assert.ok(renderer.latest().includes('['), '应含 ANSI SGR');
  });
  ok('change 流 tags 与 smoke 一致', () => {
    const tags = new Set(changes.map((c) => c.t));
    for (const t of ['reset', 'cell', 'clear', 'cursor']) assert.ok(tags.has(t), t);
    assert.ok(!tags.has('scroll_up') && !tags.has('scroll_down'));
  });
}

// ---- 3) 滚动快路径：blitScroll 后 text 仍 === gridText ----
console.log('scroll 快路径：');
{
  const core = new Core(80, 24);
  const renderer = createRenderer('text', { cols: 80, rows: 24 });
  const session = createSession({ core, cols: 80, rows: 24, renderer });
  const bytes = scrollPayload(80, 24, 500);
  session.feed(bytes); // 每行一次 ScrollUp，走 blitScroll
  ok('滚动后 text 输出仍严格等于 gridText', () => {
    assert.equal(stripAnsi(renderer.latest()), gridText(session.grid, 80, 24));
  });
  ok('core 产生 scrollback', () => {
    assert.ok(core.scrollback_len() > 0, `scrollback=${core.scrollback_len()}`);
  });
}

// ---- 3.5) blit 判定回归：多滚动回退全量 render、单滚动仍走 blit ----
console.log('blit 判定：');
{
  // spy renderer：记录 render/blitScroll 调用，供断言判定路径与网格一致性。
  const makeSpy = () => ({
    calls: [],
    render(g) { this.calls.push({ type: 'render', grid: g }); },
    blitScroll(dir, top, bottom, count, g) { this.calls.push({ type: 'blitScroll', count, grid: g }); },
  });

  // 一次 feed 多条 scroll_up（3 裸换行）→ 必须回退全量 render，而非只 blit 最后一条。
  {
    const spy = makeSpy();
    const core = new Core(80, 24);
    core.feed(new Uint8Array(Array(23).fill(0x0a))); // 光标移到末行
    const session = createSession({ core, cols: 80, rows: 24, renderer: spy });
    session.feed(new Uint8Array([0x0a, 0x0a, 0x0a]));
    const last = spy.calls[spy.calls.length - 1];
    ok('多滚动 feed 回退全量 render（而非错误 blit 单行）', () => {
      assert.equal(last.type, 'render');
    });
    ok('renderer 拿到的网格与权威 grid 一致', () => {
      assert.equal(gridText(last.grid, 80, 24), gridText(session.grid, 80, 24));
    });
  }

  // 单条 scroll_up（1 裸换行）→ 仍走 blit 快路径（修复不得退化掉 blit）。
  {
    const spy = makeSpy();
    const core = new Core(80, 24);
    core.feed(new Uint8Array(Array(23).fill(0x0a)));
    const session = createSession({ core, cols: 80, rows: 24, renderer: spy });
    session.feed(new Uint8Array([0x0a]));
    ok('单条 scroll 仍走 blit 快路径', () => {
      assert.equal(spy.calls[spy.calls.length - 1].type, 'blitScroll');
    });
  }
}

// ---- 4) bench 负载生成 ----
console.log('bench 负载：');
ok('throughputPayload 放大到 >= targetBytes', () => {
  const p = throughputPayload(1 << 20);
  assert.ok(p.length >= 1 << 20, `len=${p.length}`);
});
ok('scrollPayload = lines × (cols+2)（CRLF 每行触发一次 ScrollUp）', () => {
  const p = scrollPayload(80, 24, 100);
  assert.equal(p.length, 100 * 82);
  assert.equal(p[80], 0x0d); // 每行尾是 \r
  assert.equal(p[81], 0x0a); // 再 \n
});
ok('latencyChunks 拆分后总和等于原流长度', () => {
  const chunks = latencyChunks(64);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  assert.equal(total, vimStartupBytes().length);
});

// ---- 5) runBench（Node core-only 档） ----
console.log('runBench：');
ok('throughput 出 coreMbps', () => {
  const r = runBench('throughput', { makeCore: () => new Core(80, 24) }, { targetBytes: 1 << 16 });
  assert.equal(r.kind, 'throughput');
  assert.ok(r.coreMbps > 0, `coreMbps=${r.coreMbps}`);
});
ok('latency 出 core 分位', () => {
  const r = runBench('latency', { makeCore: () => new Core(80, 24) });
  assert.equal(r.kind, 'latency');
  assert.ok(r.coreMs.n > 0);
  assert.ok(r.coreMs.p50 >= 0);
});
ok('scroll 出 core 滚动帧', () => {
  const r = runBench('scroll', { makeCore: () => new Core(80, 24) }, { cols: 80, rows: 24, lines: 100 });
  assert.equal(r.kind, 'scroll');
  assert.equal(r.coreMs.n, 100);
  assert.ok(r.coreMs.perSec > 0);
});
ok('未知 bench 直接 throw', () => {
  assert.throws(() => runBench('bogus', { makeCore: () => new Core(80, 24) }), /未知 bench/);
});

console.log(`\n✅ adapters 验收通过：${passed} 项`);
