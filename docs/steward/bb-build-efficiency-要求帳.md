# BB fork 构建流程提效：使用者要求帳

## 2026-10-29 起（整体流程重构）

| 日期 | 要求 | 狀態 | 結果 | 材料 |
| --- | --- | --- | --- | --- |
| 10-29 | 整体检查并重构构建流程，提高常规上游更新与少量冲突场景的效率 | 進行中 | 流程bac3339已完成cgroup/冻结预算与Vitest接线，原47回归及7个真实接线场景通过，最后增量独审中；SDK9c真实验收中，整链尚未验收 | [工作簿](bb-build-efficiency.md)；[流程当前报告（本机）](/data/output/bb-build-efficiency-20261029/implementation-flow.md)；[SDK当前报告（本机）](/data/output/bb-build-efficiency-20261029/implementation-sdk.md) |
| 10-29 | 保持现有 fork 维护的效果 | 進行中 | 本地/CI、冷安装、类型检查和资源边界保持；六组完整实验已通过、全部用例保留，但跨组污染检测有损失，默认入口未改 | [维护流程](../fork-maintenance.md)；[分组结果（本机）](/data/output/bb-build-efficiency-20261029/server-grouping-result.md) |
| 10-29 | 优化完成后给出实际结果 | 進行中 | 相同预算下单worker726.7秒、真实4worker315.8秒收齐全部用例，峰值9.48GiB，缓存/宿主差异单列；SDK冷pack慢25.87%已排除，整链仍待测 | [4worker实测（本机）](/data/output/bb-build-efficiency-20261029/server-four-worker-result.md)；[SDK排除依据（本机）](/data/output/bb-build-efficiency-20261029/implementation-sdk.md) |
| 10-29 | 任何明显牺牲须提前确认 | 採納 | 明显降低覆盖、隔离或维护能力的方案先交用户选择；其余已授权实现继续推进 | 會話回覆 2026-10-29；[工作簿](bb-build-efficiency.md) |
| 10-29 | 确认server六组正式采用时的污染检测取舍 | 被覆蓋 | 被下一项“按当前环境配置开放构建资源和并发”取代；先验证原完整入口，六组保留实验，不再把默认采用分组作为前提 | [分组实测（本机）](/data/output/bb-build-efficiency-20261029/server-grouping-result.md)；會話回覆 2026-10-29 |
| 10-29 | 按当前环境配置开放构建资源和并发，旧配置来自低配机器 | 進行中 | 原入口新预算726.7秒通过；独立fix/server-worker-budget=21633abe仅3个任务提交，配置解析及7项轻量回归通过，真实dry-plan精准失效已证；完整4worker待测 | [当前主机实测（本机）](/data/output/bb-build-efficiency-20261029/current-host-resource-result.md)；[独立分支（本机）](/data/output/bb-build-efficiency-20261029/worker-independent-branch.md) |
| 10-29 | 为HTML等文件增加Download，优先插件、不足再考虑内核 | 完成 | 纯插件6076391已发布main、同SHA CI成功，稳定path安装running；真实Chrome桌面/390px窄屏下载文件名/字节/SHA256一致，原生设备未测，无核心补丁 | [验收报告（本机）](/data/output/bb-build-efficiency-20261029/html-download-implementation.md)；[发布CI](https://github.com/hxy91819/bb-plugins/actions/runs/40855998840) |
| 10-29 | 下载功能不能干扰默认预览 | 完成 | 默认仍显示BB Original，普通打开不下载；Chrome桌面/窄屏点击Download后iframe/DOM及文档标记保留，无新增导航/预览GET，下载未额外执行HTML | [真实验收（本机）](/data/output/bb-build-efficiency-20261029/html-download-implementation.md)；會話回覆 2026-10-29 |
