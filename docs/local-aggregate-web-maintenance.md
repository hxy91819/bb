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
服务单元，不得共享正在使用的数据目录。

## 服务模型

- systemd 服务从聚合 worktree 启动 `packages/bb-app/src/bin/bb-app.ts`，使用已经通过隔离构建的产物；启动前只检查原生模块。`scripts/start-bb.mjs` 会重新构建，不用于这个常驻服务入口。
- 服务使用既有数据目录；升级代码不会迁移或复制该目录。
- Tailscale Serve 仅反向代理 loopback 的网页端口。保持 Tailnet-only，绝不使用 Funnel。
- `scripts/run-resource-isolated -- scripts/bb-dev-app current` 使用受限资源、隔离端口和隔离数据目录，只用于开发验证；不要把正式 Tailnet 网页入口指向它。
- 同一数据目录在任意时刻只能由一个 bb 服务实例使用。

实际服务名、路径、端口和 Tailnet 地址以所选本机配置为准。

## 首次配置

1. 安装满足 `package.json` engines 的持久 Node 运行时，并把绝对二进制路径写进本机 JSON。systemd 不会加载交互 shell 的 `nvm`，因此不要让单元依赖 `nvm use` 或 `/tmp` 下的运行时。
2. 在 Node 的 `bin` 目录为项目锁定的 pnpm 启用 Corepack：

   ```bash
   <node-bin-directory>/corepack enable --install-directory <node-bin-directory>
   ```

3. 在要部署的 `local/aggregate` 检出（干净的 worktree）里安装依赖并执行运行时预构建：

   ```bash
   scripts/run-resource-isolated --profile package -- <node-bin-directory>/pnpm install --frozen-lockfile
   scripts/run-resource-isolated --profile package -- <nodeExecutable> .bb/skills/local-aggregate-deploy/scripts/build-runtime.mjs --repo .
   <nodeExecutable> scripts/ensure-native-modules.mjs --check
   ```

   每台机器都在自己的干净 worktree 里重新安装依赖和构建，不复制其他机器的
   `node_modules`、原生模块或构建产物；原生 ABI 检查必须使用常驻服务所用的同一 Node 可执行文件。

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

聚合按 [Fork 维护](fork-maintenance.md) 用 `scripts/fork-aggregate --promote` 生成并推送；
构建与服务替换以 [local-aggregate-deploy](../.bb/skills/local-aggregate-deploy/SKILL.md) 为唯一入口。

- 本机：在根目录 `local/aggregate`（与 `fork/local/aggregate` 同一 commit、工作区干净）上构建。
- 另一台机器：`git fetch fork`，在现有工作区之外用 `git worktree add --detach <path> fork/local/aggregate` 建干净 worktree，记下该 SHA，在里面安装依赖和构建。
- 没有明确服务部署授权时，到构建和原生 ABI 检查完成为止，不修改 systemd、Tailscale 或本机目标配置。
- 切换后，在浏览器强制刷新一次以加载新的前端 bundle，并打开一个既有会话确认数据可见。

## 外部 Cursor SDK 适配器

`Cursor (SDK)` 由独立 fork [hxy91819/cursor-acp](https://github.com/hxy91819/cursor-acp) 提供；本机使用该仓库 `local/aggregate` 的构建入口。拉取或重新聚合后，在 `/data/code/cursor-acp` 执行 `nub install && nub run build`。SDK 凭据与 `cursor-agent` 登录相互独立：在运行 BB host daemon 的用户下执行 `node /data/code/cursor-acp/dist/index.js login`，凭据保存在 `~/.cursor/sdk/auth.json`；也可由 host 环境提供 `CURSOR_API_KEY`。不要把 key 放进 BB 插件设置或 `customAgents.env`。

在 ACP providers 插件的 `customAgents` 设置中登记下列条目；保留原有条目。设置保存后立即生效，无需重启 BB。`nativeSkillRoots` 只决定 composer `/` 菜单列出哪些技能；全局提示词和技能是否进入 SDK 模型上下文由适配器负责。技能根不写 `recursive`：BB 的递归扫描会跳过软链接技能目录，非递归的用户根才会跟随软链接；`.agents/skills/.system` 因此单独列出。原则、分工和验证方法以 cursor-acp 仓库的 [docs/environment-discovery.md](https://github.com/hxy91819/cursor-acp/blob/fork-tooling/docs/environment-discovery.md) 为准，增删技能根时同步核对适配器实际加载的目录。

```json
{
  "id": "cursor-sdk",
  "displayName": "Cursor (SDK)",
  "command": "node",
  "args": ["/data/code/cursor-acp/dist/index.js"],
  "icon": "provider-acp/cursor",
  "iconTint": {"light": "#111827", "dark": "#F5F5F5"},
  "steeringMode": "auto",
  "nativeSkillRoots": {
    "user": [".agents/skills", ".agents/skills/.system", ".cursor/skills-cursor"],
    "project": [{"path": ".agents/skills", "ancestors": true}]
  }
}
```

该条目注册 provider `acp-cursor-sdk`。`icon`/`iconTint` 与内置 Cursor 相同，依赖 `feature/acp-custom-agent-icon`；运行中的服务不含该分支时，严格解析会拒绝这两个字段，先部署再写入。模型选用 `composer-2.5`；不设置 `dialect`，适配器不发 Cursor 原生 ACP 扩展。命令菜单与原 `acp-cursor` 对等：`/clear` 加技能条目；适配器自身的 `/help`、`/model` 等 ACP 命令 BB 不消费（对原 provider 同样如此），`supportsManualCompaction` 不设（与原 provider 一致，`/compact` 同样隐藏）。

**配置后自检（欠配不报错，只会静默变空）**：按 cursor-acp `docs/environment-discovery.md` 的“验证方法”执行；至少确认 Cursor (SDK) 线程输入 `/` 能看到软链接技能（如 `ppt-visual-review`、`tdd`），并用一次最短真调用确认模型拿到了全局提示词。Skills 面板按文件路径跨 provider 去重、先注册者先得，Cursor (SDK) 分组显示多少不代表可用性。

## 回退

代码问题：修复或回退提交放回拥有该改动的 `feature/*`/`fix/*` 分支，重新聚合并构建；
紧急时可把服务切回旧的构建目录/旧 SHA。不要让两个服务同时访问同一数据目录，也不要为了回退删除数据目录。

如果服务无法启动，先查看：

```bash
sudo journalctl -u <systemdUnit> -n 200 --no-pager
tailscale serve status
```

确认服务、端口和数据目录后再处理问题；不要将故障日志中可能出现的令牌或项目内容提交到 Git。
