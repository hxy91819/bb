# 2026-10-03 稳定基线迁移与聚合发布核查

本次目标是基于上游最新稳定版完成 rebase、依赖修复、聚合验证、四平台运行时发布和本地安装准备；停在现有服务切换之前。

## 基线与迁移

上游 [desktop-v0.45.0](https://github.com/get-bb/bb/releases/tag/desktop-v0.45.0) 为非预发布版本，发布时间为 2026-10-02 22:14:01 UTC，提交 `129f621771a3e275773992db648316966ac207cf`。原有 35 个登记 fork 分支迁至该 tag；根工作区保持 `local/aggregate`，修改在分支 worktree 中完成，原分支引用保留为本地备份。合并和 rebase 显式禁用 autostash。

`fix/dependency-security` 的 override 迁移提交为 `863128922`；后续 `6f9447189` 补齐 npm 自带副本的实际安装修复。上游 Zod `4.6.5` 和新补丁声明保留，既有 Vite `6.4.3` override 也保留。其余冲突适配保留编辑器 composer ownership、可定制侧栏行操作、ACP 取消后重建，以及上游已吸收的子线程 interruption cause 和 setup failure 通知。新增 daemon→server 的 `turn/input/delivery` 事件对应协议号由上游 `227` 递增为 `228`，触发旧 daemon 的版本检查与更新。

## 依赖核查边界

采用仓库声明的 pnpm `9.15.0`。候选安装使用 `pnpm install --frozen-lockfile`，没有重新求解锁文件。目标版本和路径通过锁文件、`pnpm why -r --json` 与 npm 官方 bulk 接口核对。

| 锁文件包 | 解析版本 |
| --- | --- |
| `@grpc/grpc-js` | `1.14.5` |
| `undici` | `6.28.1`、`7.29.1`、`8.10.2` |
| `markdown-it` | `14.3.2` |
| `brace-expansion` | `1.1.21`、`2.1.7`、`5.0.12` |
| `joi` | `17.13.8` |
| `moment` | `2.31.0` |
| `node-forge` | `1.4.0`，保留残余漏洞 |

锁文件中这些包的受影响旧版本已经清除，三个直接 undici 声明仍为 `7.29.1`。对全锁文件所有解析版本请求 `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk`，再按实际版本范围匹配、以 `(包名, 公告 URL)` 去重，仍得到 136 条包/公告关系、39 个包。此统计只覆盖 pnpm 锁文件，不包含 tarball 自带的嵌套副本和 Node 内置实现。前一轮完整 `pnpm audit` 两次 OOM，本轮没有把官方接口核查写成“全仓审计通过”。

[node-forge 公告 GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) 对 `<=1.4.0` 的 RSA PKCS#1 v1.5 验签有高危记录，官方仍没有修复版。Expo/EAS 的证书与签名工具继续使用 `1.4.0`，没有降级，也没有声称该项修复。

### npm 捆绑副本

实际安装文件还发现 `npm 11.16.0` 的 tarball 自带 `node_modules/undici 6.26.0` 和 `node_modules/brace-expansion 5.0.6`。这两份代码不由 pnpm 的依赖图单独解析，overrides 不会替换它们。真实用途为 BB 的插件安装/构建工具、server 中的 npm 操作，以及 bb-app 生产运行时携带的 npm CLI。

官方 bulk 接口按这两个实际版本分别匹配到 10 条与 6 条不同 GHSA。直接检查 npm 官方 tarball：11.17.0 仍为 6.26.0/5.0.6，11.18.0 和 11.19.0 为 6.27.0/5.0.7，11.20.0 和当前最新 11.x 的 11.21.0 为 6.28.0/5.0.9，均没有达到目标补丁版本。本次保持 npm `11.16.0`，以两个固定版本的 pnpm alias 提供补丁源，在根 `prepare` 中替换 npm 的物理副本；发布脚本也在安装生产依赖后执行相同修复，并同步实际外层 package-lock 条目。替换前删除目标目录，锁文件采用临时文件加 rename，避免写穿 pnpm 共享 store 的硬链接。npm 自带副本更新至 undici `6.28.1`、brace-expansion `5.0.12`，沿用兼容的 balanced-match。新增行为测试验证真实 HTTP 200/503、文件模式展开、原始硬链接内容保留、重复执行与锁元数据恢复。分支 frozen install 与该测试已通过；最终聚合及发布包检查完成后另记结果。

### 仓库以外的实现

本机外部 Pi `1.0.0` 的 undici 为 `8.10.2`，其 brace-expansion `5.0.9` 仍有三条 GHSA；仓库 override 不会修改该外部安装。外部 Pi 本轮没有升级。

运行时沿用发布流程的 Node `24.15.0`，内置 undici 为 `7.24.4`。npm/ pnpm overrides 不会影响全局 fetch 的内置实现；官方公告范围匹配有 21 个不同 GHSA，但该数量不能证明每项都可经 Node fetch 利用。Node 升级和当前服务替换均未混入源码迁移。

## 审查

首轮审查确认父线程误隐藏所有自定义快捷操作，已改为只过滤 `archive` 并补组合行为测试。分范围复审分别覆盖 UI、ACP、服务端和发布工具。服务端复审确认新增事件遗漏协议号递增，已在 steer 分支递增为 `228`。UI 复审确认隐藏 provider 回退未标注执行来源，已补 `client-preference` 使创建值与 composer 显示一致，并补项目默认被隐藏的行为测试。DSH 原生技能目录测试区分静态声明与动态 resolver，保留两类能力。ACP 复审的未来 goal 扩展格式兼容建议未提供当前受支持代理的失败输入，按本次发布范围归为后续协议兼容事项，未改变 goal 协商契约。补充审查 `thr_djxac5tncx`（`acp-devin / swe-2-medium / max`）完整覆盖两轮候选之间 14 个文件的全部差异，未发现 P0/P1。类型检查随后修正了测试对 union 类型字段的直接访问，协议版本测试也同步到 `228`；最终四文件补充审查 `thr_dempviqcae`（`acp-amp / medium / medium`）已完整通过，覆盖测试隔离、协议断言、技能行数与服务端 worker 限制；审查结果不替代完整测试。维护报告与单项集成测试预算的审查 `thr_5t863564wu`（`acp-devin / swe-2-medium / max`）已完整通过，未发现 P0/P1。

## 验证与发布状态

资源较重的检查通过 `scripts/run-resource-isolated --profile package` 串行运行，Turbo 使用 `--concurrency=1`。最终源码候选 `d066abfc919ba15e04d059b5b7fa025819fc2488` 的 `fork-package --verify-only --test-filter '*' --test-filter '!@bb/desktop'` 已成功：frozen install、102 个 typecheck 任务、104 个测试流程任务全部通过（后者 99 个缓存命中）。逐包日志汇总为 19115 项 Vitest 测试通过、27 项跳过，另有 1 项 Node npm 修复行为测试通过。缓存来自相同输入的成功结果，没有把失败日志计入通过。最后的维护补充只改变两份报告，正式发布前仍由 `fork-package` 核验最终 SHA。

| 范围 | 通过 | 跳过 |
| --- | ---: | ---: |
| App（573 个测试文件） | 5269 | 5 |
| Server（321 个测试文件） | 3317 | 1 |
| Host daemon | 717 | 2 |
| ACP bridge / ACP plugin | 398 / 77 | 4 / 0 |
| Pi bridge | 183 | 1 |
| CLI | 842 | 1 |
| 账号池 / 推送 / Modal | 340 / 23 / 63 | 0 |
| 笔记 / 任务编辑器 | 100 / 412 | 0 |
| Thread list | 456 | 0 |
| Mobile / Web / Connect | 327 / 157 / 192 | 0 |
| bb-app launcher / npm 修复行为 | 195 / 1 | 0 |

真实本地 HTTP 探针覆盖 CLI 请求、连接复用、503 正文和取消，以及账号池、推送的 CONNECT 代理；Modal 实际解析的 grpc-js 完成本地 unary 往返与权限错误探针，均通过。没有调用真实 Modal 云账号。

验证期间失败均已处理：DSH 静态技能目录断言适配；provider source 的 union 类型断言和 sessionStorage 隔离；协议断言更新到 228；技能参考等义精简回 500 行；本机 Git 包装器不适合仅保留单个 Git 可执行程序的上游测试，最终运行使用系统 Git 优先的 PATH，154 项 host-workspace 测试通过。服务端 `maxWorkers: 1` 下 SDK 文档编译和插件安装 hook 通过；项目环境隔离功能用例独立复现通过但耗时 约 5 秒，仅该项给予 15 秒预算，保留全部断言。最终全 server 复验通过，没有跳过失败用例。

发布 tag、四平台 Release 资产与本地安装将由同一任务继续完成；本记录提交时尚未发生发布或服务替换，不以验证成功代替 Release 成功。
本地测试范围为所有包，排除需要 Electron 原生环境的 `@bb/desktop`。四个平台的后台运行时与 CLI 包由 `Release fork aggregate` 验证、构建和发布，不能替代 Electron 桌面安装包、Android/iOS 原生打包及设备上的 UI 检查。没有运行服务 cutover、生产数据迁移或 service restart。

[前一轮依赖修复报告](dependency-security-2026-10-03.md) 中的提交、测试数与聚合 SHA 属于 0.44 基线的历史证据，不能作为本次 0.45 发布结果。

## 并发登记保留

推送前，其他线程将 `fix/provider-icon-hitbox` 登记到远端 fork-tooling `47e612e2f`。该分支 `ce7ac840a` 已直接基于 `desktop-v0.45.0`，本地与 fork 一致且目录干净；本任务保留登记，最终聚合由 35 增至 36 分支。其产品差异只涉及 ProviderIcon 的 SVG 最小尺寸和复现 story，另行审查并对包含该分支的候选重跑 App 全量验证。产品分支采用已记录旧远端 SHA 的 lease 推送；fork-tooling 的 lease 使用新核对的远端 SHA，避免覆盖并发登记。

## 公开提交检查

本轮迁移后的稳定 tag 之外发布范围使用个人身份 `hxy91819 <masonxhuang@proton.me>`，未混入公司身份。全引用历史扫描也读到旧分支/备份中的历史身份，未把全引用扫描写成干净结果；本轮不改写归档历史或上游 tag。人工差异核查未发现新增凭据或私密日志；环境未安装 gitleaks，没有声称执行该扫描。

## 全锁文件剩余公告

下表逐项列出官方 bulk 接口按解析版本匹配的剩余范围。除已说明无补丁的 node-forge 外，其余包均在本次明确的目标名单之外，保持稳定基线解析版本，留待独立修复；没有进行全仓 update。公告匹配不等于每个用途都可实际利用。

| 包 | 匹配版本 | 公告数 | 严重度 | 官方公告 |
| --- | --- | ---: | --- | --- |
| `@babel/core` | 7.29.0 | 1 | low | [GHSA-4x5r-pxfx-6jf8](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8) |
| `@hono/node-server` | 1.19.14 | 1 | moderate | [GHSA-frvp-7c67-39w9](https://github.com/advisories/GHSA-frvp-7c67-39w9) |
| `@tiptap/core` | 2.27.2, 3.26.0 | 2 | high, moderate | [GHSA-cp6q-959q-f8rh](https://github.com/advisories/GHSA-cp6q-959q-f8rh), [GHSA-j95f-988m-3j2f](https://github.com/advisories/GHSA-j95f-988m-3j2f) |
| `@vitest/mocker` | 3.2.6, 4.1.1 | 1 | moderate | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) |
| `@xmldom/xmldom` | 0.8.13 | 10 | high, moderate | [GHSA-27p8-2357-5qqv](https://github.com/advisories/GHSA-27p8-2357-5qqv), [GHSA-4w3w-2rp5-g8jm](https://github.com/advisories/GHSA-4w3w-2rp5-g8jm), [GHSA-6gmq-8vp8-gcm6](https://github.com/advisories/GHSA-6gmq-8vp8-gcm6), [GHSA-6h8r-xr42-gp59](https://github.com/advisories/GHSA-6h8r-xr42-gp59), [GHSA-8344-3jmq-59r6](https://github.com/advisories/GHSA-8344-3jmq-59r6), [GHSA-93r5-fhx6-vmg9](https://github.com/advisories/GHSA-93r5-fhx6-vmg9), [GHSA-965w-775f-mr7g](https://github.com/advisories/GHSA-965w-775f-mr7g), [GHSA-c7q8-3ch8-vqpv](https://github.com/advisories/GHSA-c7q8-3ch8-vqpv), [GHSA-w2rr-34g9-rvrj](https://github.com/advisories/GHSA-w2rr-34g9-rvrj), [GHSA-x4fp-j954-r2f4](https://github.com/advisories/GHSA-x4fp-j954-r2f4) |
| `ajv` | 8.11.0 | 1 | moderate | [GHSA-2g4f-4pwh-qvx6](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6) |
| `baseline-browser-mapping` | 2.9.19 | 1 | moderate | [GHSA-w5vr-8v7q-w6rv](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv) |
| `braces` | 3.0.3 | 1 | high | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) |
| `browserslist` | 4.28.1 | 2 | high | [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g), [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) |
| `builder-util-runtime` | 9.5.1 | 1 | high | [GHSA-p2f4-r6v6-j797](https://github.com/advisories/GHSA-p2f4-r6v6-j797) |
| `decode-uri-component` | 0.2.2, 0.4.1 | 1 | moderate | [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) |
| `diff` | 7.0.0 | 1 | low | [GHSA-73rr-hh4g-fpgx](https://github.com/advisories/GHSA-73rr-hh4g-fpgx) |
| `dompurify` | 3.4.8, 3.4.9 | 4 | low, moderate | [GHSA-55q2-fjhq-7xh7](https://github.com/advisories/GHSA-55q2-fjhq-7xh7), [GHSA-c2j3-45gr-mqc4](https://github.com/advisories/GHSA-c2j3-45gr-mqc4), [GHSA-cmwh-pvxp-8882](https://github.com/advisories/GHSA-cmwh-pvxp-8882), [GHSA-vxr8-fq34-vvx9](https://github.com/advisories/GHSA-vxr8-fq34-vvx9) |
| `drizzle-orm` | 0.38.4 | 1 | high | [GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9) |
| `esbuild` | 0.18.20, 0.19.12 | 1 | moderate | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) |
| `fast-uri` | 3.1.3 | 8 | high, moderate | [GHSA-5jgf-p345-68v8](https://github.com/advisories/GHSA-5jgf-p345-68v8), [GHSA-7p8r-x3mc-p8w7](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7), [GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc), [GHSA-fph4-wmhf-6fwf](https://github.com/advisories/GHSA-fph4-wmhf-6fwf), [GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj), [GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp), [GHSA-qw65-cvwx-89v3](https://github.com/advisories/GHSA-qw65-cvwx-89v3), [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx) |
| `fflate` | 0.4.8 | 1 | moderate | [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98) |
| `form-data` | 4.0.5 | 1 | high | [GHSA-hmw2-7cc7-3qxx](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx) |
| `handlebars` | 4.7.8 | 8 | critical, high, low, moderate | [GHSA-2qvq-rjwj-gvw9](https://github.com/advisories/GHSA-2qvq-rjwj-gvw9), [GHSA-2w6w-674q-4c4q](https://github.com/advisories/GHSA-2w6w-674q-4c4q), [GHSA-3mfm-83xf-c92r](https://github.com/advisories/GHSA-3mfm-83xf-c92r), [GHSA-442j-39wm-28r2](https://github.com/advisories/GHSA-442j-39wm-28r2), [GHSA-7rx3-28cr-v5wh](https://github.com/advisories/GHSA-7rx3-28cr-v5wh), [GHSA-9cx6-37pm-9jff](https://github.com/advisories/GHSA-9cx6-37pm-9jff), [GHSA-xhpv-hc6g-r9c6](https://github.com/advisories/GHSA-xhpv-hc6g-r9c6), [GHSA-xjpj-3mr7-gcpf](https://github.com/advisories/GHSA-xjpj-3mr7-gcpf) |
| `hono` | 4.11.9, 4.12.28 | 36 | high, low, moderate | [GHSA-26pp-8wgv-hjvm](https://github.com/advisories/GHSA-26pp-8wgv-hjvm), [GHSA-2gcr-mfcq-wcc3](https://github.com/advisories/GHSA-2gcr-mfcq-wcc3), [GHSA-3hrh-pfw6-9m5x](https://github.com/advisories/GHSA-3hrh-pfw6-9m5x), [GHSA-458j-xx4x-4375](https://github.com/advisories/GHSA-458j-xx4x-4375), [GHSA-54fx-42gc-7vw4](https://github.com/advisories/GHSA-54fx-42gc-7vw4), [GHSA-5pq2-9x2x-5p6w](https://github.com/advisories/GHSA-5pq2-9x2x-5p6w), [GHSA-69xw-7hcm-h432](https://github.com/advisories/GHSA-69xw-7hcm-h432), [GHSA-79qm-7rj5-m7r9](https://github.com/advisories/GHSA-79qm-7rj5-m7r9), [GHSA-88fw-hqm2-52qc](https://github.com/advisories/GHSA-88fw-hqm2-52qc), [GHSA-8j4g-w8fx-2239](https://github.com/advisories/GHSA-8j4g-w8fx-2239), [GHSA-9vqf-7f2p-gf9v](https://github.com/advisories/GHSA-9vqf-7f2p-gf9v), [GHSA-crvj-82cr-hjcx](https://github.com/advisories/GHSA-crvj-82cr-hjcx), [GHSA-f23p-vx2j-j53r](https://github.com/advisories/GHSA-f23p-vx2j-j53r), [GHSA-f577-qrjj-4474](https://github.com/advisories/GHSA-f577-qrjj-4474), [GHSA-g6gw-c38x-mqfc](https://github.com/advisories/GHSA-g6gw-c38x-mqfc), [GHSA-gq3j-xvxp-8hrf](https://github.com/advisories/GHSA-gq3j-xvxp-8hrf), [GHSA-gqvv-2mrq-wpjv](https://github.com/advisories/GHSA-gqvv-2mrq-wpjv), [GHSA-hm8q-7f3q-5f36](https://github.com/advisories/GHSA-hm8q-7f3q-5f36), [GHSA-hvrm-45r6-mjfj](https://github.com/advisories/GHSA-hvrm-45r6-mjfj), [GHSA-hxh3-vqpv-xpqv](https://github.com/advisories/GHSA-hxh3-vqpv-xpqv), [GHSA-j6c9-x7qj-28xf](https://github.com/advisories/GHSA-j6c9-x7qj-28xf), [GHSA-p6xx-57qc-3wxr](https://github.com/advisories/GHSA-p6xx-57qc-3wxr), [GHSA-p77w-8qqv-26rm](https://github.com/advisories/GHSA-p77w-8qqv-26rm), [GHSA-q5qw-h33p-qvwr](https://github.com/advisories/GHSA-q5qw-h33p-qvwr), [GHSA-qp7p-654g-cw7p](https://github.com/advisories/GHSA-qp7p-654g-cw7p), [GHSA-r5rp-j6wh-rvv4](https://github.com/advisories/GHSA-r5rp-j6wh-rvv4), [GHSA-rv63-4mwf-qqc2](https://github.com/advisories/GHSA-rv63-4mwf-qqc2), [GHSA-v8w9-8mx6-g223](https://github.com/advisories/GHSA-v8w9-8mx6-g223), [GHSA-w62v-xxxg-mg59](https://github.com/advisories/GHSA-w62v-xxxg-mg59), [GHSA-wgpf-jwqj-8h8p](https://github.com/advisories/GHSA-wgpf-jwqj-8h8p), [GHSA-wmmm-f939-6g9c](https://github.com/advisories/GHSA-wmmm-f939-6g9c), [GHSA-wwfh-h76j-fc44](https://github.com/advisories/GHSA-wwfh-h76j-fc44), [GHSA-xf4j-xp2r-rqqx](https://github.com/advisories/GHSA-xf4j-xp2r-rqqx), [GHSA-xgm2-5f3f-mvvc](https://github.com/advisories/GHSA-xgm2-5f3f-mvvc), [GHSA-xpcf-pg52-r92g](https://github.com/advisories/GHSA-xpcf-pg52-r92g), [GHSA-xrhx-7g5j-rcj5](https://github.com/advisories/GHSA-xrhx-7g5j-rcj5) |
| `http-cache-semantics` | 4.2.0 | 1 | high | [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) |
| `image-size` | 1.2.1 | 2 | high | [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq), [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) |
| `ip-address` | 10.2.0 | 7 | high, moderate | [GHSA-22jq-vg5j-6vgg](https://github.com/advisories/GHSA-22jq-vg5j-6vgg), [GHSA-2vr4-cq9g-pvrc](https://github.com/advisories/GHSA-2vr4-cq9g-pvrc), [GHSA-4xrf-jv44-h6hh](https://github.com/advisories/GHSA-4xrf-jv44-h6hh), [GHSA-h3mg-xc3c-68pw](https://github.com/advisories/GHSA-h3mg-xc3c-68pw), [GHSA-j6r3-76f7-8jcv](https://github.com/advisories/GHSA-j6r3-76f7-8jcv), [GHSA-mwp4-54f8-5fhr](https://github.com/advisories/GHSA-mwp4-54f8-5fhr), [GHSA-rpw4-54j3-4h4q](https://github.com/advisories/GHSA-rpw4-54j3-4h4q) |
| `js-yaml` | 3.14.2, 4.1.1 | 4 | high, moderate | [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh), [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m), [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj), [GHSA-h67p-54hq-rp68](https://github.com/advisories/GHSA-h67p-54hq-rp68) |
| `mermaid` | 11.15.0 | 5 | low, moderate | [GHSA-2v8p-3f2j-5mp7](https://github.com/advisories/GHSA-2v8p-3f2j-5mp7), [GHSA-3rrr-jr9j-h3q3](https://github.com/advisories/GHSA-3rrr-jr9j-h3q3), [GHSA-6x64-9x62-f2gx](https://github.com/advisories/GHSA-6x64-9x62-f2gx), [GHSA-c4c3-pg64-4m4v](https://github.com/advisories/GHSA-c4c3-pg64-4m4v), [GHSA-rhh3-jpg6-66xh](https://github.com/advisories/GHSA-rhh3-jpg6-66xh) |
| `minimatch` | 5.1.2 | 3 | high | [GHSA-23c5-xmqv-rm74](https://github.com/advisories/GHSA-23c5-xmqv-rm74), [GHSA-3ppc-4f35-3m26](https://github.com/advisories/GHSA-3ppc-4f35-3m26), [GHSA-7r86-cg39-jmmj](https://github.com/advisories/GHSA-7r86-cg39-jmmj) |
| `nanoid` | 3.3.16, 3.3.8, 5.1.6 | 3 | high | [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv), [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8), [GHSA-xwg4-73v4-xw9w](https://github.com/advisories/GHSA-xwg4-73v4-xw9w) |
| `node-forge` | 1.4.0 | 1 | high | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) |
| `postcss` | 8.5.15 | 2 | high, moderate | [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) |
| `qs` | 6.15.3 | 2 | moderate | [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g), [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) |
| `react-router` | 7.13.0 | 12 | high, low, moderate | [GHSA-2j2x-hqr9-3h42](https://github.com/advisories/GHSA-2j2x-hqr9-3h42), [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg), [GHSA-49rj-9fvp-4h2h](https://github.com/advisories/GHSA-49rj-9fvp-4h2h), [GHSA-84g9-w2xq-vcv6](https://github.com/advisories/GHSA-84g9-w2xq-vcv6), [GHSA-8646-j5j9-6r62](https://github.com/advisories/GHSA-8646-j5j9-6r62), [GHSA-8x6r-g9mw-2r78](https://github.com/advisories/GHSA-8x6r-g9mw-2r78), [GHSA-chx6-hx7r-mcp5](https://github.com/advisories/GHSA-chx6-hx7r-mcp5), [GHSA-f22v-gfqf-p8f3](https://github.com/advisories/GHSA-f22v-gfqf-p8f3), [GHSA-h8fp-f39c-q6mh](https://github.com/advisories/GHSA-h8fp-f39c-q6mh), [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2), [GHSA-rxv8-25v2-qmq8](https://github.com/advisories/GHSA-rxv8-25v2-qmq8), [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) |
| `sharp` | 0.34.5 | 2 | high | [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) |
| `shell-quote` | 1.8.3 | 2 | critical, high | [GHSA-395f-4hp3-45gv](https://github.com/advisories/GHSA-395f-4hp3-45gv), [GHSA-w7jw-789q-3m8p](https://github.com/advisories/GHSA-w7jw-789q-3m8p) |
| `tar` | 7.5.19 | 1 | high | [GHSA-r292-9mhp-454m](https://github.com/advisories/GHSA-r292-9mhp-454m) |
| `ts-deepmerge` | 6.2.0 | 1 | moderate | [GHSA-87mf-gv2c-c62c](https://github.com/advisories/GHSA-87mf-gv2c-c62c) |
| `uuid` | 7.0.3, 8.3.2, 9.0.1 | 1 | moderate | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |
| `vite` | 8.0.12 | 2 | high, moderate | [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff), [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) |
| `vitest` | 3.2.6, 4.1.1 | 1 | moderate | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) |
| `yaml` | 2.6.0, 2.8.2 | 1 | moderate | [GHSA-48c2-rrv3-qjmp](https://github.com/advisories/GHSA-48c2-rrv3-qjmp) |

## 首次四平台发布失败后的补充

首次正式 `fork-package` 已将 36 分支聚合 `c7c7de56d07186920b5060738f32622cfe4e35f6` 提升并推送到 fork，通过 frozen install、102 个 typecheck、104 个测试流程任务和 50 个运行时构建任务，打 tag `fork-v0.45.0-20261003.1`。两个 Linux 平台的打包与解压运行时检查成功，但 macOS arm64 在独立运行时 npm 锁条目同步处失败，未发布完整 Release，也未安装或切换本机服务。

实际失败来自 macOS 的 `/var` 与 `/private/var` 目录别名：npm 的解析路径使用真实目录，package-lock 路径保留别名，按字符串计算 relative 产生了不存在的锁键。`fix/dependency-security` 的 `07c951f71` 对两端目录先 realpath，再计算并统一锁键分隔符；新增目录别名场景保留真实 HTTP、模式展开、硬链接与锁恢复断言。修复后的候选 `e202df9c5` 已完整通过 frozen install、102 个 typecheck 和 104 个测试流程任务，旧 tag 保留记录，后续发布使用新 tag。此补充记录时，修复审查和再次四平台发布仍未完成；不得把本地验证写成 Release 成功。
