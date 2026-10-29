# BB fork 构建流程提效：使用者要求帳

## 2026-10-29 起（整体流程重构）

| 日期 | 要求 | 狀態 | 結果 | 材料 |
| --- | --- | --- | --- | --- |
| 10-29 | 整体检查并重构构建流程，提高常规上游更新与少量冲突场景的效率 | 完成 | dc7810/.5聚合48tip、三CI任务/5资产成功；本地维护增量289.6秒，同环境/预算resume六检查全复用28.165秒；运行代码/依赖/链接相同保留现役1e9，维护工具本机生效，材料和清理已收口 | [Release](https://github.com/hxy91819/bb/releases/tag/fork-v0.47.0-20261029.5)；[最终报告（本机）](/data/output/bb-build-efficiency-20261029/final-pipeline-result.md)；[根独立比对（本机）](/data/output/bb-build-efficiency-20261029/root-payload-verification.json) |
| 10-29 | 保持现有 fork 维护的效果 | 完成 | 独立分支/唯一清单/安全main与原测试覆盖保留，48tip全部聚合；维护器09336de在本机；native仍核验、变化重装级联；正式同条件resume六检查全复用，预算变动则正确重验，未采用六组削弱污染检测 | [维护流程](../fork-maintenance.md)；[维护器边界（本机）](/data/output/bb-build-efficiency-20261029/maintenance-tooling-boundary.md)；[正式验收（本机）](/data/output/bb-build-efficiency-20261029/final-pipeline-result.md) |
| 10-29 | 优化完成后给出实际结果 | 完成 | 同树安装扫描94–102→3.8–4.2秒；完整server四worker315.8秒；116任务本地31分钟；本次0产品任务维护增量本地4分50秒、到发布12分40秒；同条件正式resume28.165秒全复用，操作导致预算变动返工单列，未以不同范围冒称提速比 | [4worker实测（本机）](/data/output/bb-build-efficiency-20261029/server-four-worker-result.md)；[扫描对照（本机）](/data/output/bb-build-efficiency-20261029/implementation-flow.md)；[最终报告（本机）](/data/output/bb-build-efficiency-20261029/final-pipeline-result.md) |
| 10-29 | 任何明显牺牲须提前确认 | 採納 | 明显降低覆盖、隔离或维护能力的方案先交用户选择；其余已授权实现继续推进 | 會話回覆 2026-10-29；[工作簿](bb-build-efficiency.md) |
| 10-29 | 确认server六组正式采用时的污染检测取舍 | 被覆蓋 | 被下一项“按当前环境配置开放构建资源和并发”取代；先验证原完整入口，六组保留实验，不再把默认采用分组作为前提 | [分组实测（本机）](/data/output/bb-build-efficiency-20261029/server-grouping-result.md)；會話回覆 2026-10-29 |
| 10-29 | 按当前环境配置开放构建资源和并发，旧配置来自低配机器 | 採納 | worker分支c9961b已推送登记并聚合；动态冻结预算保留线上余量，5abd整链CPU1600%、MemoryHigh23.3GiB、4worker全过；35f独立全量315.8秒/362文件/3742用例，峰值9.48GiB，无high/OOM | [4worker实测（本机）](/data/output/bb-build-efficiency-20261029/server-four-worker-result.md)；[整链预算（本机）](/data/output/bb-build-efficiency-20261029/final-pipeline-result.json) |
| 10-29 | 为HTML等文件增加Download，优先插件、不足再考虑内核 | 完成 | 纯插件6076391已发布main、同SHA CI成功，稳定path安装running；真实Chrome桌面/390px窄屏下载文件名/字节/SHA256一致，原生设备未测，无核心补丁 | [验收报告（本机）](/data/output/bb-build-efficiency-20261029/html-download-implementation.md)；[发布CI](https://github.com/hxy91819/bb-plugins/actions/runs/40855998840) |
| 10-29 | 下载功能不能干扰默认预览 | 完成 | 默认仍显示BB Original，普通打开不下载；Chrome桌面/窄屏点击Download后iframe/DOM及文档标记保留，无新增导航/预览GET，下载未额外执行HTML | [真实验收（本机）](/data/output/bb-build-efficiency-20261029/html-download-implementation.md)；會話回覆 2026-10-29 |
| 10-29 | 推断常规上游更新、少量冲突时进行一次聚合打包的耗时 | 完成 | 建议常规代码更新预留40–60分钟，冲突处理另计；依据本地116任务31分钟及本次发布CI约8分钟，属于估算而非同输入上游升级实测；仅维护工具增量到发布实测12分40秒 | [完整范围历史（本机）](/data/output/bb-build-efficiency-20261029/history/final-pipeline-result.f5c30c-5abd.json)；[本次发布（本机）](/data/output/bb-build-efficiency-20261029/final-pipeline-result.json)；會話回覆 2026-10-29 |
| 10-29 | 复盘聚合打包及整体处理为何慢 | 完成 | 主要额外拖延为CI scope属性/控制器/重启挂接差异与安装回执扫描、Vite/native边界反复返工；非发布首次/重复准备和真实产品树恢复补齐验证，另披露最终错误预算探针导致的额外重验；失败证据均保留 | [整轮实现与返工（本机）](/data/output/bb-build-efficiency-20261029/implementation-flow.md)；[发布与恢复记录（本机）](/data/output/bb-build-efficiency-20261029/final-pipeline-result.md)；[前轮整体复盘（本机）](/data/output/bb-consolidated-20261029/retrospective.md) |
