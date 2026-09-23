# 本机聚合网页服务维护

本说明适用于把 `local/aggregate` 作为本机 Tailnet 网页服务运行的场景。
它是本地运维资料：验证后按仓库规则提交并推送到个人 fork；绝不推送到上游 `origin`，也不要从聚合分支创建上游 PR。

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
服务单元；代码从用户指定、由外部发布凭据绑定精确聚合 commit 的不可变个人
fork 发布 ref 获取，不得以可变的 `fork/local/aggregate` 或尚未提升的候选 ref
代替，也不得共享正在使用的数据目录。

## 服务模型

- systemd 服务从聚合 worktree 启动 `packages/bb-app/src/bin/bb-app.ts`，使用已经通过隔离构建的产物；启动前只检查原生模块。`scripts/start-bb.mjs` 会重新构建，不用于这个常驻服务入口。
- 服务使用既有数据目录；升级代码不会迁移或复制该目录。
- Tailscale Serve 仅反向代理 loopback 的网页端口。保持 Tailnet-only，绝不使用 Funnel。
- `scripts/run-resource-isolated -- scripts/bb-dev-app current` 使用受限资源、隔离端口和隔离数据目录，只用于开发验证；不要把正式 Tailnet 网页入口指向它。
- 同一数据目录在任意时刻只能由一个 bb 服务实例使用。

实际服务名、路径、端口和 Tailnet 地址以所选本机配置为准。

在另一台机器上交给 Agent 执行切换时，直接使用[远端 Agent 切换提示词](local-aggregate-remote-agent-prompt.md)。

## 首次配置

1. 安装满足 `package.json` engines 且与外部发布凭据所记构建工具链兼容的持久 Node 运行时，并把绝对二进制路径写进本机 JSON。Node 22.19.0 是当前源码最低版本，不是固定主版本；凭据锁定 Node 24.15.0 时使用持久 Node 24.15.0。systemd 不会加载交互 shell 的 `nvm`，因此不要让单元依赖 `nvm use` 或 `/tmp` 下的运行时。
2. 在 Node 的 `bin` 目录为项目锁定的 pnpm 启用 Corepack：

   ```bash
   <node-bin-directory>/corepack enable --install-directory <node-bin-directory>
   ```

3. 先按下文完成聚合并核对不可变候选与聚合发布 ref 的 commit，再在目标
   worktree 安装依赖并执行运行时预构建：

   ```bash
   scripts/run-resource-isolated --profile package -- <node-bin-directory>/pnpm install --frozen-lockfile
   scripts/run-resource-isolated --profile package -- <nodeExecutable> .bb/skills/local-aggregate-deploy/scripts/build-runtime.mjs --repo . --aggregate-ref <aggregate-ref> --candidate-ref <candidate-ref>
   <nodeExecutable> scripts/ensure-native-modules.mjs --check
   ```

   每台机器都必须在该 clean worktree 重新安装依赖和构建，不得复制其他机器的
   `node_modules`、原生模块或构建产物。安装前后都核对 worktree 的 HEAD 与发布
   凭据 commit；原生 ABI 检查必须使用常驻服务所用的同一 Node 可执行文件。

   没有明确服务部署授权时，首次配置也在本步骤后停止；以下 systemd 和
   Tailscale 步骤只在已有该授权时执行。

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

1. 发布机器先冻结并验证列车候选，把候选的精确 commit 提升到根目录
   `local/aggregate`。核对根目录、候选 ref 和 fork 上的聚合分支均为同一
   commit，然后创建并推送指向该 commit 的不可变 `fork-release/*` ref。
   只有这些核对完成后才能打包或签发绑定源码 commit、候选 ref、发布 ref、
   聚合核对结果及工具链的外部凭据：

   ```bash
   git status --short
   git worktree list
   git branch --show-current
   aggregate_sha=$(git rev-parse HEAD)
   candidate_sha=$(git rev-parse 'refs/tags/fork-candidate/<name>^{commit}')
   test "$aggregate_sha" = "$candidate_sha"
   git push fork local/aggregate:refs/heads/local/aggregate
   fork_sha=$(git ls-remote fork refs/heads/local/aggregate | cut -f1)
   test "$aggregate_sha" = "$fork_sha"
   git tag fork-release/<name> "$aggregate_sha"
   git push fork refs/tags/fork-release/<name>
   ```

   若根目录有未跟踪的用户文件，保留它们，从刚发布的 ref 创建新的干净 detached
   worktree 打包。构建门禁会拒绝任何未跟踪文件进入打包工作区。

2. 目标机器获取凭据指定的不可变发布 ref 与候选 ref，在现有工作区之外创建
   clean detached worktree，并核对两者和 HEAD 都等于凭据中的已聚合 commit。
   打包前重新读取 fork 上的 `local/aggregate`，若它已前进或不等于该 commit，
   停止旧版本打包并重新冻结当前快照。
   保留现有工作区的所有本地改动，不在其中构建。按该技能重新安装本机依赖并
   执行预构建；它不以全仓库构建替代运行时门禁。

3. 没有明确服务部署授权时，到源码、构建和原生 ABI 准备完成为止，不修改 systemd、Tailscale 或本机目标配置。已有授权时才按该技能的外部 Agent 门禁更新 repoPath、常驻入口并切换服务。

4. 授权切换后，对重要项目在浏览器强制刷新一次，以加载新的带 hash 前端 bundle，并打开一个既有会话确认数据可见。

## 回退

代码问题时，把修复或回退提交放回拥有该产品改动的一级来源，重新冻结列车、
提升聚合并构建；服务回退仍遵守部署技能的授权和检查点。不要让两个服务同时访问
同一数据目录，也不要为了回退删除数据目录。

如果服务无法启动，先查看：

```bash
sudo journalctl -u <systemdUnit> -n 200 --no-pager
tailscale serve status
```

确认服务、端口和数据目录后再处理问题；不要将故障日志中可能出现的令牌或项目内容提交到 Git。
