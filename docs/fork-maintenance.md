# Fork 维护

这个 fork 只服务于三件事：

1. 每个功能/修复保持为一个独立、聚焦、可以直接向上游提交的分支；
2. 本机能方便地把这些分支聚合打包；
3. 能随时纳入上游的稳定版更新。

除此之外不引入额外结构：没有领域分支、没有补丁登记表、没有冻结清单。
分支本身就是状态，`.fork/branches` 是唯一的清单。

## 仓库角色

| 引用 | 作用 |
| --- | --- |
| `origin` | 上游 get-bb/bb，只读 |
| `fork` | 个人 fork hxy91819/bb，所有推送都去这里 |
| `desktop-v*` tag | 上游稳定版，聚合和新分支的基线 |
| `feature/*`、`fix/*` | 每个改动一个分支，基于基线 tag |
| `fork-tooling` | 维护规则、`.fork/branches`、聚合脚本、部署 skill；和其他分支一样被 merge |
| `local/aggregate` | 聚合产物，每次从 tag 重新生成并覆盖，根目录永远检出它 |

当前基线是 `.fork/branches` 里 `base` 行的 tag。`origin/main` 上还没进 tag 的提交不追，除非用户明确要求。

## 1. 开发新功能或修复

从当前基线 tag 拉分支，在独立 worktree 里开发：

```bash
base=$(git show fork-tooling:.fork/branches | awk '$1=="base"{print $2}')
git worktree add .worktrees/<name> -b feature/<name> "$base"   # 修复用 fix/<name>
```

- 不要从 `local/aggregate` 拉分支，否则分支会带上全部聚合内容，无法单独提给上游。
- 只有真正依赖另一个 fork 分支时，才从那个分支拉出（叠放），并在清单说明里写"叠在 X 上"。
- 修改已有功能：直接在它的分支上继续提交。分支落后于基线也没关系，merge 会处理；只有冲突时才 rebase。
- 完成后：相关测试通过 → 提交 → `git push fork <branch>` 并核对远端 SHA。
- 在 `fork-tooling` 分支的 `.fork/branches` 加一行（分支、上游状态、说明），提交并推送 `fork-tooling`。

## 2. 聚合打包

```bash
scripts/fork-package                       # 聚合 → 验证 → 提升 → 构建 → 发布 tag → 打印 cutover 提示
scripts/fork-package --no-release          # 只验证、提升、构建，不打 tag
scripts/fork-package --test-filter <pkg>   # 覆盖默认的测试范围，可重复
```

`fork-package` 把整个打包流程串成一条命令，每一步都在单个 `run-resource-isolated` scope 里串行执行，失败就停在原地；
Agent 只需要在它停下时处理冲突或失败，不要自己把步骤拆开并行跑。它依次做：

1. `scripts/fork-aggregate`：从基线 tag 开始依次 `merge --no-ff` 清单中的分支，生成 `.worktrees/aggregate-next`。每次从头生成，没有中间状态。
2. 把 `aggregate-next` 改名为 `.worktrees/aggregate-deploy-<短 SHA>` 并 detach。之后的安装、验证、构建、服务切换都用这一个检出，不再第二次安装依赖。
3. `pnpm install --frozen-lockfile`、全仓 `typecheck --concurrency=1`、`test`。测试默认只跑 `--filter='[<上一次 local/aggregate>]'`，即相对上次聚合有文件改动的包；各分支自己的测试在分支上已经跑过。
4. `scripts/fork-aggregate --promote-only`：把根目录 `local/aggregate` 移到已验证的那个提交并推送 fork。不重新聚合，所以提升的 SHA 就是验证过的 SHA。
5. 按 `config/local-aggregate-web.json` 的 Node 做运行时构建和原生模块检查（`--no-build` 跳过）。
6. 按第 3 节给聚合 SHA 打 `fork-v*` tag 并推送；同一 SHA 已有 tag 则复用。
7. 打印聚合 SHA、部署检出路径和在 BB 外终端执行 cutover 的命令。

Turbo 缓存统一在 `~/.cache/bb-turbo`（`run-resource-isolated` 和 `build-runtime.mjs` 都默认设置 `TURBO_CACHE_DIR`），
所以每次只有被改动分支触及的包及其下游会真正重新 typecheck 和构建，其余命中缓存。缓存目录可以随时删除，只影响速度。

手工分步时等价于：

```bash
scripts/fork-aggregate                      # 只生成 aggregate/next
scripts/run-resource-isolated --profile package -- pnpm install --frozen-lockfile
scripts/run-resource-isolated --profile package -- pnpm exec turbo run typecheck --concurrency=1 --output-logs=errors-only
scripts/run-resource-isolated --profile package -- pnpm exec turbo run test --concurrency=1 --output-logs=errors-only --filter=<涉及的包>
scripts/fork-aggregate --promote-only       # 提升验证过的 aggregate/next
scripts/fork-aggregate --promote            # 旧方式：重新聚合并提升，SHA 会因时间戳变化，不要在验证之后用
```

全仓 typecheck 必须用 `--profile package --concurrency=1`：默认 verification 档（3G）加 turbo 默认并发会让 tsc 被内存限流卡住。
`run-resource-isolated` 启动前会释放上一次遗留的空 scope；scope 里仍有进程时它会拒绝并列出 pid，说明另一个验证还在跑。
提升、推送到 fork 和打包后的 tag 发布不需要再询问；替换本机运行中的 BB 服务需要用户明确授权，走 [local-aggregate-deploy](../.bb/skills/local-aggregate-deploy/SKILL.md)。

### 冲突怎么解决

脚本遇到冲突会停下，并判断是哪一类：

| 类型 | 判断 | 处理 |
| --- | --- | --- |
| 分支与上游冲突 | 该分支单独合入基线 tag 就冲突 | 在该分支 worktree 里 `git rebase --no-autostash <tag>`，修复、测试、`git push --force-with-lease fork <branch>`，重跑脚本。修好的分支同时也保持了对上游可合并。 |
| 分支之间冲突 | 单独都能合入，一起才冲突 | 在 `.worktrees/aggregate-next` 里只做两边合并、不加新行为，`git add` 后 `git commit --no-edit`，重跑脚本。`rerere` 会记住这次解决，下次自动复用。 |

- 产品修复永远回到对应分支，不写在聚合的 merge 提交里。
- 同一对分支反复出现非平凡冲突时，把后者 rebase 到前者上（叠放），更新清单顺序和说明。
- 叠放分支 rebase 时从栈底开始，用 `git rebase --update-refs` 让上层分支一起移动。

### 纳入上游新版本

1. 把 `.fork/branches` 的 `base` 改成新的 `desktop-v*` tag（或先用 `scripts/fork-aggregate --base <tag>` 试跑）。
2. 运行脚本，按上表逐个处理冲突。没有冲突的分支不用动。
3. 某个分支 rebase 后变空，说明上游已经包含它：从清单删除这一行，删除分支（fork 上的也删），在提交说明里写明被上游哪个版本吸收。
4. 验证、`--promote`，提交并推送 `fork-tooling` 上的新 `base`。

## 3. 发布预编译聚合包

`.github/workflows/fork-release.yml` 只在 `hxy91819/bb` 的 `fork-v*` tag 推送时运行。它直接构建 tag 对应的聚合代码，不在 CI 里重新聚合或 rebase，也不发布到 npm。

### 发布

用户要求聚合打包或为聚合版构建部署包时，发布是打包任务的默认收尾，已经授权，无需再次确认。用户明确要求仅验证、不发布时跳过；构建或必要验证失败时先修复，不给失败结果打发布 tag。

1. 完成聚合、必要验证、打包及提升，记录实际打包的聚合 SHA；确认它已推送到 `fork`，并包含发布 workflow。后续即使 `local/aggregate` 被其他任务移动，也使用这个已验证的 SHA。
2. 查询 fork 的发布 tag 和 Release。同一 SHA 已有成功发布的 `fork-v*` Release 时复用并交付链接；已有 tag 的流水线尚未成功时跟踪或重跑原任务，处理方法见下方「失败后重跑」。
3. 需要新增发布时，使用 `fork-v<上游基线版本>-<UTC日期YYYYMMDD>.<序号>` 的 annotated tag。序号从 1 开始，递增到本地和 fork 远端均未使用的名称，tag 指向第 1 步记录的 SHA，并只推送这个 tag 到 `fork`。
4. 核对远端 tag 解引用后的 commit SHA，跟踪 `Release fork aggregate` 到结束，确认 Release 已公开且四个平台的包和校验文件齐全。
5. 交付 tag、聚合 SHA 和 Release 链接。tag 推送成功只代表已触发构建；流水线失败、无法查询或资产不全时，明确报告发布未完成。

以下是新发布的命令示例，版本、日期、序号和聚合 SHA 以本次打包结果为准：

```bash
git status --short
aggregate_sha='<本次打包时记录的聚合SHA>'
git show "${aggregate_sha}:.github/workflows/fork-release.yml"
git tag -a fork-v0.44.0-20261001.1 "$aggregate_sha" -m "BB fork aggregate 2026-10-01"
git push fork refs/tags/fork-v0.44.0-20261001.1
git ls-remote fork 'refs/tags/fork-v0.44.0-20261001.1^{}'
```

workflow 接受以 `fork-v` 和数字开头、后续只含字母、数字、点、下划线或连字符的 tag。新增发布使用新 tag；源码里的上游 package version 保持原值，包内 `release.json` 另行记录 fork tag、聚合 SHA、平台和 Node 版本。

在 [fork 的 Actions](https://github.com/hxy91819/bb/actions) 查看 `Release fork aggregate`。四个平台使用 GitHub 托管 runner 分别构建、检查 launcher、运行已有 tarball 集成验证，再把最终独立包解压，验证 CLI、server/host-daemon 健康和内置插件加载。只有全部通过才发布 [GitHub Release](https://github.com/hxy91819/bb/releases)。

| 包名后缀              | 目标机器                                              |
| --------------------- | ----------------------------------------------------- |
| `linux-x64.tar.gz`    | Linux x86_64，glibc ≥ 2.35（Ubuntu 22.04 或同等系统） |
| `linux-arm64.tar.gz`  | Linux aarch64，glibc ≥ 2.35                           |
| `darwin-x64.tar.gz`   | Intel Mac，macOS 15 或更新                            |
| `darwin-arm64.tar.gz` | Apple Silicon Mac，macOS 15 或更新                    |

这是后台服务及 CLI 的包，不是 Electron 桌面安装包。每个包包含 Node 24.15.0、生产依赖（含对应平台的原生模块）、网页、服务端、host daemon、CLI、SDK 和内置插件；目标机器不用安装 Node、pnpm，也不用编译源码。Provider CLI 和它们的登录仍由目标机器配置。

流程仅使用 GitHub 自带的 `GITHUB_TOKEN`，发布 job 获得 `contents: write`；无需 npm token、Apple 签名证书或上游的 Blacksmith runner。Fork 的 Actions 需已启用。

### 在其他机器安装

从 Release 下载匹配平台的 `.tar.gz` 和同名 `.sha256`。例如 Linux x64：

```bash
tag=fork-v0.44.0-20261001.1
asset="bb-${tag}-linux-x64.tar.gz"
curl -fLO "https://github.com/hxy91819/bb/releases/download/${tag}/${asset}"
curl -fLO "https://github.com/hxy91819/bb/releases/download/${tag}/${asset}.sha256"
sha256sum --check "${asset}.sha256"
mkdir -p "$HOME/.local/opt/bb"
tar -xzf "$asset" -C "$HOME/.local/opt/bb"
"$HOME/.local/opt/bb/bb-${tag}-linux-x64/bin/bb-app"
```

macOS 对应换成 `darwin-x64` 或 `darwin-arm64`，校验命令用 `shasum -a 256 --check "${asset}.sha256"`。保持解压目录完整，直接调用其中的 `bin/bb-app`、`bin/bb-server`、`bin/bb-host-daemon`、`bin/bb`；可以把该目录的 `bin` 加入 `PATH`，不要把启动脚本软链接到别处。脚本始终用包内的 Node，因此不受系统 Node 版本影响。

升级时下载并解压新包，停下旧实例，再让现有 service 的启动命令指向新包的 `bin/bb-app`（或原先使用的单独 server/host-daemon 启动入口）。默认仍使用 `~/.bb`；原有启动参数、数据目录和 service 环境变量应保留。包不会安装或重启服务。数据库 schema 变化时沿用部署流程的备份与迁移规则，同一个数据目录只运行一个实例。本机现有服务的切换仍按 [local-aggregate-deploy](../.bb/skills/local-aggregate-deploy/SKILL.md) 执行。

### 失败后重跑

构建或验证失败时修复所属分支，重新聚合后使用新 tag 发布。纯网络或 runner 故障可在 Actions 重跑原 tag。

上传从 draft Release 开始，全部资产上传成功才公开；上传中断时重跑会补全这个 draft。已经公开的 Release 保留原来的包，重跑只核对源码 SHA 和资产清单，不覆盖已发布包。需要修订已发布版本时使用新 tag。流程不会更新 `desktop-latest`、`desktop-nightly` 或上游安装渠道。

## 4. 向上游反馈

分支本身就是上游 PR 的材料，这也是分支必须保持独立、基于 tag 的原因。

1. 先在 get-bb/bb 搜索是否已有相关 issue/PR；按 [docs/filing-issues.md](filing-issues.md) 准备内容。
2. **向 get-bb/bb 提 issue、评论或 PR 之前，必须把拟提交的内容给用户逐项确认。** 用户可以决定把它标为 `fork-only` 保留在本地。
3. 提 PR 时：从该分支 rebase 到 `origin/main` 得到一个新分支（如 `upstream/<name>`）推送到 fork，再开 PR；叠放分支要先把依赖部分一并处理或拆开。
4. 在 `.fork/branches` 更新该行的状态和链接（`reported` / `pr-open` / `fork-only`）。
5. 上游合并后，等它进入一个 `desktop-v*` tag 再从清单移除（见上一节第 3 步）。issue 关闭本身不是移除理由。

## 已废弃的做法

2026-09-23 之前使用过“一级来源 + 二级领域 + 冻结列车 + 登记表”的维护模型（`config/local-aggregate-features.json`、`config/local-aggregate-trains/`、`integration/*` 分支、`fork-candidate/*` tag）。它们已被本流程取代，不要恢复；历史内容保留在 tag `archive/two-tier-maintenance` 上。
