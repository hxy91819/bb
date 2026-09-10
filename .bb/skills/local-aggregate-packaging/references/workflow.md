# 聚合打包工作流

## 1. 审计并请求决定

先 fetch 后运行状态脚本。对用户说明：

- 每个登记分支自上次打包以来的提交；
- 最新稳定版及其相对记录基线的提交、`origin/main` 自记录基线以来的提交（若找不到稳定版标签，明确说明）；
- 每个上游变更对现有特性的可能影响；
- 每个特性上游回馈 issue 的状态、反馈后的回复、关联 PR 状态及维护建议；
- 新发现 `feature/*`、`fix/*` 分支及其 worktree 状态；
- 已跟踪修改会阻止任何 rebase、cherry-pick、重建或部署。

所有本地 `feature/*`、`fix/*` worktree 默认纳入。不要询问是否纳入；在用户确认打包阶段后，为每个已提交且验证通过的新分支建立登记并打包。新分支必须先有上游 issue 或现有 issue 的反馈评论，并将链接记录进 `upstreamIssues`。存在未提交改动、进行中的 rebase/cherry-pick 或验证未完成时，不触碰该 worktree，标记为未就绪并在最终结果说明。

逐一阅读每个 `upstreamIssues` 的完整 issue、反馈后回复和关联 PR。issue 已关闭或 PR 已合并只是采纳候选，不等于功能已经等价：比较上游实现与本地分支的用户可见行为、数据和同步语义、边界条件及验证覆盖。然后给出一个明确建议：上游已完整覆盖时建议在验证上游版本后退役本地分支；部分覆盖或替代方案未成熟时建议保留或改造分支；没有采纳信号时建议继续维护。不要自动删除分支、撤销聚合提交或关闭 issue。

有上游变化时，推荐用户选择“逐分支同步并重建”。用户若明确选择不 rebase，可选择“基于当前本地基线继续增量打包”；结果必须保留 `lastIntegratedUpstreamCommit` 不变，并列出未同步上游提交。如果没有上游变化而只有源分支新增提交，推荐“直接增量打包”。必须先获得用户确认；一次确认只覆盖明确列出的分支和阶段。

## 2. 逐分支同步

在每个受影响分支自己的 worktree 执行：

```bash
git fetch origin --prune --tags
git -C <feature-worktree> status --short
git -C <feature-worktree> rebase --no-autostash origin/main
```

解决冲突、运行该特性的相关验证并提交任何修复。对已经推送到 fork 的分支，重写远端历史前必须明确获准，再用：

```bash
git -C <feature-worktree> push --force-with-lease fork <branch>
```

源分支 rebase 后，原先记录的源提交通常不再是其祖先。这不是增量 cherry-pick 的情形，必须走完整重建；不可把旧 SHA 直接写成新的“上次打包提交”。

## 3. 增量打包

只有满足以下条件才可增量打包：源分支的记录提交仍是当前 HEAD 的祖先、根工作区位于 `local/aggregate`、并且没有已跟踪修改。用户明确不 rebase 时，即使上游已有新提交也可走此路径；聚合仍以现有本地基线为准。

在根工作区逐个 cherry-pick 每个已确认分支的 `lastPackagedSourceCommit..HEAD`，保留 `-x`：

```bash
git cherry-pick -x <source-commit>
```

一个功能有多个提交时按其拓扑顺序逐个 pick。冲突意味着产品修复应回到源 worktree；中止 cherry-pick，修复并验证独立分支后重试。不要只在聚合层修复后继续。

首次打包的分支没有 `lastPackaged`。在根工作区以 `git merge-base local/aggregate <branch>` 找到共同基线，按拓扑顺序 cherry-pick 该基线到分支 HEAD 的提交；成功后再写入该分支首个 `lastPackaged` 记录。不要把当前 `origin/main` 的新提交误记为首次打包范围。

## 4. 完整重建

出现源分支历史改写、聚合基线变化或用户确认需要重新同步上游时，使用完整重建。先在临时集成 worktree 从 `origin/main` 创建候选分支，按确认后的源分支提交顺序 `cherry-pick -x`，并在该 worktree 完成验证。临时候选不能作为日常服务版本。

候选通过验证后，向用户展示候选 SHA、将被替换的 `local/aggregate` SHA、确切 feature 列表和验证结果，并取得**第二次明确确认**，才可用候选取代根工作区的 `local/aggregate`。替换前创建本地可恢复备份引用，且只在根工作区没有已跟踪修改时执行。因为该操作改写根工作区的已检出分支，必须由用户在该明确确认后授权具体命令；不得用自动化的 `reset --hard` 静默完成。

替换完成后，更新登记表和 `AGENTS.md` 的概览，将 `lastIntegratedUpstreamCommit` 更新为候选所基于的 `origin/main` 提交。

## 5. 记录与验证

每次成功增量打包或完整重建都更新。新发现并已打包的本地 `feature/*`、`fix/*` 分支在此时加入登记表：

- `config/local-aggregate-features.json`：每个已纳入分支的 `lastPackaged` 与 `upstreamIssues`；只有完整重建并采用新上游时才更新 `aggregate.lastIntegratedUpstreamCommit`；
- `AGENTS.md`：人工可读的分支、最后源提交和最后聚合提交；

从项目根目录运行与变更相称的 Turbo 测试与类型检查。准备更新服务时，再遵循 [本机聚合网页服务维护](../../../../docs/local-aggregate-web-maintenance.md)；它读取本机忽略的 JSON 配置，先使用其中锁定的 Node 22 `pnpm install --frozen-lockfile` 和 `pnpm build`，再重启 systemd 并以 loopback health check 和 `tailscale serve status` 验证。没有用户明确要求更新本机服务时，不读取私有配置，不构建或重启服务。
