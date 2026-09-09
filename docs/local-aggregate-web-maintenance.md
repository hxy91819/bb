# 本机聚合网页服务维护

本说明适用于把 `local/aggregate` 作为本机网页服务运行的场景。入口由本机决定
（例如 Tailnet 反向代理、loopback 端口经 SSH 隧道访问），以本机 JSON 为准。
它是本地运维资料：可以在本地 Git 提交。只有在明确授权后才可推送到个人 fork；绝不推送到上游 `origin`，也不要从聚合分支创建上游 PR。

## 文件与保密边界

| 文件 | Git 状态 | 用途 |
| --- | --- | --- |
| `docs/local-aggregate-web-maintenance.md` | 提交 | 通用维护步骤与安全边界 |
| `config/local-aggregate-web.example.json` | 提交 | 脱敏的配置结构示例 |
| `config/local-aggregate-web.json` | 忽略 | 本机路径、端口和网页入口地址；Tailscale 字段仅适用于配置了 Tailscale 的机器，其余机器可为 `null` |

在新机器上复制模板：

```bash
cp config/local-aggregate-web.example.json config/local-aggregate-web.json
```

填写实际值后，确认它保持未跟踪：

```bash
git check-ignore -v config/local-aggregate-web.json
```

不要在示例、文档、提交信息或远端仓库中写入内部 URL、机器路径、凭据、cookie、令牌或数据内容。

## 服务模型

- systemd 服务从聚合 worktree 启动 `scripts/start-bb.mjs`。
- 服务使用既有数据目录；升级代码不会迁移或复制该目录。
- 网页入口以本机 JSON 与既有部署为准（例如 loopback 端口经 SSH 访问，或 Tailscale Serve 反向代理）。使用 Tailscale Serve 时仅代理 loopback 的网页端口，保持 Tailnet-only，绝不使用 Funnel。
- `scripts/bb-dev-app current` 使用隔离端口和隔离数据目录，只用于开发验证；不要把正式 Tailnet 网页入口指向它。
- 同一数据目录在任意时刻只能由一个 bb 服务实例使用。

实际服务名、路径、端口和 Tailnet 地址以本机 `config/local-aggregate-web.json` 为准。

在另一台机器上交给 Agent 执行切换时，直接使用[远端 Agent 切换提示词](local-aggregate-remote-agent-prompt.md)。

## 首次配置

1. 确认本机有持久化的 Node 运行时，并把绝对二进制路径写进本机 JSON（版本以本机 JSON 与项目实际兼容性为准，不强制特定大版本）。systemd 不会加载交互 shell 的 `nvm`，因此单元必须使用绝对路径，不要依赖 `nvm use` 或 `/tmp` 下的运行时。
2. 在该 Node 的 `bin` 目录为项目锁定的 pnpm 启用 Corepack：

   ```bash
   <node-bin-directory>/corepack enable --install-directory <node-bin-directory>
   ```

3. 在目标 worktree 安装与构建：

   ```bash
   <node-22-bin-directory>/pnpm install --frozen-lockfile
   <node-22-bin-directory>/pnpm build
   ```

4. 创建 systemd drop-in。将下列占位符替换为本机 JSON 的值：

   ```ini
   [Service]
   WorkingDirectory=<repoPath>
   Environment=NODE_ENV=production
   Environment=PATH=<node-bin-directory>:/home/<user>/.local/bin:/usr/local/bin:/usr/bin:/bin
   ExecStart=
   ExecStart=<nodeExecutable> --conditions=source --import tsx scripts/start-bb.mjs --data-dir <dataDir> --server-bind-host <bindHost> --server-port <serverPort> --host-daemon-port <hostDaemonPort>
   ```

5. 重新加载并启用服务：

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now <systemdUnit>
   ```

6. （可选，仅当本机使用 Tailscale Serve 作为入口）让 Tailscale Serve 指向 JSON 中的 `serveTarget`，并核验其为 Tailnet-only；不使用 Funnel：

   ```bash
   tailscale serve --bg --https=443 <serveTarget>
   tailscale serve status
   ```

   若本机不使用 Tailscale（例如入口是 loopback 端口经 SSH 访问），跳过此步，保持既有入口不变。

## 日常升级

1. 检查现场并在 `local/aggregate` 完成聚合。默认不 push；若已明确授权，只推送到个人 fork：

   ```bash
   git status --short
   git worktree list
   git branch --show-current
   git push fork local/aggregate:refs/heads/local/aggregate
   ```

2. 用 JSON 所指 Node 22 安装并构建：

   ```bash
   <node-22-bin-directory>/pnpm install --frozen-lockfile
   <node-22-bin-directory>/pnpm build
   ```

3. 重启服务。systemd 会先停止旧实例，再以相同数据目录启动聚合版：

   ```bash
   sudo systemctl restart <systemdUnit>
   sudo systemctl status <systemdUnit> --no-pager
   ```

4. 验证服务、入口和数据都仍可用：

   ```bash
   curl --fail http://<bindHost>:<serverPort>/
   ```

   若本机使用 Tailscale Serve，另核验 `tailscale serve status` 的目标正确。

   在浏览器强制刷新一次，以加载新的带 hash 前端 bundle。对重要项目再打开一个既有会话，确认数据可见。

## 回退

代码问题时，优先在聚合分支通过本地 `git revert` 回退对应聚合提交，重新构建后重启 systemd 服务。不要让两个服务同时访问同一数据目录，也不要为了回退删除数据目录。

如果服务无法启动，先查看：

```bash
sudo journalctl -u <systemdUnit> -n 200 --no-pager
```

若本机使用 Tailscale Serve，另核验 `tailscale serve status`。

确认服务、端口和数据目录后再处理问题；不要将故障日志中可能出现的令牌或项目内容提交到 Git。
