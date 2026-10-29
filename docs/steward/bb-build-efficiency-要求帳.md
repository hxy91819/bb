# BB fork 构建流程提效：使用者要求帳

## 2026-10-29 起（整体流程重构）

| 日期 | 要求 | 狀態 | 結果 | 材料 |
| --- | --- | --- | --- | --- |
| 10-29 | 整体检查并重构构建流程，提高常规上游更新与少量冲突场景的效率 | 進行中 | 流程首审三项P1和SDK首审两项P1均已退回修复；SDK同时简化冷路径编排，server分组实验进行中，尚无整链提速验收结论 | [工作簿](bb-build-efficiency.md)；[流程首审（本机）](/data/output/bb-build-efficiency-20261029/review-flow.md)；[SDK首审（本机）](/data/output/bb-build-efficiency-20261029/review-sdk.md) |
| 10-29 | 保持现有 fork 维护的效果 | 進行中 | 本地/CI、冷安装、类型检查和资源边界保持；六组完整实验已通过、全部用例保留，但跨组污染检测有损失，默认入口未改 | [维护流程](../fork-maintenance.md)；[分组结果（本机）](/data/output/bb-build-efficiency-20261029/server-grouping-result.md) |
| 10-29 | 优化完成后给出实际结果 | 進行中 | SDK单次对照：build＋pack100.53→91.47秒、恢复51.27→8.16秒、冷pack52.90→66.58秒；冷路径退化未采纳，整链仍待测 | [SDK真实报告（本机）](/data/output/bb-build-efficiency-20261029/implementation-sdk.md) |
| 10-29 | 任何明显牺牲须提前确认 | 採納 | 明显降低覆盖、隔离或维护能力的方案先交用户选择；其余已授权实现继续推进 | 會話回覆 2026-10-29；[工作簿](bb-build-efficiency.md) |
| 10-29 | 确认server六组正式采用时的污染检测取舍 | 被覆蓋 | 被下一项“按当前环境配置开放构建资源和并发”取代；先验证原完整入口，六组保留实验，不再把默认采用分组作为前提 | [分组实测（本机）](/data/output/bb-build-efficiency-20261029/server-grouping-result.md)；會話回覆 2026-10-29 |
| 10-29 | 按当前环境配置开放构建资源和并发，旧配置来自低配机器 | 進行中 | 已实测32逻辑CPU/62GiB、约42GiB可用；先试16核、24/32GiB及4测试worker，动态探测模块与原入口全量验证已派发 | [工作簿](bb-build-efficiency.md)；會話回覆 2026-10-29 |
| 10-29 | 为HTML等文件增加Download，优先插件、不足再考虑内核 | 進行中 | 已创建独立插件工作树并派发能力调查/实现，要求下载原始字节及文件名，保持既有认证与文件授权 | [实现任务（本机）](/data/output/bb-build-efficiency-20261029/html-download-task.txt) |
