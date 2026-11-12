# Claude Code 多 profile 与 Ollama Cloud 配置

本 fork 的原生 Claude Code provider 支持 `homeBindings`。一个 binding 对应一个独立的 `CLAUDE_CONFIG_DIR`，在 BB 的同一模型选择器里显示为 `Claude Code · <displayName>`，用途类似 Codex 的多 home。下面以 `Claude Code · Ollama` 接入 GLM 5.3 Flash 为例，保留原来的 Claude Code 入口。

本方案已于 2026-11-02 在 [fork-v0.47.0-20261102.1](https://github.com/hxy91819/bb/releases/tag/fork-v0.47.0-20261102.1)、Claude Code 2.1.316 上验证，包括 BB 内原生 Read/Edit、模型与思考档位、上下文用量和技能发现。维护分支为 `feature/claude-home-bindings`；本文与[功能索引](feature-index.md)维护在 `fork-tooling`，其他环境可直接查阅该分支。

## 配置分工与隔离范围

| 位置                                      | 保存内容                                                       |
| ----------------------------------------- | -------------------------------------------------------------- |
| BB 的 `provider-claude-code.homeBindings` | profile ID、显示名、目标机器上的配置目录、思考档位和 Fast 能力 |
| `<claudeConfigDir>/settings.json`         | endpoint、API key、模型、输出上限、压缩窗口等 Claude 原生设置  |
| `<claudeConfigDir>` 下的原生文件          | 会话历史、原生插件、技能和登录状态                             |

各 profile 共用已安装的 Claude Code CLI 和 BB 原生 bridge，使用独立 worker 进程。绑定入口会清除继承的 `ANTHROPIC_*`、`CLAUDE_CODE_*` 及账号池父凭据，再加载自己的配置目录；因此 endpoint 和凭据应写入该目录的 `settings.json`。绑定入口绕过 Account Pooler，也不展示 Anthropic 订阅额度。

工作区的项目规则、技能和文件仍然共用。需要复用用户级规则和技能时，可以显式链接对应目录，见下文。

`memoryEnabled`、`subagentsDisabled`、`sandboxEnabled`、`disable1MContext` 等 BB 插件级开关由这些入口共用；本例沿用默认的 `disable1MContext: false`。目标实例曾调整这些开关时，需结合实际上下文报告核对结果，避免将其当成各 profile 独立的设置。

## 1. 确认目标 BB 与执行机器

在实际运行 Claude Code 的机器上准备配置。`~/` 按 host daemon 运行用户的 home 展开。BB 连接多台机器时，同一 binding 的路径会在各执行机器分别解析，需在每台机器准备该目录及凭据。

```sh
bb status --json
bb plugin config provider-claude-code --json
claude --version
```

插件设置的 schema 应包含 `homeBindings`。缺少这个字段时，先安装包含该功能的 fork 版本；配置本身无需重启 BB 服务。Ollama Cloud 直连只需要 Claude Code 和有效的 Ollama API key，无需安装本地 Ollama 服务，连接方式见 [Ollama 官方 Claude Code 指南](https://docs.ollama.com/integrations/claude-code#connect-directly-to-ollamas-cloud)。

## 2. 准备独立配置目录

macOS / Linux：

```sh
mkdir -p ~/.claude-ollama
chmod 700 ~/.claude-ollama
```

Windows PowerShell：

```powershell
New-Item -ItemType Directory -Force (Join-Path $HOME '.claude-ollama') | Out-Null
```

在该目录新建 `settings.json`，使用下面的完整示例，并将 `<OLLAMA_API_KEY>` 替换为目标环境的有效 key。Pi 已配置 Ollama Cloud 时，可以使用同一账号的有效 API key；本文件独立保存凭据。下方是新目录模板，已有目录需合并所需字段。

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://ollama.com",
    "ANTHROPIC_AUTH_TOKEN": "<OLLAMA_API_KEY>",
    "ANTHROPIC_API_KEY": "",
    "ANTHROPIC_MODEL": "glm-5.3-flash",
    "ANTHROPIC_DEFAULT_MODEL": "glm-5.3-flash",
    "ANTHROPIC_CUSTOM_MODEL_OPTION": "glm-5.3-flash",
    "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME": "GLM 5.3 Flash (Ollama Cloud)",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-5.3-flash",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5.3-flash",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-5.3-flash",
    "ANTHROPIC_DEFAULT_FABLE_MODEL": "glm-5.3-flash",
    "CLAUDE_CODE_SUBAGENT_MODEL": "glm-5.3-flash",
    "CLAUDE_CODE_MAX_CONTEXT_TOKENS": "1048576",
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "500000",
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "128000",
    "CLAUDE_CODE_ALWAYS_ENABLE_EFFORT": "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "DISABLE_PROMPT_CACHING": "1",
    "ENABLE_TOOL_SEARCH": "false",
    "API_TIMEOUT_MS": "3000000"
  },
  "model": "glm-5.3-flash",
  "effortLevel": "max",
  "autoCompactEnabled": true,
  "autoCompactWindow": 500000,
  "modelPicker": {
    "replaceBuiltInOptions": true,
    "options": [
      {
        "model": "glm-5.3-flash",
        "label": "GLM 5.3 Flash (Ollama Cloud)"
      }
    ]
  }
}
```

macOS / Linux 保存后执行：

```sh
chmod 600 ~/.claude-ollama/settings.json
```

实际文件含凭据，保留在目标机器；仓库中只保存上面的占位模板。

### 参数选择

| 参数                                                    | 本方案取值与原因                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ANTHROPIC_BASE_URL`                                    | `https://ollama.com`，Claude 会拼接 `/v1/messages`，base URL 不再附加 `/v1`                     |
| `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`            | 前者填 Ollama key，后者置空，采用官方要求的 Bearer 认证                                         |
| 模型 ID                                                 | 直连云 API 使用 `glm-5.3-flash`；本地 Ollama 的 `:cloud` 调用示例不用于这里                     |
| `ANTHROPIC_DEFAULT_MODEL`                               | 同步为 GLM，避免原生模型目录多出合成的默认 `[1m]` 项                                            |
| 内置模型别名和 `CLAUDE_CODE_SUBAGENT_MODEL`             | 统一映射到 GLM，覆盖默认型号选择及 Claude 原生子任务；BB 创建线程仍由其 provider/model 选择控制 |
| `modelPicker`                                           | 仅展示这一个自定义模型；增加模型时同步维护该列表                                                |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS`                        | `1048576`，声明模型的实际窗口；[模型说明](https://ollama.com/library/glm-5.3-flash)列为 1M      |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` / `autoCompactWindow` | `500000`，主动选择较小的压缩窗口；不把模型的 1M 能力当成必须用满的目标                          |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS`                         | `128000`，本方案已验证请求中的 `max_tokens` 为该值                                              |
| `effortLevel` / `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT`      | 默认 `max` 并启用自定义模型的 effort 控制；模型支持 `low/high/max`                              |
| `ENABLE_TOOL_SEARCH`                                    | `false`，关闭 deferred tool search，工具完整发送；代价是工具定义会占用更多初始上下文            |
| `DISABLE_PROMPT_CACHING`                                | `1`，关闭 Claude 侧显式缓存控制，不要求兼容端实现 Anthropic 的缓存语义                          |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`              | `1`，关闭 Claude 的非必要请求                                                                   |
| `API_TIMEOUT_MS`                                        | `3000000`（50 分钟），为长上下文请求保留较长客户端超时                                          |

不要额外固定 `CLAUDE_CODE_EFFORT_LEVEL`，否则可能覆盖 BB 中按线程选择的思考档位。上述部分字段和环境变量属于 Claude CLI 的原生实现细节，已在本文所列版本验证，升级后以实际模型列表、请求与上下文报告为准。

500K 是配置窗口。该版本 Claude 会预留 33000 tokens，因此 BB 中应看到 `contextWindowTokens: 500000`、`autoCompactAtTokens: 467000`。这保留了用户主动限制的 500K 设置；预留量可能随 Claude 版本变化。

Ollama 提供 Anthropic API 的兼容子集；基础对话与文件编辑可用，deferred tools、hosted WebSearch 等高级控制未完整支持，见[官方兼容说明](https://docs.ollama.com/api/anthropic-compatibility)。新增能力需要单独验证。

### 可选：复用用户级规则和技能

若原目录已有这些内容，可在新目录创建指向它们的软链接。macOS / Linux 示例：

```sh
ln -s ~/.claude/CLAUDE.md ~/.claude-ollama/CLAUDE.md
ln -s ~/.claude/skills ~/.claude-ollama/skills
```

只链接源和目标符合预期的项目；源不存在时省略对应命令，目标已存在时保留已有内容。需要用户级 commands 或 agents 时，可同样链接 `commands`、`agents`。Windows 可按环境创建文件/目录链接，也可独立维护同一份规则和技能。凭据与历史留在各自目录。

## 3. 在 BB 注册 profile

`homeBindings` 是完整 JSON 数组，`set` 会替换整个数组。先读回现值；已有 profile 时保留原项，再追加下面的 binding。以下命令适用于尚无 binding 的环境：

```sh
bb plugin config provider-claude-code set homeBindings '[{"id":"ollama","displayName":"Ollama","claudeConfigDir":"~/.claude-ollama","reasoningLevels":["low","high","max"],"defaultReasoningLevel":"max","supportsFastMode":false}]'
```

也可在 BB 的 Claude Code 插件设置中直接编辑 `homeBindings`。使用此 JSON，PowerShell 环境也可通过该设置界面避免命令行 JSON 引号差异：

```json
[
  {
    "id": "ollama",
    "displayName": "Ollama",
    "claudeConfigDir": "~/.claude-ollama",
    "reasoningLevels": ["low", "high", "max"],
    "defaultReasoningLevel": "max",
    "supportsFastMode": false
  }
]
```

| 字段                    | 作用                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `id`                    | 生成 provider ID `claude-code-ollama`；允许小写字母、数字和连字符，首字符为字母或数字，最长 50 字符 |
| `displayName`           | 显示为 `Claude Code · Ollama`，可以改名                                                             |
| `claudeConfigDir`       | 执行机器上的绝对路径或 `~/` 路径；Windows JSON 绝对路径需转义反斜杠                                 |
| `reasoningLevels`       | BB 宣告的能力列表，本例 `low/high/max`                                                              |
| `defaultReasoningLevel` | 必须包含在 `reasoningLevels` 中，本例 `max`                                                         |
| `supportsFastMode`      | 本例为 `false`，隐藏 Claude Fast 档位                                                               |

这些能力字段控制 BB 的选项，原生模型和窗口参数仍由 `settings.json` 决定。多个账号或 endpoint 可分别创建目录，并在数组中增加不同 ID 的 binding；原有 `claude-code` 入口始终保留。

## 4. 验证模型、技能和真实调用

先通过 `bb status --json` 确认目标环境，并将以下 `<environment-id>`、`<project-id>` 换成目标实例的 ID：

```sh
bb provider list --environment <environment-id> --json
bb provider models claude-code-ollama --environment <environment-id> --json
bb skill list --environment <environment-id> --json
bb project commands <project-id> --provider claude-code-ollama --environment <environment-id> --json
```

模型列表应只有 `glm-5.3-flash`，默认 effort 为 `max`，可选项为 `low/high/max`，Fast 档位为空。技能结果中的 `provider` 应包含 `claude-code-ollama`，共享用户技能的路径应指向新配置目录下的 `skills`。

在 BB 选择 `Claude Code · Ollama` → `GLM 5.3 Flash (Ollama Cloud)`，确认思考档位为 `max`。也可通过 CLI 创建验证线程：

```sh
bb thread spawn --project <project-id> --environment <environment-id> --provider claude-code-ollama --model glm-5.3-flash --reasoning-level max --permission-mode accept-edits --prompt '请使用原生 Read 读取工作区中指定的验收文件，再用原生 Edit 修改其中一行，只操作这一份文件。'
```

执行前在工作区准备好测试文件，并在提示词中写明其路径和要替换的内容。使用随机验证串，可以核对回复确实来自文件读取；结束后检查实际文件和线程的 Read/Edit 事件，再删除测试文件。

CLI 新建线程需显式指定 `--reasoning-level max`：省略时可能继承项目记住的 `medium`，并被此 provider 的能力校验拒绝。BB 模型选择器会按该模型能力调整不支持的旧档位。`bb provider models` 的 `--environment` 与 `--project` 不能同时传；上面的 `bb project commands` 和 `bb thread spawn` 则同时需要项目及环境定位。

真实调用完成后查看上下文：

```sh
bb thread context <thread-id> --json
```

本文所列版本的验收值为 `model: glm-5.3-flash`、`contextWindowTokens: 500000`、`autoCompactAtTokens: 467000`。无需消耗接近 500K tokens 来验证设置。provider 健康检查只证明本地 CLI 认证可用，真正的远端模型可用性以实际调用为准。

## 迁移、改名与回退

迁到另一台机器时，分别准备原生配置目录、有效凭据及需要共享的规则/技能，再在目标 BB 注册 binding。不要依赖另一台机器的绝对路径、登录状态或 shell 环境。

同一 BB 实例内，已使用过的 binding ID 会记住其目录；移除后也不能用同一 ID 改绑其他目录。要更换目录，新增 ID；只修改显示名可保留原 ID。临时移除 binding 会保留已有线程，重新加入相同 ID 和目录后可恢复使用。

回退时读回当前 `homeBindings`，只移除目标项并保留其他项；仅有本文这一项时可设为 `[]`。配置目录可继续保留，以便恢复该入口和原生历史。常规 binding 配置无需重启 BB 服务。
