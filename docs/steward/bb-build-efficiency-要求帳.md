# BB fork 构建流程提效：使用者要求帳

## 2026-10-29 起（整体流程重构）

| 日期 | 要求 | 狀態 | 結果 | 材料 |
| --- | --- | --- | --- | --- |
| 10-29 | 整体检查并重构构建流程，提高常规上游更新与少量冲突场景的效率 | 進行中 | 5abd聚合本地整链1854.6秒、116任务通过；安装27.5秒，较首轮198.5秒减少171秒；CI因scope的OOMPolicy拒绝、resume因Vitest缓存失效，已续派最小修复，未发布 | [工作簿](bb-build-efficiency.md)；[流程报告（本机）](/data/output/bb-build-efficiency-20261029/implementation-flow.md)；[真实整链结果（本机）](/data/output/bb-build-efficiency-20261029/final-pipeline-result.md) |
| 10-29 | 保持现有 fork 维护的效果 | 進行中 | 独立分支/唯一清单/安全main与完整覆盖保留，不采用六组；维护器09336de已合入本机，根实证来源10文件/缓存3文件和7定向回归通过；真实整链恢复仍待验收 | [维护流程](../fork-maintenance.md)；[维护器边界（本机）](/data/output/bb-build-efficiency-20261029/maintenance-tooling-boundary.md)；[根回归（本机）](/data/output/bb-build-efficiency-20261029/root-maintenance-boundary-tests.log) |
| 10-29 | 优化完成后给出实际结果 | 進行中 | 单worker726.7秒、真实4worker315.8秒均收齐用例；本地整链1854.6秒，116任务/10缓存，测试1498.1秒；CI及恢复未闭合，不能宣称最终完成；SDK退化候选排除 | [4worker实测（本机）](/data/output/bb-build-efficiency-20261029/server-four-worker-result.md)；[SDK排除依据（本机）](/data/output/bb-build-efficiency-20261029/implementation-sdk.md)；[真实整链（本机）](/data/output/bb-build-efficiency-20261029/final-pipeline-result.md) |
| 10-29 | 任何明显牺牲须提前确认 | 採納 | 明显降低覆盖、隔离或维护能力的方案先交用户选择；其余已授权实现继续推进 | 會話回覆 2026-10-29；[工作簿](bb-build-efficiency.md) |
| 10-29 | 确认server六组正式采用时的污染检测取舍 | 被覆蓋 | 被下一项“按当前环境配置开放构建资源和并发”取代；先验证原完整入口，六组保留实验，不再把默认采用分组作为前提 | [分组实测（本机）](/data/output/bb-build-efficiency-20261029/server-grouping-result.md)；會話回覆 2026-10-29 |
| 10-29 | 按当前环境配置开放构建资源和并发，旧配置来自低配机器 | 採納 | worker分支c9961b已推送登记并聚合；动态冻结预算保留线上余量，5abd整链CPU1600%、MemoryHigh23.3GiB、4worker全过；35f独立全量315.8秒/362文件/3742用例，峰值9.48GiB，无high/OOM | [4worker实测（本机）](/data/output/bb-build-efficiency-20261029/server-four-worker-result.md)；[整链预算（本机）](/data/output/bb-build-efficiency-20261029/final-pipeline-result.json) |
| 10-29 | 为HTML等文件增加Download，优先插件、不足再考虑内核 | 完成 | 纯插件6076391已发布main、同SHA CI成功，稳定path安装running；真实Chrome桌面/390px窄屏下载文件名/字节/SHA256一致，原生设备未测，无核心补丁 | [验收报告（本机）](/data/output/bb-build-efficiency-20261029/html-download-implementation.md)；[发布CI](https://github.com/hxy91819/bb-plugins/actions/runs/40855998840) |
| 10-29 | 下载功能不能干扰默认预览 | 完成 | 默认仍显示BB Original，普通打开不下载；Chrome桌面/窄屏点击Download后iframe/DOM及文档标记保留，无新增导航/预览GET，下载未额外执行HTML | [真实验收（本机）](/data/output/bb-build-efficiency-20261029/html-download-implementation.md)；會話回覆 2026-10-29 |
