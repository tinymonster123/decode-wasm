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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_core_free: (a: number, b: number) => void;
    readonly core_feed: (a: number, b: number, c: number) => [number, number];
    readonly core_new: (a: number, b: number) => number;
    readonly core_resize: (a: number, b: number, c: number) => void;
    readonly core_screen_text: (a: number) => [number, number];
    readonly core_scrollback_len: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
