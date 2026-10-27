# 本机 Steward 插件安装：使用者要求帳

## 2026-10-27 起（本机源码安装）

| 日期 | 要求 | 狀態 | 結果 | 材料 |
| --- | --- | --- | --- | --- |
| 10-27 | 按 feature/steward 源码构建并 path 安装，保留源码，不重启服务 | 完成 | steward@0.1.0 running，CLI 可用，源码保留，服务未重启 | [本机安装目录](/data/code/bb-steward-source/plugins/steward)；[源码](https://github.com/hxy91819/bb/commit/7c286dcdafc83eaf1554232e742b23605b18f0d2) |
| 10-27 | 同步并核验最新版 mason-skills 中的 bb-steward 技能与脚本 | 完成 | main 与 origin/main 同为 e728ec3，bb-steward 及两脚本已接入 agents、Codex 和 Claude 入口，无需更新 | [本机技能](/data/code/mason-skills/common-skills/bb-steward/SKILL.md) |
| 10-27 | 使用 bb-steward 管家流程推进本次安装 | 完成 | 看门狗已登记；steward show 返回本会话工作簿、要求帐和检查器绑定 | [工作簿](steward-plugin-install.md) |
| 10-27 | 核查几个旧管家是否需要重新登记 | 完成 | 三个旧会话插件绑定均为空；opencraft 与 lightspace 为暂不支持平台入口的 Git-ref 模式，vela 工作簿标头缺要求帐链接；原看门狗登记仍保留 | 會話回覆（2026-10-27） |
| 10-27 | 把 opencraft、vela、lightspace 三个旧管家的平台入口处理好 | 進行中 | opencraft 入口已发布；lightspace 标准帐已核验至 origin/master@66f3509（33行、3项业务进行中）；vela 账目与共享插件兼容仍在进行 | 會話回覆（2026-10-27） |
