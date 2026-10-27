# 管家

管家技能的看门狗自动登记原会话的工作簿和要求帐；标题列和浮窗提供两个入口，摘要按需执行 Python 检查。线程 metadata 是绑定唯一来源，重载、重连、环境切换及同线程重新登记保留原 host 与来源。

本地模式保留绝对路径和 BB 文件预览，旧 metadata 可继续读取。Git 模式登记 `source: { kind: "git", repo, ref }`，其中 repo 是所属 host 上的仓库绝对路径，ref 是显式 `远端/分支`，workbook/ledger 为规范仓库相对路径。checker 始终为本机脚本绝对路径。CLI 与 RPC 使用同一契约和实现；同目标匹配包含 host、Git 主仓库、工作簿相对路径、来源类型和 Git ref，不跨主机接管。

每次主动打开或刷新先用 `ls-remote` 核实分支 SHA，再 fetch 此对象，不更新工作区或 tracking ref。工作簿、要求帐和正文中的相对链接使用同一 SHA；相对链接是该次阅读的延续，“刷新远端文档”才重新核实。远端失败、删除和超时明确报不能核实，不显示旧 ref 或本地副本。Git 正文在插件内只读展示，显示 repo/ref/SHA，不生成持久文档副本。目录链接（例如 `2026-10/`）列出带类型的目录项，可继续进入子目录、分片文件或上级目录；目录不会被当作正文。仅仓库内相对链接可继续打开；一般外部材料链接不会被当作本地文件。

`ledgerKind` 默认 `standard`，继续标准五列表校验；工作簿标头的 `[要求帐（历史流水账）](相对索引.md)` 对应显式 `history`。历史索引和原账可打开，标准统计不适用，无伪造的零计数或通过。标头缺入口、来源/格式变化、文件缺失会报告缺口；格式检查不能证明业务验收。

`bb steward --help` 列出 register、show、unregister、refresh、document；参数见随插件的 steward skill。Git 检查需要配套 bb-steward checker 支持 `--repo --revision`。每个 Git 子进程限时 15 秒、单文件和原始目录清单读取上限 6 MiB；超限/超时返回错误。Git document 的 CLI/RPC 共用分页契约，默认首屏也会分页，每页含来源、类型、进度及明确的 `next` 游标或 `null`。UI 显示尚未完整读取并提供继续按钮。文件按 UTF-8 字节切页，不切断 Unicode 字符；目录分页列出完整条目，不截断名称。JSON 转义及元数据包含在 CLI 的输出边界内。完整参数、单位及续读示例见插件 skill。

构建使用 `bb plugin build <插件目录>`，安装使用 `bb plugin install <完整插件目录> --yes`。此插件依赖独立安装的 bb-steward 技能，不加入官方商店。发布由安装方执行；仅构建不改变运行中的服务或插件。
