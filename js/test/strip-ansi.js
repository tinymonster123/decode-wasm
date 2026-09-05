// 测试专用工具（#11 从 text renderer 本体迁出）：剥掉所有 SGR 序列，得到纯文本。
// 行尾无额外换行（与 gridText 一致）。断言前提：render 的字符序列 == gridText
// 的字符序列，只在字符之间插入 SGR，因此 stripAnsi(render(...)) === gridText(...)
// 严格成立。只住 js/test/，不属于 Renderer 端口。

/**
 * @param {string} s
 * @returns {string}
 */
export function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
