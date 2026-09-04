// WebGL renderer（v2 接口桩，未实现）。
//
// SPEC §10（决策 #13/#14/#16）锁定：端口在 JS 侧，每个 renderer 一个 adapter，
// 共享 apply.js 的网格模型（grid 即共享表示），不引入 scene/几何层。v2 的
// WebGL adapter 目标是「纹理图集 + instanced quad」的 immediate 绘制，逐帧把
// 网格状态刷到 canvas——但当前只留接口桩，不做任何绘制资源、不 touch DOM/GL。
//
// 关键语义（决策 #13/#14「禁止隐式 fallback」）：构造时立即 throw，而不是返回一个
// 半成品对象。这样 ?renderer=webgl 会响亮失败，绝不悄悄退回 canvas/dom 掩盖问题
// —— 与 xterm.js「WebGL 失败退回 DOM」的做法相反。

/**
 * 构造 WebGL renderer（v2）。当前是接口桩：立即 throw，未实现任何绘制逻辑。
 *
 * @param {HTMLCanvasElement} canvas 目标画布（v2 在其上创建 WebGL 上下文）
 * @param {number} cols 列数（v2 用于字形单元几何）
 * @param {number} rows 行数
 */
export function createWebGLRenderer(canvas, cols, rows) {
  throw new Error('WebGLRenderer 是 v2（纹理图集 + instanced quad），未实现');
}
