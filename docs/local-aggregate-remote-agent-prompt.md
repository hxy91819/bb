# 远端 Agent 切换提示词

把下面代码块原样发给目标机器上的 Agent。它固定拉取个人 fork 的
`local/aggregate`，但实际主机路径、数据目录和 Tailnet 地址只从该机器的本机
JSON 读取。

```text
在这台机器上把 BB 网页服务切换到个人 fork 的 local/aggregate 分支。

目标代码来自 git@github.com:hxy91819/bb.git 的 local/aggregate；不要推送、不要创建 PR、不要操作 upstream origin。

请严格按仓库的 docs/local-aggregate-web-maintenance.md 执行，并遵守以下约束：

1. 先执行 git status --short、git worktree list 和 git remote -v；保留所有无关改动，绝不 stash、删除或重置它们。
2. 确认 fork remote 指向 git@github.com:hxy91819/bb.git。若 fork 不存在可添加它；若已存在但 URL 不同，停止并报告，不要覆盖。
3. 执行 git fetch fork local/aggregate。切换或快进本地 local/aggregate 到 fork/local/aggregate；若不能 fast-forward，停止并报告，不要强推、rebase 或覆盖本地历史。
4. 读取 config/local-aggregate-web.json。若它不存在，复制 config/local-aggregate-web.example.json 后停止，并报告仍需填写的本机值；不要把实际 JSON 加入 Git，也不要输出其中的内部 URL、路径、凭据或数据。
5. 使用 JSON 指定的持久 Node 22 可执行文件启用 Corepack、执行 pnpm install --frozen-lockfile 和 pnpm build。不要依赖交互 shell 的 nvm，也不要用 /tmp 的 Node 运行 systemd 服务。
6. 按维护文档和 JSON 更新 systemd drop-in，使服务从 JSON 的 repoPath 启动 scripts/start-bb.mjs，使用同一 dataDir、bindHost、serverPort 与 hostDaemonPort；随后 daemon-reload 并 restart 该服务。
7. 保持 Tailscale Serve 为 Tailnet-only，代理 JSON 的 serveTarget。不要启用 Funnel；不要把正式网页入口指到 scripts/bb-dev-app 的隔离开发端口或数据目录。
8. 验证 systemd 服务为 active、网页端口返回 HTTP 200、tailscale serve status 的目标正确；对一个既有项目或会话只检查 HTTP 状态，不输出其内容。

完成时只报告：部署的 commit、服务状态、Tailnet 代理目标，以及项目/会话检查的 HTTP 状态。若任一步不能安全完成，说明具体阻塞和已验证的状态。
```
