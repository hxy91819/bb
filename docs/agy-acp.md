# AGY 在 BB 中的可复用配置

在 BB 中使用 [bb-plugins 的 AGY 启动器](https://github.com/hxy91819/bb-plugins/tree/main/tools/agy-launch)及其锁定的 antigravity-acp。调用链是 `BB → Bun → tools/agy-launch/agy-entry.mjs → antigravity-acp → agy -p`。模型预热和执行使用同一个 AGY，登录状态由执行机提供。原生 `agy acp` 有独立的模型发现与轮次行为。

本文与[配置模板](../config/agy-acp.example.json)维护在 BB fork 的 `fork-tooling` 分支。Linux 上已用 AGY `1.5.16` 验证了模型选择、同轮 steer、晚到 steer 沿用原会话及原生定时器拦截。安装及更新以集合中的 lockfile 为准，使用包含[定时续办修复](https://github.com/hxy91819/bb-plugins/commit/b72f1f7549aaf635e164113e9fc9076d28d819fd)的已验收版本。

## 1. 准备执行机器

以下命令适用于 Linux/macOS，在 BB host daemon 所在机器、以其运行用户执行。该用户需要能运行 `bb`、`agy`、Bun、Git、npm 和 Python 3，并已完成 AGY 登录。

```sh
bb status --json
agy --version
agy models
bun --version
bb plugin list --json
```

`acp-extensions` 由 [bb-plugins 集合](https://github.com/hxy91819/bb-plugins)的 `acp` 成员提供。尚未安装时执行以下命令；已有插件时保留其来源及配置，按其安装方式更新，不要为了改启动项删除插件。

```sh
bb plugin install git:https://github.com/hxy91819/bb-plugins --plugin acp --yes
```

从 `bb-plugins` checkout 安装启动器依赖和配套 hook。更新已有 checkout 前先检查分支与未提交改动。以下命令在执行机运行。

```sh
mkdir -p "$HOME/.local/share"
git clone https://github.com/hxy91819/bb-plugins.git "$HOME/.local/share/bb-plugins"
git -C "$HOME/.local/share/bb-plugins" checkout --detach b72f1f7549aaf635e164113e9fc9076d28d819fd
agy_launcher="$HOME/.local/share/bb-plugins/tools/agy-launch"
npm ci --prefix "$agy_launcher" --ignore-scripts
agy plugin install "$agy_launcher/node_modules/antigravity-acp/plugin"
agy plugin list --json
```

应看到已启用的 `agy-acp-steer`。切换到新版 checkout 后，重装锁定的依赖，再运行 `agy plugin install` 更新主机上的 hook。这个 hook 同时负责同轮 steer 和定时续办的引导。

AGY 通过 PATH 查找 hook 使用的 `bun`。若 Bun 不在 daemon 的 PATH 中，可在 PATH 已包含的目录中建立软链。例如：

```sh
ln -s "$HOME/.bun/bin/bun" "$HOME/.local/bin/bun"
bun --version
```

缺少 PATH 配置时，日志可能出现 `sh: 1: bun: not found`。若日志报 `$HOME is not defined`，在 `agy` 条目的 `env` 中填入执行用户的主目录绝对路径。

用 `--ignore-scripts` 跳过依赖的 AGY 下载脚本。启动器预热时使用 `AGY_BIN`。桥会优先使用依赖目录中的 `bin/agy`，复用旧目录时应核实该位置是否存在旧 binary，确保预热与执行使用同一版本。

## 2. 注册完整配置，保留其他 provider

[模板](../config/agy-acp.example.json)提供新建 `agy` 条目的默认值。以下脚本在 BB 仓库的 `fork-tooling` checkout 中运行。第二个参数是已安装的启动器目录。脚本只更新现有 `agy` 条目的启动路径和 binary 配置，保留其余设置及其他 provider。

```sh
python3 - config/agy-acp.example.json "$HOME/.local/share/bb-plugins/tools/agy-launch" <<'PY'
import json
from pathlib import Path
import shutil
import subprocess
import sys

template = json.loads(Path(sys.argv[1]).read_text())
launcher = Path(sys.argv[2]).expanduser().resolve(strict=True)
if not (launcher / "agy-entry.mjs").is_file():
    raise SystemExit("AGY launcher entry not found")
if not (launcher / "node_modules/antigravity-acp/index.ts").is_file():
    raise SystemExit("Install the AGY launcher dependencies first")

bun = shutil.which("bun")
agy = shutil.which("agy")
if not bun or not agy:
    raise SystemExit("bun and agy must be on PATH")

result = subprocess.run(
    ["bb", "plugin", "config", "acp-extensions", "--json"],
    check=True, capture_output=True, text=True,
)
raw = json.loads(result.stdout)["values"].get("customAgents", "[]")
agents = json.loads(raw) if isinstance(raw, str) and raw.strip() else (raw or [])
if not isinstance(agents, list) or any(not isinstance(item, dict) for item in agents):
    raise SystemExit("customAgents must be an array of objects")

entry = next((item for item in agents if item.get("id") == "agy"), None)
if entry is None:
    entry = template[0]
    agents.append(entry)

entry["command"] = str(Path(bun).absolute())
entry["args"] = [str(launcher / "agy-entry.mjs")]
entry["env"] = {
    **(entry.get("env") or {}),
    "AGY_BIN": str(Path(agy).absolute()),
    "AGY_SKIP_DOWNLOAD": "1",
}
subprocess.run(
    ["bb", "plugin", "config", "acp-extensions", "set", "customAgents",
     json.dumps(agents, ensure_ascii=False)],
    check=True, stdout=subprocess.DEVNULL,
)
print("Updated the AGY launch configuration")
PY
```

启动路径须在执行该 provider 的机器上有效。ACP 进程使用启动时加载的版本。等当前任务结束后，可用 `bb thread stop "$thread_id"` 释放空闲线程的旧进程，下一轮会用新版启动器。

`dialect: "agy"` 与 `providerUsage: true` 启用 AGY 额度采集。`permissionModes: ["full"]` 对应桥的 Full Access。`reasoningLevels: ["medium"]` 用于 BB 兼容，实际推理档位由模型 ID 表达。`AGY_EXTRA_ARGS` 用于已有的额外启动参数。若设置了 `--print-timeout 2h`，它是整轮的时间上限。

`nativeSkillRoots` 声明用户技能位置，但不会创建目录或软链。要复用已有共享技能，可将 AGY 的 `~/.gemini/config/skills` 和 `~/.gemini/config/AGENTS.md` 分别链接到 `~/.agents/skills` 和 `~/.agents/AGENTS.md`；已有目标先核实，不要覆盖。项目技能是否生效仍取决于 AGY 自身的发现规则。

## 3. 验收模型目录和实际执行

```sh
agy models
bb provider list --json
bb provider models acp-agy --json
```

BB 连接多台机器时，为后两条命令添加 `--machine <目标机器ID>`。比较模型 ID，以目标账号的当前目录为准。选一个模型实发“只回复 OK”，需要 Claude 时也验证一次实际推理。再验证同轮 steer 确实插入原轮，以及错过最后一个 hook 且尚未被领取的 steer 沿用原会话续跑。

入口会在 `~/.agy-acp/models.json` 缺失或为空时，用 `agy models` 预填缓存，避免 BB 在 `session/new` 后立刻查询却只拿到 `Agent default`。桥还会在后台重新发现并更新目录。换账号、升级后若旧目录不刷新，先保留缓存用于对比，并在没有活跃 AGY 请求时将它改名备份，再新建会话触发预热；不要把旧机器的模型缓存复制过来当成账号权限目录。

## 4. 定时续办与 Working 卡住

在 BB 内需要到点自动续跑时，创建指向当前线程的 **agent automation**。下方的 `project_id`、`thread_id` 和 `model_id` 分别使用实际项目、线程和目标机器模型 ID。

```sh
bb automation create --project "$project_id" --name "定时续办" \
  --in 10m --target-thread "$thread_id" \
  --provider acp-agy --model "$model_id" \
  --prompt "检查额度和原任务进度，条件满足时继续推进。" --json
```

只执行 `echo` 的 script automation 会把提醒写入运行记录。需要让原线程继续工作时，使用上面的 agent 方式。创建后用 `bb automation show <自动化ID> --project <项目ID>` 核对触发时间和目标线程。

BB 启动器设置进程内标记 `AGY_ACP_USE_BB_AUTOMATIONS=1`。配套的 `PreToolUse` hook 仅匹配 `schedule`，在 AGY 创建原生定时器前拦截，并提示 agent 使用 BB agent automation。对照实测中，普通回复后 AGY 约 1 秒退出。创建 30 秒原生定时器时，AGY 在回复后等了约 30 秒才退出，BB 也会一直等这轮结算。升级后在测试会话验证 `schedule` 被拦截，检查 BB 日志是否记录 `turn/completed` 以及队列是否继续推进。

旧版本出现这类卡顿时，先核对 AGY 是否已写完回复且仍有原生定时任务处于 `RUNNING`。确认后可停止旧轮次并查看队列。若队列仍待派发，按原顺序用 `bb thread queue send "$thread_id" "$message_id" --mode auto` 推进。

## 5. 另一环境只显示 Gemini 时

先比较两个环境的 `agy --version` 和 `customAgents` 中的 `command`、`args`、`AGY_BIN`；配置输出可能带其他 provider 的凭据，对外只摘录 AGY 所需字段。

若启动的是 `agy acp`，其 `server.go` 日志显示 `Advertising available models ... count=6`，只能说明它广播六个模型，数量本身不能说明模型种类。应检查真实 ACP 返回的 ID。若 CLI 可执行某 Claude ID，而同一账号、同一 binary 的原生 ACP 在 `session/set_model` 拒绝该 ID，可定位到原生 ACP 暴露或接收的目录与 CLI 不一致；仍需比对版本、启动参数、运行用户及登录目录，才能判断具体原因。

使用本文的桥时，以目标环境的 `agy models`、BB 模型目录和真实请求结果为准。不同账号实测过不同的 Claude 模型 ID。
