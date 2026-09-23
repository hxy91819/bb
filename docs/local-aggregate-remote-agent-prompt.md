# 远端 Agent 切换提示词

把下面代码块连同用户指定的不可变聚合发布 ref 和外部发布凭据路径发给目标机器上的
Agent。实际主机路径、数据目录和 Tailnet 地址只从该机器的本机 JSON 读取。

```text
在这台机器上从个人 fork 的指定不可变发布 ref 准备 BB 网页服务。只有本次请求已经明确授权服务切换时才执行切换；否则完成源码取得和构建准备后停止。

输入必须包含 IMMUTABLE_RELEASE_REF 和 RELEASE_CREDENTIAL_PATH。发布 ref 必须是聚合根分支完成并推送后创建的 refs/tags/fork-release/*；仅有 fork-candidate/* 不足以打包。目标代码来自 git@github.com:hxy91819/bb.git；不要用可变的 local/aggregate 代替指定 ref，不要推送、不要创建 PR、不要操作 upstream origin。

请严格按仓库的 docs/local-aggregate-web-maintenance.md 执行，并遵守以下约束：

1. 先执行 git status --short、git worktree list 和 git remote -v；保留现有工作区的全部改动，绝不 stash、删除、重置或在其中构建候选。
2. 确认 fork remote 指向 git@github.com:hxy91819/bb.git。若 fork 不存在可添加它；若已存在但 URL 不同，停止并报告，不要覆盖。
3. 读取 RELEASE_CREDENTIAL_PATH，取得发布 ref、候选 ref、已推送的聚合 commit、精确源码 commit 及 Node/pnpm 工具链。要求发布 ref 与 IMMUTABLE_RELEASE_REF 相同，聚合 commit 与源码 commit 相同。分别获取发布 ref 和候选 ref 到同名本地 ref，并用 `git rev-parse <ref>^{commit}` 核对两者都等于凭据 commit；字段缺失或不一致就停止。发布凭据还须记录发布端已核对 `local/aggregate`、`fork/local/aggregate` 与候选 commit 相同；打包前再用 `git ls-remote fork refs/heads/local/aggregate` 读取当前远端 SHA，要求它仍等于凭据 commit。不要打印凭据中的秘密或本机值。
4. 在现有 repoPath 之外的新路径执行 `git worktree add --detach <new-clean-worktree> <credentialed-commit>`。要求新 worktree 在安装前 `git status --porcelain --untracked-files=all` 为空，并再次核对 HEAD；不要切换、快进或复用带本地改动的 worktree。
5. 未指定目标时读取现有工作区的 config/local-aggregate-web.json；指定目标时读取 config/local-aggregate-web.<target>.json。若它不存在，复制 config/local-aggregate-web.example.json 后停止，并报告仍需填写的本机值；不要把实际 JSON 加入 Git，也不要输出其中的内部 URL、路径、凭据或数据。
6. 使用持久 Node 可执行文件。它必须满足 package.json 的 engines，并与发布凭据记录的构建运行时兼容；凭据锁定 Node 24.15.0 时使用持久 Node 24.15.0，不要降级到 `.nvmrc` 的最低默认值。pnpm 版本必须匹配 packageManager 和凭据。不要依赖交互 shell 的 nvm，也不要用 /tmp 的 Node 运行 systemd 服务。
7. 在新 worktree 为这台机器重新执行 frozen 安装和 `.bb/skills/local-aggregate-deploy/SKILL.md` 的串行运行时预构建。构建命令须传入 `--aggregate-ref "$IMMUTABLE_RELEASE_REF" --candidate-ref <credentialed-candidate-ref>`；构建脚本会再次核对两个 ref、HEAD 与当前 fork 聚合 SHA。不得复制另一机器的 node_modules、原生模块或构建产物；必须重新生成本机原生 ABI，并通过 `scripts/ensure-native-modules.mjs --check`。不要以全仓库构建替代该门禁。
8. 没有明确服务部署授权时，在源码 SHA 核对、安装、构建及 ABI 检查完成后停止；不要修改本机 JSON、systemd 或 Tailscale，不要 reload、restart 或 stop 服务。报告已准备的 commit 和未执行的切换即可。
9. 已有明确服务部署授权时，继续遵守部署技能的外部 Agent、检查点和健康门禁。把所选本机 JSON 的 repoPath 更新为新 clean worktree，并更新 systemd drop-in。唯一常驻入口是 `<nodeExecutable> --conditions=source --import tsx packages/bb-app/src/bin/bb-app.ts`，参数使用同一 JSON 的 dataDir、bindHost、serverPort 与 hostDaemonPort；不要使用 scripts/start-bb.mjs。随后 daemon-reload，并按该技能切换服务。
10. 保持 Tailscale Serve 为 Tailnet-only，代理 JSON 的 serveTarget。不要启用 Funnel；不要把正式网页入口指到 scripts/bb-dev-app 的隔离开发端口或数据目录。
11. 验证 systemd 服务为 active、运行进程的工作目录等于所选 JSON 的 repoPath、运行 commit 等于凭据 commit、网页端口返回 HTTP 200、tailscale serve status 的目标正确；对一个既有项目或会话只检查 HTTP 状态，不输出其内容。

完成时只报告：凭据 ref 和 commit 的核对结果、准备或部署的 commit、服务是否保持未变或已完成授权切换、Tailnet 代理目标，以及已执行健康检查的 HTTP 状态。若任一步不能安全完成，说明具体阻塞和已验证的状态。
```
