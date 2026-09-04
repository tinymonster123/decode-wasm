/* tslint:disable */
/* eslint-disable */

/**
 * 一个终端实例，暴露给 JS。
 */
export class Core {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * 喂一段字节（JS 传 `Uint8Array`），返回本次变更的 JSON 数组字符串。
     */
    feed(bytes: Uint8Array): string;
    /**
     * 建 `cols × rows` 的空终端。
     */
    constructor(cols: number, rows: number);
    /**
     * 尺寸变化（触发全量重绘）。
     */
    resize(cols: number, rows: number): void;
    /**
     * 调试 / demo：可见屏拼成多行字符串。
     */
    screen_text(): string;
    /**
     * scrollback（历史）行数。
     */
    scrollback_len(): number;
}
