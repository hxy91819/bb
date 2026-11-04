# AGY 在 BB 中的可复用配置

需要复用本机已能显示 Claude 的接法时，使用个人 fork 的 `antigravity-acp` 桥：`BB → bun agy-entry.mjs → agy CLI`。桥通过 `agy models` 发现模型，通过 `agy --model <id> -p <prompt>` 执行请求。`agy acp` 是另一套原生 ACP server，不能把两套接法的模型发现结果混为一谈。

本文和[配置模板](../config/agy-acp.example.json)维护在 BB fork 的 `fork-tooling` 分支；其他环境从该分支读取，无需等 BB 发布或重启服务。模板不包含账号凭据，目标机器使用自己的 AGY 登录状态。

## 已核实的配置与证据

2026-11-04 当前环境为 Linux，AGY `1.5.0`，桥版本 `1.2.0`，源码为 [`hxy91819/antigravity-acp@3b4b7bde3d003b7400c4601e4579dbbb7c8a2967`](https://github.com/hxy91819/antigravity-acp/tree/3b4b7bde3d003b7400c4601e4579dbbb7c8a2967)。BB 的 `acp-extensions.customAgents` 中，`agy` 条目由 Bun 启动桥的 `agy-entry.mjs`，没有启动 `agy acp`。`agy-acp-steer` 原生 hook 插件已安装并启用。

本轮实时查询 `agy models` 和 `bb provider models acp-agy --json`，两边均返回以下六个模型：

| ID                         | 显示名                       |
| -------------------------- | ---------------------------- |
| `gemini-3.8-flash-high`    | Gemini 3.8 Flash (High)      |
| `gemini-3.8-flash-medium`  | Gemini 3.8 Flash (Medium)    |
| `gemini-3.8-flash-low`     | Gemini 3.8 Flash (Low)       |
| `claude-sonnet-4-6`        | Claude Sonnet 4.6 (Thinking) |
| `claude-opus-4-6-thinking` | Claude Opus 4.6 (Thinking)   |
| `gpt-oss-120b-medium`      | GPT-OSS 120B (Medium)        |

这是该账号当时的目录快照，不是其他账号的固定模型清单，也不证明每个模型已完成推理验证。本轮没有另发付费模型请求。另一环境报告的 `claude-opus-5-5-high` 不在本机目录中，不应直接照抄该 ID。

## 1. 准备执行机器

以下命令适用于 Linux/macOS，在 BB host daemon 所在机器、以其运行用户执行。该用户需要能运行 `bb`、`agy`、Bun、Git 和 Python 3，并已完成 AGY 登录。

```sh
bb status --json
agy --version
agy models
bun --version
bb plugin list --json
bb plugin config acp-extensions --json
```

`acp-extensions` 由 [bb-plugins 集合](https://github.com/hxy91819/bb-plugins)的 `acp` 成员提供。尚未安装时执行以下命令；已有插件时保留其来源及配置，按其安装方式更新，不要为了改启动项删除插件。

```sh
bb plugin install git:https://github.com/hxy91819/bb-plugins --plugin acp --yes
```

在新目录安装已核实版本的桥；已有 checkout 时先检查其分支和未提交改动，不要直接覆盖：

```sh
mkdir -p "$HOME/.local/share"
git clone https://github.com/hxy91819/antigravity-acp.git "$HOME/.local/share/antigravity-acp"
git -C "$HOME/.local/share/antigravity-acp" checkout --detach 3b4b7bde3d003b7400c4601e4579dbbb7c8a2967
cd "$HOME/.local/share/antigravity-acp"
AGY_SKIP_DOWNLOAD=1 AGY_BIN="$(command -v agy)" bun install --frozen-lockfile
agy plugin install "$PWD/plugin"
agy plugin list --json
```

应看到启用的 `agy-acp-steer`。缺少 hook 时桥仍可执行普通请求，但不通告同轮 steer；Windows 也不通告此能力。

桥的 binary resolver 优先使用 checkout 下的 `bin/agy`，然后才使用 `AGY_BIN`，最后使用 `PATH`。因此安装时就设置 `AGY_SKIP_DOWNLOAD=1`，以免 postinstall 下载另一版本。复用旧目录时如有 `bin/agy`，先核实其版本和用途；仅设置 `AGY_BIN` 不足以覆盖它。`agy-entry.mjs` 的目录预热使用 `AGY_BIN`，两者指向不同版本会再次造成目录与执行不一致。

## 2. 注册完整配置，保留其他 provider

[模板](../config/agy-acp.example.json)中的三个占位符分别是执行机器的 Bun 绝对路径、桥目录绝对路径和 AGY 绝对路径。不要把模板直接作为整个 `customAgents` 设置覆盖已有配置；只替换同 ID 的 `agy` 条目。

在本 BB 仓库的 `fork-tooling` checkout 根目录运行以下命令。第一个参数是模板路径，第二个是上一步安装的桥目录。脚本通过 BB CLI 读取现有设置、保留其他条目，再写回；不会打印其他条目的环境变量。

```sh
python3 - config/agy-acp.example.json "$HOME/.local/share/antigravity-acp" <<'PY'
import json
from pathlib import Path
import shutil
import subprocess
import sys

template = json.loads(Path(sys.argv[1]).read_text())
bridge = Path(sys.argv[2]).expanduser().resolve(strict=True)
if not (bridge / "agy-entry.mjs").is_file():
    raise SystemExit("Bridge entry not found")
bun = shutil.which("bun")
agy = shutil.which("agy")
if not bun or not agy:
    raise SystemExit("bun and agy must be on PATH")
entry = template[0]
entry["command"] = str(Path(bun).absolute())
entry["args"] = [str(bridge / "agy-entry.mjs")]
entry["env"]["AGY_BIN"] = str(Path(agy).absolute())
result = subprocess.run(
    ["bb", "plugin", "config", "acp-extensions", "--json"],
    check=True, capture_output=True, text=True,
)
raw = json.loads(result.stdout)["values"].get("customAgents", "[]")
existing = json.loads(raw) if isinstance(raw, str) and raw.strip() else (raw or [])
if not isinstance(existing, list) or any(not isinstance(x, dict) for x in existing):
    raise SystemExit("customAgents must be an array of objects")
merged = [x for x in existing if x.get("id") != "agy"] + [entry]
subprocess.run(
    ["bb", "plugin", "config", "acp-extensions", "set", "customAgents",
     json.dumps(merged, ensure_ascii=False)],
    check=True, stdout=subprocess.DEVNULL,
)
print("Updated agy; preserved other custom agents")
PY
bb plugin reload acp-extensions
```

路径由启动配置提供，不依赖交互 shell 的 PATH。多执行机器需要分别准备可用的路径、桥及登录状态；设置路径应对运行该 provider 的机器成立。

字段含义：`dialect: "agy"` 和 `providerUsage: true` 启用 AGY 额度采集；`permissionModes: ["full"]` 对应当前桥的 Full Access 执行；`reasoningLevels: ["medium"]` 是 BB 的兼容占位，桥不会据此传 `--effort`，推理档位由模型 ID 表达；不声明 Fast tier 和 fork。`AGY_EXTRA_ARGS: "--print-timeout 2h"` 显式保留已用配置，AGY 1.5.0 当前帮助显示默认超时为 0；它不是当前版本的必需修复，旧版曾有五分钟超时问题。

`nativeSkillRoots` 声明用户技能位置，但不会创建目录或软链。要复用已有共享技能，可将 AGY 的 `~/.gemini/config/skills` 和 `~/.gemini/config/AGENTS.md` 分别链接到 `~/.agents/skills` 和 `~/.agents/AGENTS.md`；已有目标先核实，不要覆盖。项目技能是否生效仍取决于 AGY 自身的发现规则。

## 3. 验收模型目录和实际执行

```sh
agy models
bb provider list --json
bb provider models acp-agy --json
```

BB 连接多台机器时，为后两条命令添加 `--machine <目标机器ID>`。比较完整模型 ID，确认 BB 返回当前账号中所需的 Claude/非 Gemini 模型，然后在 BB 新建 AGY 线程，选该目录里的模型发送“只回复 OK”。目录查询成功与真实执行成功分别验收，不以能显示模型代替执行验证。

入口会在 `~/.agy-acp/models.json` 缺失或为空时，用 `agy models` 预填缓存，避免 BB 在 `session/new` 后立刻查询却只拿到 `Agent default`。桥还会在后台重新发现并更新目录。换账号、升级后若旧目录不刷新，先保留缓存用于对比，并在没有活跃 AGY 请求时将它改名备份，再新建会话触发预热；不要把旧机器的模型缓存复制过来当成账号权限目录。

## 4. 另一环境只显示 Gemini 时

先比较两个环境的 `agy --version` 和 `customAgents` 中的 `command`、`args`、`AGY_BIN`；配置输出可能带其他 provider 的凭据，对外只摘录 AGY 所需字段。

若启动的是 `agy acp`，其 `server.go` 日志显示 `Advertising available models ... count=6`，只能说明它广播六个模型，数量本身不能说明模型种类。应检查真实 ACP 返回的 ID。若 CLI 可执行某 Claude ID，而同一账号、同一 binary 的原生 ACP 在 `session/set_model` 拒绝该 ID，可定位到原生 ACP 暴露或接收的目录与 CLI 不一致；仍需比对版本、启动参数、运行用户及登录目录，才能判断具体原因。

当前已核实的可复用接法是本文的桥。无需先改 BB 的 `provider-acp` 或等待 AGY 升级，即可在另一环境安装并验收这条路径；成功与否以目标环境实测为准。本次没有在当前机器调用原生 `agy acp` 复现目录缺失，也没有访问另一环境，不能断言原生 ACP 永远只支持 Gemini。
