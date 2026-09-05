# decode_wasm

Rust → WASM 终端仿真器核心（「字节流 → 网格 → diff」）的词汇表。架构决策锁定在 `SPEC.md`，这里只管「词怎么叫」。

## Language

**demo 模式**:
默认运行形态：喂 vim 启动流、接受交互输入，肉眼看得见屏幕。
_Avoid_: 交互模式、普通模式、跑 demo

**bench 模式**:
跑一条负载轴并输出采样结果的运行形态（对应 SPEC §11 的 bench 模式）。
_Avoid_: 性能模式、测速模式、压力测试

**负载轴**:
bench 模式下采样的三条轴之一：`throughput`（吞吐）/ `latency`（延迟）/ `scroll`（滚动）。
_Avoid_: 负载、测试项、workload、benchmark

**入口面**:
同一份 config 的消费端：浏览器（demo 页，URL query）或 Node（bench CLI，`--flag`）。键面共享，仅面相关默认值不同。
_Avoid_: 平台、端、入口

**size**:
网格几何，`COLSxROWS` 格式（如 `80x24`）。核心接口与网格模型仍按 cols/rows 两维表述，size 只是键面。
_Avoid_: geometry、dimensions、分辨率
