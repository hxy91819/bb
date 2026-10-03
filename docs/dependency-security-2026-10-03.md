# 2026-10-03 依赖漏洞修复核查

基线保持 `desktop-v0.44.0`（`0baa605b32a00619c1d7e3f32be6553ebcf8244a`）。修复提交为 `fca04ec1e`，分支为 `fix/dependency-security`，从稳定 tag 独立创建。上游已发布 `desktop-v0.45.0`，本轮没有升级基线。

## 修复版本与真实路径

| 包 | 原锁定版本 | 本轮锁定版本 | 主要依赖路径 |
| --- | --- | --- | --- |
| `@grpc/grpc-js` | 1.14.4 | 1.14.5 | Modal sandbox → modal → nice-grpc |
| `undici` | 7.28.0 | 7.29.1 | CLI；host daemon → CLI；account-pool；push-notifications；jsdom；Cloudflare miniflare；Electron 下载工具 |
| `undici` | 6.28.0 | 6.28.1 | Electron rebuild → node-gyp |
| `undici` | 8.9.0 | 8.10.2 | provider-pi 开发依赖 → pi-coding-agent |
| `markdown-it` | 14.3.0 | 14.3.2 | Docs / Tasks → Tiptap PM → prosemirror-markdown；tiptap-markdown |
| `brace-expansion` | 1.1.18 | 1.1.21 | minimatch 3 → Electron asar / rebuild 工具链 |
| `brace-expansion` | 2.1.2、2.1.4 | 2.1.7 | EAS CLI → minimatch 5；Pi AI → gaxios → glob / minimatch 9 |
| `brace-expansion` | 5.0.7、5.0.9 | 5.0.12 | 根工作区 rimraf / glob（包括服务端构建清理）；Electron builder；Pi 开发依赖 |
| `joi` | 17.11.0、17.13.6 | 17.13.8 | EAS CLI；Expo config / prebuild / doctor |
| `moment` | 2.30.1 | 2.31.0 | EAS CLI → Expo logger → bunyan |

范围 override 保留各主版本，仅覆盖低于本轮修复版本的范围。三处直接 `undici` 声明固定为 `7.29.1`，防止重新解析时顺带升到新的 minor。锁文件由 `pnpm 9.15.0 install --lockfile-only --ignore-scripts` 生成，再执行 frozen install；未执行全仓 update。锁文件中目标包仅剩表中修复版本，`pnpm -r why` 已复核运行、开发及工具链路径。

## 公告与核查范围

核查使用 npm 官方 registry 的 `POST /-/npm/v1/security/advisories/bulk`，分别提交旧版/候选版、修复后目标版本和全部锁定 npm 包版本。使用 semver 将公告影响范围与实际锁定版本相交，统计包/公告关系，不统计依赖路径重复实例，也不等同于 npm/pnpm audit 的依赖实例计数或可利用性分析。

完整 `pnpm audit --json` 尝试因约 2 GiB JavaScript 堆内存耗尽以退出码 134 失败，没有完整 audit 结果。官方接口目标核查仅剩 `node-forge`；以下全锁文件残余表包含范围外依赖，不能称为“全仓库审计通过”。本轮遵循指定最小范围，不将这些包的额外升级混入依赖修复。

修复依据包括 [gRPC](https://github.com/advisories/GHSA-m9gg-hp2v-232j)、[undici](https://github.com/nodejs/undici/security/advisories/GHSA-rfgv-xxqx-mfg5)、[Markdown](https://github.com/advisories/GHSA-253c-mchw-3w2r)、[brace-expansion](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr)、[Joi](https://github.com/advisories/GHSA-6h2x-m376-mqjq)、[Moment](https://github.com/advisories/GHSA-4p3w-j4w9-5jqw) 官方公告。

### node-forge 与外部 Pi

npm 最新 `node-forge` 仍为 `1.4.0`，没有可安装补丁版。[GHSA-86w9-cpqp-85rv / CVE-2026-85393](https://github.com/advisories/GHSA-86w9-cpqp-85rv) 影响 RSA PKCS#1 v1.5 签名验证：嵌套 DigestAlgorithm 多余元素可导致低指数 RSA 密钥的签名伪造。保留 `1.4.0`，没有降级或声称修复。实际路径为 mobile → Expo CLI → code-signing-certificates，以及 mobile → EAS CLI → node-forge / code-signing-certificates，涉及证书和代码签名工具。

外部 `pi` 可执行程序对应安装包 `@earendil-works/pi-coding-agent@1.0.0`；包声明、npm-shrinkwrap 和已安装模块均为 `undici@8.10.2`。该安装另有 `brace-expansion@5.0.9`，官方接口返回三条仍适用公告（栈耗尽和 CPU DoS）。仓库 override 只修复仓库 Pi 开发/测试依赖，没有修改外部安装；也没有对外部 Pi 完整依赖或内嵌 bundle 做全量审计。

## 行为验证

- frozen install 通过；本机验证使用 Node `24.15.0` 和 pnpm `9.15.0`。
- 本地真实 HTTP smoke：分别从 CLI、account-pool 和 push-notifications 加载各自的 undici，验证两次请求共用连接、503 响应正文和取消请求；账号池和推送另经真实 CONNECT 代理，共两个代理隧道。
- gRPC smoke：使用实际 `grpc-js@1.14.5` 完成本地 unary RPC 往返及 INVALID_ARGUMENT 错误状态返回。
- Markdown smoke：`linkify: true` 下渲染官方两组 4 万次重复输入，软换行邮箱约 380 ms，未知 scheme 约 32 ms；链接、加粗、拒绝 javascript URL 行为通过。

Turbo 在 `scripts/run-resource-isolated --profile package` 下以 `--concurrency=1` 完成 typecheck / test / build：26 个任务成功，其中 3 个缓存命中。8 个受影响包的类型检查全部通过；CLI、host daemon、Docs 与 Tasks 构建通过，其余四个插件没有独立 build 脚本，已完成类型检查和测试。

| 包 | 行为测试通过 | 跳过 |
| --- | --- | --- |
| CLI | 863 | 0 |
| host daemon | 746 | 1 |
| account-pool | 313 | 0 |
| push-notifications | 20 | 0 |
| Modal sandbox | 63 | 0 |
| Docs | 103 | 0 |
| Tasks | 394 | 0 |
| Pi bridge | 173 | 1 |

合计 2675 个测试通过、2 个跳过。覆盖 CLI 真实请求与错误、账号池 HTTP/1.1 TLS 协商与取消及失败 POST 不重放、推送发送/错误处理、Modal 资源与配置、笔记/任务 Markdown 表格和编辑保存渲染、Pi RPC 与会话桥接。

没有执行认证后的 Modal 云沙箱创建、真实 Expo 推送、外部 Pi 模型调用、独立浏览器手动编辑流程、原生 iOS/Android/EAS 构建、桌面安装包和 macOS/Windows 打包。Pi Bun runtime 用例因本机没有 Bun 而跳过；host daemon 的 macOS fd cleanup 用例因本机是 Linux 而跳过。组件测试与本地协议 smoke 不代表这些未执行的平台/外部服务检查通过。

## 审查与源码交付

`$autoreview` 经 `$bb-model-routing` 按 medium 派发，线程 `thr_vsh54m6gmt`（acp-amp / medium / medium）完整审查五个依赖文件的 `git diff desktop-v0.44.0`，结果无 P0/P1 可操作发现。主 Agent 核实目标安装版本及官方接口结果。维护登记、报告和聚合脚本的 `--no-autostash` 改动另行审查。

只向个人远端 `fork` 推送；上游 issue / PR 未提交。源码聚合采用 `.fork/branches` 与 `scripts/fork-aggregate` 的 merge 流程，没有 cherry-pick。当前运行服务没有替换；源码提交和聚合不会自动更新独立部署目录中的服务。本轮交付源码和验证结果，没有发布新的预编译 runtime Release。

## 修复分支全锁文件残余公告

共 146 条包/公告关系，涉及 39 个包；后续聚合另保留既有 Vite 修复分支。除 node-forge 无补丁外，其余均为指定范围外，留待独立修复。

| 包 | 受影响锁定版本 | 数量 / 严重度 | 公告 |
| --- | --- | --- | --- |
| `@babel/core` | 7.29.0 | 1 / low | [GHSA-4x5r-pxfx-6jf8](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8) |
| `@hono/node-server` | 1.19.14 | 1 / moderate | [GHSA-frvp-7c67-39w9](https://github.com/advisories/GHSA-frvp-7c67-39w9) |
| `@tiptap/core` | 2.27.2, 3.26.0 | 2 / high, moderate | [GHSA-cp6q-959q-f8rh](https://github.com/advisories/GHSA-cp6q-959q-f8rh), [GHSA-j95f-988m-3j2f](https://github.com/advisories/GHSA-j95f-988m-3j2f) |
| `@vitest/mocker` | 3.2.6, 4.1.1 | 1 / moderate | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) |
| `@xmldom/xmldom` | 0.8.13 | 10 / high, moderate | [GHSA-6gmq-8vp8-gcm6](https://github.com/advisories/GHSA-6gmq-8vp8-gcm6), [GHSA-w2rr-34g9-rvrj](https://github.com/advisories/GHSA-w2rr-34g9-rvrj), [GHSA-4w3w-2rp5-g8jm](https://github.com/advisories/GHSA-4w3w-2rp5-g8jm), [GHSA-c7q8-3ch8-vqpv](https://github.com/advisories/GHSA-c7q8-3ch8-vqpv), [GHSA-27p8-2357-5qqv](https://github.com/advisories/GHSA-27p8-2357-5qqv), [GHSA-6h8r-xr42-gp59](https://github.com/advisories/GHSA-6h8r-xr42-gp59), [GHSA-8344-3jmq-59r6](https://github.com/advisories/GHSA-8344-3jmq-59r6), [GHSA-x4fp-j954-r2f4](https://github.com/advisories/GHSA-x4fp-j954-r2f4), [GHSA-965w-775f-mr7g](https://github.com/advisories/GHSA-965w-775f-mr7g), [GHSA-93r5-fhx6-vmg9](https://github.com/advisories/GHSA-93r5-fhx6-vmg9) |
| `ajv` | 8.11.0 | 1 / moderate | [GHSA-2g4f-4pwh-qvx6](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6) |
| `baseline-browser-mapping` | 2.9.19 | 1 / moderate | [GHSA-w5vr-8v7q-w6rv](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv) |
| `braces` | 3.0.3 | 1 / high | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) |
| `browserslist` | 4.28.1 | 2 / high | [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx), [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) |
| `builder-util-runtime` | 9.5.1 | 1 / high | [GHSA-p2f4-r6v6-j797](https://github.com/advisories/GHSA-p2f4-r6v6-j797) |
| `decode-uri-component` | 0.2.2, 0.4.1 | 1 / moderate | [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) |
| `diff` | 7.0.0 | 1 / low | [GHSA-73rr-hh4g-fpgx](https://github.com/advisories/GHSA-73rr-hh4g-fpgx) |
| `dompurify` | 3.4.8, 3.4.9 | 4 / low, moderate | [GHSA-cmwh-pvxp-8882](https://github.com/advisories/GHSA-cmwh-pvxp-8882), [GHSA-vxr8-fq34-vvx9](https://github.com/advisories/GHSA-vxr8-fq34-vvx9), [GHSA-c2j3-45gr-mqc4](https://github.com/advisories/GHSA-c2j3-45gr-mqc4), [GHSA-55q2-fjhq-7xh7](https://github.com/advisories/GHSA-55q2-fjhq-7xh7) |
| `drizzle-orm` | 0.38.4 | 1 / high | [GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9) |
| `esbuild` | 0.18.20, 0.19.12 | 1 / moderate | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) |
| `fast-uri` | 3.1.3 | 8 / high, moderate | [GHSA-5jgf-p345-68v8](https://github.com/advisories/GHSA-5jgf-p345-68v8), [GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc), [GHSA-fph4-wmhf-6fwf](https://github.com/advisories/GHSA-fph4-wmhf-6fwf), [GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp), [GHSA-7p8r-x3mc-p8w7](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7), [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx), [GHSA-qw65-cvwx-89v3](https://github.com/advisories/GHSA-qw65-cvwx-89v3), [GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) |
| `fflate` | 0.4.8 | 1 / moderate | [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98) |
| `form-data` | 4.0.5 | 1 / high | [GHSA-hmw2-7cc7-3qxx](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx) |
| `handlebars` | 4.7.8 | 8 / critical, high, low, moderate | [GHSA-3mfm-83xf-c92r](https://github.com/advisories/GHSA-3mfm-83xf-c92r), [GHSA-2w6w-674q-4c4q](https://github.com/advisories/GHSA-2w6w-674q-4c4q), [GHSA-2qvq-rjwj-gvw9](https://github.com/advisories/GHSA-2qvq-rjwj-gvw9), [GHSA-7rx3-28cr-v5wh](https://github.com/advisories/GHSA-7rx3-28cr-v5wh), [GHSA-442j-39wm-28r2](https://github.com/advisories/GHSA-442j-39wm-28r2), [GHSA-xhpv-hc6g-r9c6](https://github.com/advisories/GHSA-xhpv-hc6g-r9c6), [GHSA-9cx6-37pm-9jff](https://github.com/advisories/GHSA-9cx6-37pm-9jff), [GHSA-xjpj-3mr7-gcpf](https://github.com/advisories/GHSA-xjpj-3mr7-gcpf) |
| `hono` | 4.11.9, 4.12.28 | 36 / high, low, moderate | [GHSA-qp7p-654g-cw7p](https://github.com/advisories/GHSA-qp7p-654g-cw7p), [GHSA-hm8q-7f3q-5f36](https://github.com/advisories/GHSA-hm8q-7f3q-5f36), [GHSA-p77w-8qqv-26rm](https://github.com/advisories/GHSA-p77w-8qqv-26rm), [GHSA-9vqf-7f2p-gf9v](https://github.com/advisories/GHSA-9vqf-7f2p-gf9v), [GHSA-69xw-7hcm-h432](https://github.com/advisories/GHSA-69xw-7hcm-h432), [GHSA-gq3j-xvxp-8hrf](https://github.com/advisories/GHSA-gq3j-xvxp-8hrf), [GHSA-xrhx-7g5j-rcj5](https://github.com/advisories/GHSA-xrhx-7g5j-rcj5), [GHSA-3hrh-pfw6-9m5x](https://github.com/advisories/GHSA-3hrh-pfw6-9m5x), [GHSA-f577-qrjj-4474](https://github.com/advisories/GHSA-f577-qrjj-4474), [GHSA-2gcr-mfcq-wcc3](https://github.com/advisories/GHSA-2gcr-mfcq-wcc3), [GHSA-5pq2-9x2x-5p6w](https://github.com/advisories/GHSA-5pq2-9x2x-5p6w), [GHSA-p6xx-57qc-3wxr](https://github.com/advisories/GHSA-p6xx-57qc-3wxr), [GHSA-q5qw-h33p-qvwr](https://github.com/advisories/GHSA-q5qw-h33p-qvwr), [GHSA-8j4g-w8fx-2239](https://github.com/advisories/GHSA-8j4g-w8fx-2239), [GHSA-458j-xx4x-4375](https://github.com/advisories/GHSA-458j-xx4x-4375), [GHSA-r5rp-j6wh-rvv4](https://github.com/advisories/GHSA-r5rp-j6wh-rvv4), [GHSA-xf4j-xp2r-rqqx](https://github.com/advisories/GHSA-xf4j-xp2r-rqqx), [GHSA-wmmm-f939-6g9c](https://github.com/advisories/GHSA-wmmm-f939-6g9c), [GHSA-xpcf-pg52-r92g](https://github.com/advisories/GHSA-xpcf-pg52-r92g), [GHSA-rv63-4mwf-qqc2](https://github.com/advisories/GHSA-rv63-4mwf-qqc2), [GHSA-wgpf-jwqj-8h8p](https://github.com/advisories/GHSA-wgpf-jwqj-8h8p), [GHSA-88fw-hqm2-52qc](https://github.com/advisories/GHSA-88fw-hqm2-52qc), [GHSA-wwfh-h76j-fc44](https://github.com/advisories/GHSA-wwfh-h76j-fc44), [GHSA-j6c9-x7qj-28xf](https://github.com/advisories/GHSA-j6c9-x7qj-28xf), [GHSA-xgm2-5f3f-mvvc](https://github.com/advisories/GHSA-xgm2-5f3f-mvvc), [GHSA-hvrm-45r6-mjfj](https://github.com/advisories/GHSA-hvrm-45r6-mjfj), [GHSA-w62v-xxxg-mg59](https://github.com/advisories/GHSA-w62v-xxxg-mg59), [GHSA-v8w9-8mx6-g223](https://github.com/advisories/GHSA-v8w9-8mx6-g223), [GHSA-f23p-vx2j-j53r](https://github.com/advisories/GHSA-f23p-vx2j-j53r), [GHSA-79qm-7rj5-m7r9](https://github.com/advisories/GHSA-79qm-7rj5-m7r9), [GHSA-54fx-42gc-7vw4](https://github.com/advisories/GHSA-54fx-42gc-7vw4), [GHSA-gqvv-2mrq-wpjv](https://github.com/advisories/GHSA-gqvv-2mrq-wpjv), [GHSA-g6gw-c38x-mqfc](https://github.com/advisories/GHSA-g6gw-c38x-mqfc), [GHSA-crvj-82cr-hjcx](https://github.com/advisories/GHSA-crvj-82cr-hjcx), [GHSA-26pp-8wgv-hjvm](https://github.com/advisories/GHSA-26pp-8wgv-hjvm), [GHSA-hxh3-vqpv-xpqv](https://github.com/advisories/GHSA-hxh3-vqpv-xpqv) |
| `http-cache-semantics` | 4.2.0 | 1 / high | [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) |
| `image-size` | 1.2.1 | 2 / high | [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq), [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) |
| `ip-address` | 10.2.0 | 7 / high, moderate | [GHSA-mwp4-54f8-5fhr](https://github.com/advisories/GHSA-mwp4-54f8-5fhr), [GHSA-4xrf-jv44-h6hh](https://github.com/advisories/GHSA-4xrf-jv44-h6hh), [GHSA-22jq-vg5j-6vgg](https://github.com/advisories/GHSA-22jq-vg5j-6vgg), [GHSA-rpw4-54j3-4h4q](https://github.com/advisories/GHSA-rpw4-54j3-4h4q), [GHSA-2vr4-cq9g-pvrc](https://github.com/advisories/GHSA-2vr4-cq9g-pvrc), [GHSA-j6r3-76f7-8jcv](https://github.com/advisories/GHSA-j6r3-76f7-8jcv), [GHSA-h3mg-xc3c-68pw](https://github.com/advisories/GHSA-h3mg-xc3c-68pw) |
| `js-yaml` | 3.14.2, 4.1.1 | 8 / high, moderate | [GHSA-h67p-54hq-rp68](https://github.com/advisories/GHSA-h67p-54hq-rp68), [GHSA-h67p-54hq-rp68](https://github.com/advisories/GHSA-h67p-54hq-rp68), [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m), [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m), [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj), [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj), [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh), [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) |
| `mermaid` | 11.15.0 | 5 / low, moderate | [GHSA-c4c3-pg64-4m4v](https://github.com/advisories/GHSA-c4c3-pg64-4m4v), [GHSA-6x64-9x62-f2gx](https://github.com/advisories/GHSA-6x64-9x62-f2gx), [GHSA-3rrr-jr9j-h3q3](https://github.com/advisories/GHSA-3rrr-jr9j-h3q3), [GHSA-2v8p-3f2j-5mp7](https://github.com/advisories/GHSA-2v8p-3f2j-5mp7), [GHSA-rhh3-jpg6-66xh](https://github.com/advisories/GHSA-rhh3-jpg6-66xh) |
| `minimatch` | 5.1.2 | 3 / high | [GHSA-3ppc-4f35-3m26](https://github.com/advisories/GHSA-3ppc-4f35-3m26), [GHSA-7r86-cg39-jmmj](https://github.com/advisories/GHSA-7r86-cg39-jmmj), [GHSA-23c5-xmqv-rm74](https://github.com/advisories/GHSA-23c5-xmqv-rm74) |
| `nanoid` | 3.3.16, 3.3.8, 5.1.6 | 5 / high | [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv), [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv), [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8), [GHSA-xwg4-73v4-xw9w](https://github.com/advisories/GHSA-xwg4-73v4-xw9w), [GHSA-xwg4-73v4-xw9w](https://github.com/advisories/GHSA-xwg4-73v4-xw9w) |
| `node-forge` | 1.4.0 | 1 / high | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) |
| `postcss` | 8.5.15 | 2 / high, moderate | [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) |
| `qs` | 6.15.3 | 2 / moderate | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) |
| `react-router` | 7.13.0 | 12 / high, low, moderate | [GHSA-49rj-9fvp-4h2h](https://github.com/advisories/GHSA-49rj-9fvp-4h2h), [GHSA-8646-j5j9-6r62](https://github.com/advisories/GHSA-8646-j5j9-6r62), [GHSA-8x6r-g9mw-2r78](https://github.com/advisories/GHSA-8x6r-g9mw-2r78), [GHSA-rxv8-25v2-qmq8](https://github.com/advisories/GHSA-rxv8-25v2-qmq8), [GHSA-84g9-w2xq-vcv6](https://github.com/advisories/GHSA-84g9-w2xq-vcv6), [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6), [GHSA-h8fp-f39c-q6mh](https://github.com/advisories/GHSA-h8fp-f39c-q6mh), [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg), [GHSA-chx6-hx7r-mcp5](https://github.com/advisories/GHSA-chx6-hx7r-mcp5), [GHSA-2j2x-hqr9-3h42](https://github.com/advisories/GHSA-2j2x-hqr9-3h42), [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2), [GHSA-f22v-gfqf-p8f3](https://github.com/advisories/GHSA-f22v-gfqf-p8f3) |
| `sharp` | 0.34.5 | 2 / high | [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) |
| `shell-quote` | 1.8.3 | 2 / critical, high | [GHSA-w7jw-789q-3m8p](https://github.com/advisories/GHSA-w7jw-789q-3m8p), [GHSA-395f-4hp3-45gv](https://github.com/advisories/GHSA-395f-4hp3-45gv) |
| `tar` | 7.5.19 | 1 / high | [GHSA-r292-9mhp-454m](https://github.com/advisories/GHSA-r292-9mhp-454m) |
| `ts-deepmerge` | 6.2.0 | 1 / moderate | [GHSA-87mf-gv2c-c62c](https://github.com/advisories/GHSA-87mf-gv2c-c62c) |
| `uuid` | 7.0.3, 8.3.2, 9.0.1 | 1 / moderate | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |
| `vite` | 6.4.1, 8.0.12 | 6 / high, moderate | [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3), [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3), [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9), [GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583), [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff), [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) |
| `vitest` | 3.2.6, 4.1.1 | 1 / moderate | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) |
| `yaml` | 2.6.0, 2.8.2 | 1 / moderate | [GHSA-48c2-rrv3-qjmp](https://github.com/advisories/GHSA-48c2-rrv3-qjmp) |

