// 共享启动配置：一份 schema + 一个 parseConfig，浏览器 ?query 与 Node --flag 共用。
//
// SPEC §11「启动命令区分」（决策 #6）：两条启动路径曾各解析一遍同一组键、行为已分叉
// （默认值不同、垃圾值处理不同）。收敛 = 共享 config 模块 + 精简键面 + 统一校验：
//   - 浏览器把 URLSearchParams 的 entries 传进来；Node 写 ~10 行 argv→键值对再传进来。
//   - 键面：renderer / bench / size（cols+rows 合并为 COLSxROWS）/ perf（浏览器）/ json（Node）。
//   - 公共默认（renderer=canvas、perf=false、json=false）进 schema；面相关默认（size：
//     浏览器 VIM 60×15、Node 80×24）由各入口显式一行覆盖——分叉摆在明面上，不藏进解析器。
//   - 校验：未知键 warn 不炸（抓 typo）；已知键非法值 throw（报错样式对齐「未知 renderer」）。
//   - demo/bench 切换保持隐式（?bench= 存在即 bench），不加 mode 键。
// 零第三方依赖。

import { BACKENDS } from './src/renderers/index.js';

/** bench 负载轴（与 bench-common.js 的 RUNNERS 键对齐）。 */
export const BENCH_KINDS = ['throughput', 'latency', 'scroll'];

// 一份 schema：键 → 类型 + 校验 + 公共默认。size/bench 无公共默认（面相关），
// 由各入口通过 parseConfig 的 defaults 显式覆盖。
const SCHEMA = {
  renderer: { kind: 'enum', values: BACKENDS, default: 'canvas' },
  bench:    { kind: 'enum', values: BENCH_KINDS },
  size:     { kind: 'size' },
  perf:     { kind: 'bool', default: false },
  json:     { kind: 'bool', default: false },
};

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

/** 布尔键：裸 flag（Node 的 --json，v == null）→ true；否则按 1/true/yes/on 判真。 */
function coerceBool(v) {
  return v == null ? true : TRUE_VALUES.has(String(v).toLowerCase());
}

/** size 键面 "COLSxROWS" → { cols, rows }；非法值 throw（对齐「未知 renderer」样式）。 */
function parseSize(raw) {
  const m = /^(\d+)[xX](\d+)$/.exec(String(raw));
  if (!m || !(Number(m[1]) > 0 && Number(m[2]) > 0)) {
    throw new Error(`未知 size: "${raw}"（格式 COLSxROWS，如 80x24）`);
  }
  return { cols: Number(m[1]), rows: Number(m[2]) };
}

/**
 * 把键值对解析成一份配置。
 *
 * @param {Iterable<[string, string|null]>} entries  键值对（URLSearchParams.entries() 或 argv 转出）
 * @param {{defaults?: object}} [opts]               面相关默认（size/bench）；公共默认已在 schema
 * @returns {{renderer: string, bench: (string|undefined), size: string,
 *            cols: number, rows: number, perf: boolean, json: boolean}}
 */
export function parseConfig(entries, { defaults = {} } = {}) {
  const cfg = { ...defaults };

  for (const [key, raw] of entries) {
    const spec = SCHEMA[key];
    if (!spec) {
      console.warn(`未知启动键: "${key}"（忽略；可选 ${Object.keys(SCHEMA).join('|')}）`);
      continue;
    }
    if (spec.kind === 'enum') {
      const val = raw == null ? '' : String(raw);
      if (!spec.values.includes(val)) {
        throw new Error(`未知 ${key}: "${val}"（可选 ${spec.values.join('|')}）`);
      }
      cfg[key] = val;
    } else if (spec.kind === 'bool') {
      cfg[key] = coerceBool(raw);
    } else {
      // size：原样记下键面字符串，末尾统一拆 cols/rows（默认值也走同一校验）。
      cfg.size = String(raw);
    }
  }

  // 公共默认兜底（renderer/perf/json）；bench 无公共默认（浏览器缺省 = demo 模式）。
  cfg.renderer = cfg.renderer ?? SCHEMA.renderer.default;
  cfg.perf = cfg.perf ?? SCHEMA.perf.default;
  cfg.json = cfg.json ?? SCHEMA.json.default;

  // size → cols/rows：来自显式键或 defaults.size，二者必居其一。
  if (cfg.size === undefined) {
    throw new Error('缺少 size（入口需给 defaults.size，如 "80x24"）');
  }
  const { cols, rows } = parseSize(cfg.size);
  cfg.cols = cols;
  cfg.rows = rows;

  return cfg;
}
