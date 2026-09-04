/* @ts-self-types="./decode_wasm.d.ts" */

/**
 * 一个终端实例，暴露给 JS。
 */
class Core {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CoreFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_core_free(ptr, 0);
    }
    /**
     * 喂一段字节（JS 传 `Uint8Array`），返回本次变更的 JSON 数组字符串。
     * @param {Uint8Array} bytes
     * @returns {string}
     */
    feed(bytes) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.core_feed(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * 建 `cols × rows` 的空终端。
     * @param {number} cols
     * @param {number} rows
     */
    constructor(cols, rows) {
        const ret = wasm.core_new(cols, rows);
        this.__wbg_ptr = ret;
        CoreFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * 尺寸变化（触发全量重绘）。
     * @param {number} cols
     * @param {number} rows
     */
    resize(cols, rows) {
        wasm.core_resize(this.__wbg_ptr, cols, rows);
    }
    /**
     * 调试 / demo：可见屏拼成多行字符串。
     * @returns {string}
     */
    screen_text() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.core_screen_text(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * scrollback（历史）行数。
     * @returns {number}
     */
    scrollback_len() {
        const ret = wasm.core_scrollback_len(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) Core.prototype[Symbol.dispose] = Core.prototype.free;
exports.Core = Core;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_bb96b2010945f0bc: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./decode_wasm_bg.js": import0,
    };
}

const CoreFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_core_free(ptr, 1));

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/decode_wasm_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();
