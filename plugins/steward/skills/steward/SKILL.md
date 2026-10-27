---
name: steward
description: 查看 BB 管家插件的文件绑定与检查结果；管家技能的脚本会自动登记，无须模型另行使用插件。
---

# 管家平台入口

日常启动按 bb-steward 的会话开始步骤执行，看门狗自动同步本地或 Git-ref 来源；无需额外登记或接任原管家。

诊断使用 `bb steward show --thread <id> --json` 查看绑定，`bb steward refresh --thread <id> --json` 在原 host 按需检查。解除使用 `bb steward unregister --thread <id>`。文件移动、标头入口或格式改变后重新执行原管家登记步骤。

本地登记：`bb steward register --thread <id> --topic <名称> --workbook <绝对路径> --ledger <绝对路径> --checker <steward_workbook.py绝对路径>`。

Git 登记：`bb steward register --thread <原id> --topic <名称> --repo <仓库绝对路径> --ref origin/<分支> --workbook <仓库相对路径> --ledger <仓库相对路径> --checker <脚本绝对路径> [--ledger-kind standard|history]`。两个 Git 参数必须同时提供；RPC 用 `source: {kind: "git", repo, ref}`，省略 source 兼容旧本地登记。接任只匹配同 host、主仓库、工作簿相对路径及来源/ref；不改线程标题、权限或看门狗。

`bb steward document --thread <id> --document workbook|ledger --json` 返回本地文件可用性或 Git 文档的第一页及 snapshot（repo/ref/SHA）。继续索引链接用 `--from <当前文档仓库相对路径> --target <相对链接> --sha <本次SHA>`，三个参数须一起提供；从目录导航时 `--from` 保留末尾 `/`。RPC document 对应用 `link: {from, target, sha}`。

主动打开/刷新 Git 先核远端，工作簿和帐按同一 SHA 读取；相对链接继续该 SHA。远端无法核实、ref 删除或超时即显示错误，不用磁盘或旧 ref 冒充最新。插件内展示 repo/ref/SHA，不生成持久正文副本。文件缺失于主工作区不影响读取 Git。

标准要求帐默认五列表检查。标头精确使用 `[要求帐（历史流水账）](相对索引.md)` 时传 `--ledger-kind history`，保留 Markdown 旧账及相对链接；检查结果 `applicable: false`、`ok: false`，统计不适用且无 summary，不代表失败的标准帐或零项通过。缺少标头入口会报缺口，不能凭 `check: true` 宣称入口齐全。

Git 目录与分页：

- `kind: "directory"` 返回 `entries: [{name, path, kind}]`，`kind: "file"` 返回 `content`；目录没有伪造的正文。索引中的 `2026-10/` 可进入月份目录，再按条目打开原分片；目录项中的 `unsupported` 为子模块等不可读对象。
- `--limit <256..65536>`（RPC `limit`）默认为 65536。文件的 limit、offset、total 单位为 UTF-8 字节，页尾退回完整 Unicode 字符边界；按顺序拼接各页 content 可还原正文。目录的 limit 是 entries JSON 的 UTF-8 字节预算，offset、total 单位为条目数；单个条目不可拆分，可能超过较小的 limit，但整次 CLI 输出仍小于 1 MiB。
- 每页 `next: {path, sha, offset}` 或 `null` 明示未完/完成。续读将整个 next 作为 `--cursor '<JSON>'`（RPC `cursor`），不要自行计算 Unicode offset；游标与 link 参数互斥。所有续页和目录导航固定游标/链接的 SHA，远端前进也不会换版本。CLI stdout+stderr 包括 JSON 转义和元数据均受限，默认大文档请求也返回可继续读取的第一页。
- UI 的“继续读取正文/目录”沿用同 SHA；“刷新远端文档”重新核远端并回到当前选定的工作簿/帐目入口。返回目录上级或入口索引沿用显示的 SHA。本地文件继续使用内建预览，不接受分页参数。

例如，先读索引，从输出取 SHA 后进入月份目录；从目录打开文件时保留 from 的目录斜杠：

```bash
bb steward document --thread <原id> --document ledger --json
bb steward document --thread <原id> --document ledger --from docs/steward/join-changes/README.md --target 2026-10/ --sha <首屏SHA> --json
bb steward document --thread <原id> --document ledger --from docs/steward/join-changes/2026-10/ --target <分片名.md> --sha <首屏SHA> --json
bb steward document --thread <原id> --document ledger --from docs/steward/join-changes/README.md --target ../join-changes.md --sha <首屏SHA> --limit 65536 --json
bb steward document --thread <原id> --document ledger --cursor '{"path":"docs/steward/join-changes.md","sha":"<上页next.sha>","offset":65536}' --limit 65536 --json
```

最后一行的整个 JSON 应复制实际返回的 next；offset 可能因 Unicode 边界而小于 65536。保存每页解析后的 content，不把 CLI JSON 本身拼进正文，直到 next 为 null。省略 cursor/link 的新打开操作才会核远端。
