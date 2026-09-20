# 本机聚合网页服务维护

本说明适用于把 `local/aggregate` 作为本机 Tailnet 网页服务运行的场景。
它是本地运维资料：可以在本地 Git 提交。只有在明确授权后才可推送到个人 fork；绝不推送到上游 `origin`，也不要从聚合分支创建上游 PR。

## 文件与保密边界

| 文件 | Git 状态 | 用途 |
| --- | --- | --- |
| `docs/local-aggregate-web-maintenance.md` | 提交 | 通用维护步骤与安全边界 |
| `config/local-aggregate-web.example.json` | 提交 | 脱敏的配置结构示例 |
| `config/local-aggregate-web.json` | 忽略 | 默认目标的本机路径、内部 Tailnet 地址和端口 |
| `config/local-aggregate-web.<target>.json` | 忽略 | 指定目标的同一配置结构 |

在新机器上复制模板：

```bash
cp config/local-aggregate-web.example.json config/local-aggregate-web.json
```

填写实际值后，确认它保持未跟踪：

```bash
git check-ignore -v config/local-aggregate-web.json
```

不要在示例、文档、提交信息或远端仓库中写入内部 URL、机器路径、凭据、cookie、令牌或数据内容。

## 多目标配置

同一 checkout 可保存多个忽略的目标配置。未指定目标时使用
`config/local-aggregate-web.json`；明确指定目标时使用
`config/local-aggregate-web.<target>.json`。每个目标必须有独立的数据目录和
服务单元；代码从同一个已发布的 `fork/local/aggregate` 获取，但不得共享正在
使用的数据目录。

## 服务模型

- systemd 服务从聚合 worktree 启动 `packages/bb-app/src/bin/bb-app.ts`，使用已经通过隔离构建的产物；启动前只检查原生模块。`scripts/start-bb.mjs` 会重新构建，不用于这个常驻服务入口。
- 服务使用既有数据目录；升级代码不会迁移或复制该目录。
- Tailscale Serve 仅反向代理 loopback 的网页端口。保持 Tailnet-only，绝不使用 Funnel。
- `scripts/run-resource-isolated -- scripts/bb-dev-app current` 使用受限资源、隔离端口和隔离数据目录，只用于开发验证；不要把正式 Tailnet 网页入口指向它。
- 同一数据目录在任意时刻只能由一个 bb 服务实例使用。

实际服务名、路径、端口和 Tailnet 地址以所选本机配置为准。

在另一台机器上交给 Agent 执行切换时，直接使用[远端 Agent 切换提示词](local-aggregate-remote-agent-prompt.md)。

## 首次配置

1. 安装 Node 22.19 或更高的 Node 22 运行时，并把绝对二进制路径写进本机 JSON。systemd 不会加载交互 shell 的 `nvm`，因此不要让单元依赖 `nvm use` 或 `/tmp` 下的运行时。
2. 在 Node 的 `bin` 目录为项目锁定的 pnpm 启用 Corepack：

   ```bash
   <node-bin-directory>/corepack enable --install-directory <node-bin-directory>
   ```

3. 在目标 worktree 安装依赖并执行运行时预构建：

   ```bash
   scripts/run-resource-isolated --profile package -- <node-22-bin-directory>/pnpm install --frozen-lockfile
   scripts/run-resource-isolated --profile package -- <nodeExecutable> .bb/skills/local-aggregate-deploy/scripts/build-runtime.mjs --repo .
   ```

4. 创建 systemd drop-in。将下列占位符替换为本机 JSON 的值：

   ```ini
   [Service]
   WorkingDirectory=<repoPath>
   Environment=NODE_ENV=production
   Environment=PATH=<node-bin-directory>:/home/<user>/.local/bin:/usr/local/bin:/usr/bin:/bin
   ExecStartPre=
   ExecStartPre=<nodeExecutable> scripts/ensure-native-modules.mjs --check
   ExecStart=
   ExecStart=<nodeExecutable> --conditions=source --import tsx packages/bb-app/src/bin/bb-app.ts --data-dir <dataDir> --server-bind-host <bindHost> --server-port <serverPort> --host-daemon-port <hostDaemonPort>
   ```

5. 重新加载并启用服务：

   ```bash
   sudo systemctl daemon-reload
   scripts/run-resource-isolated -- sudo systemctl enable --now <systemdUnit>
   ```

6. 让 Tailscale Serve 指向 JSON 中的 `serveTarget`，并核验其为 Tailnet-only：

   ```bash
   tailscale serve --bg --https=443 <serveTarget>
   tailscale serve status
   ```

## 日常升级

本机聚合打包与服务替换以
[local-aggregate-deploy](../.bb/skills/local-aggregate-deploy/SKILL.md)
为唯一流程入口；它负责低内存预构建、持久检查点、切换门禁与回退边界。
本节保留服务模型和本机配置的背景，不重复该技能的部署步骤。

1. 检查现场并在 `local/aggregate` 完成聚合。默认不 push；若已明确授权，只推送到个人 fork：

   ```bash
   git status --short
   git worktree list
   git branch --show-current
   git push fork local/aggregate:refs/heads/local/aggregate
   ```

2. 按该技能执行预构建、重启及服务健康验证。它不以全仓库构建替代运行时门禁。

3. 对重要项目在浏览器强制刷新一次，以加载新的带 hash 前端 bundle，并打开一个既有会话确认数据可见。

## 回退

代码问题时，优先在聚合分支通过本地 `git revert` 回退对应聚合提交，重新构建后重启 systemd 服务。不要让两个服务同时访问同一数据目录，也不要为了回退删除数据目录。

如果服务无法启动，先查看：

```bash
sudo journalctl -u <systemdUnit> -n 200 --no-pager
tailscale serve status
```

确认服务、端口和数据目录后再处理问题；不要将故障日志中可能出现的令牌或项目内容提交到 Git。
