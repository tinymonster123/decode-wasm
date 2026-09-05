// 启动配置解析/校验验收（Node）：验证决策 #6 收敛后的 config.js——
//   1) size 键面 COLSxROWS 正确拆成 cols/rows；
//   2) 已知键非法值（size/renderer/bench）throw，报错样式对齐「未知 renderer」；
//   3) 未知键 console.warn 不炸；
//   4) 各入口默认值（浏览器 VIM 60×15 / Node 80×24 + bench=throughput）。
//
// 跑法：node js/test/config.test.mjs  （在仓库根目录）
import assert from 'node:assert/strict';
import { parseConfig } from '../config.js';

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// 临时接管 console.warn，收集未知键告警。
function captureWarn(fn) {
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try { fn(); } finally { console.warn = orig; }
  return warns;
}

console.log('启动配置解析/校验：');

// ---- 1) size 解析 ----
console.log('size 键面：');
ok('size=80x24 → cols=80 rows=24', () => {
  const c = parseConfig([['size', '80x24']], { defaults: { size: '60x15' } });
  assert.equal(c.cols, 80);
  assert.equal(c.rows, 24);
  assert.equal(c.size, '80x24');
});
ok('size=80x200（浏览器大屏）→ cols=80 rows=200', () => {
  const c = parseConfig([['size', '80x200']], { defaults: { size: '60x15' } });
  assert.equal(c.cols, 80);
  assert.equal(c.rows, 200);
});
ok('大写 X 也认（80X24）', () => {
  const c = parseConfig([['size', '80X24']], { defaults: { size: '60x15' } });
  assert.equal(c.cols, 80);
  assert.equal(c.rows, 24);
});

// ---- 2) 已知键非法值 throw ----
console.log('非法值 throw：');
ok('size=80（缺 rows）throw', () => {
  assert.throws(() => parseConfig([['size', '80']], { defaults: { size: '60x15' } }), /未知 size/);
});
ok('size=abc throw', () => {
  assert.throws(() => parseConfig([['size', 'abc']], { defaults: { size: '60x15' } }), /未知 size/);
});
ok('size=80x0 throw（非正整数）', () => {
  assert.throws(() => parseConfig([['size', '80x0']], { defaults: { size: '60x15' } }), /未知 size/);
});
ok('renderer=bogus throw（对齐未知 renderer 样式）', () => {
  assert.throws(() => parseConfig([['renderer', 'bogus']], { defaults: { size: '80x24' } }), /未知 renderer/);
});
ok('bench=bogus throw', () => {
  assert.throws(() => parseConfig([['bench', 'bogus']], { defaults: { size: '80x24' } }), /未知 bench/);
});

// ---- 3) 未知键 warn 不炸 ----
console.log('未知键 warn：');
ok('未知键 colss → warn 不 throw，其余照常解析', () => {
  const warns = captureWarn(() => {
    const c = parseConfig([['colss', '80']], { defaults: { size: '80x24' } });
    assert.equal(c.cols, 80);
  });
  assert.equal(warns.length, 1);
  assert.match(warns[0], /未知启动键/);
  assert.match(warns[0], /colss/);
});

// ---- 4) 各入口默认值 ----
console.log('默认值：');
ok('浏览器默认 size=60x15（VIM），renderer=canvas，bench 缺省=demo', () => {
  const c = parseConfig([], { defaults: { size: '60x15' } });
  assert.equal(c.renderer, 'canvas');
  assert.equal(c.bench, undefined);
  assert.equal(c.cols, 60);
  assert.equal(c.rows, 15);
  assert.equal(c.perf, false);
  assert.equal(c.json, false);
});
ok('Node 默认 size=80x24 + bench=throughput', () => {
  const c = parseConfig([], { defaults: { size: '80x24', bench: 'throughput' } });
  assert.equal(c.renderer, 'canvas');
  assert.equal(c.bench, 'throughput');
  assert.equal(c.cols, 80);
  assert.equal(c.rows, 24);
});
ok('布尔键：perf=1 → true；json 裸 flag → true', () => {
  const c = parseConfig([['perf', '1'], ['json', null]], { defaults: { size: '80x24' } });
  assert.equal(c.perf, true);
  assert.equal(c.json, true);
});

console.log(`\n✅ config 解析验收通过：${passed} 项`);
