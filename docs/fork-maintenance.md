# Fork 维护

这个 fork 只服务于三件事：

1. 每个功能/修复保持为一个独立、聚焦、可以直接向上游提交的分支；
2. 本机能方便地把这些分支聚合打包；
3. 能随时纳入上游的稳定版更新。

除此之外只保留一个安全基线：`security/baseline` 汇总纯依赖/锁文件的安全修复，
再派生 `fork-base/<tag>` 作为所有 worktree 和聚合的共同祖先。它不是领域分支，
也不单独登记补丁；`.fork/branches` 仍是唯一清单。

## 仓库角色

| 引用                 | 作用                                                                     |
| -------------------- | ------------------------------------------------------------------------ |
| `upstream`           | 上游 get-bb/bb，只读                                                     |
| `origin`             | 个人 fork hxy91819/bb，所有推送都去这里                                  |
| `desktop-v*` tag     | 上游稳定版，`fork-base/<tag>` 的起点                                     |
| `security/baseline`  | 纯依赖/锁文件安全修复的集成分支                                          |
| `fork-base/<tag>`    | 基线 tag + `security/baseline`，所有 worktree 和聚合的起点               |
| `feature/*`、`fix/*` | 每个改动一个分支，基于 `fork-base/<tag>`                                 |
| `fork-tooling`       | 维护规则、`.fork/branches`、聚合脚本、部署 skill；和其他分支一样被 merge |
| `aggregate`          | 已验证的聚合产物，供打包、部署和分享                                     |
| `main`               | 个人 fork 默认分支，等于 fork-base/<tag>，根目录检出它                   |

当前基线是 `.fork/branches` 里 `base` 行的 tag。`upstream/main` 上还没进 tag 的提交不追，除非用户明确要求。
`scripts/fork-base` 会把 `security/baseline` 合入该 tag，生成 `fork-base/<tag>`；
不要直接拿裸 `desktop-v*` tag 建 worktree，否则会漏掉安全修复。

个人 fork 的 `main` 是安全默认入口，等于当前 `fork-base/<tag>`。GitHub 默认分支保持 `main`；普通 clone、从 main 拉分支及 BB 默认 worktree 都包含安全修复。`origin/HEAD` 必须指向 `origin/main`，本地 `main` 应与它一致，避免 BB 选中分叉的旧本地主干。`upstream/main` 是上游开发主干，不是日常新分支起点。

`aggregate` / `origin/aggregate` 保存已验证聚合，供打包、部署和分享；`aggregate-next` 只是本地临时候选。首次迁移先把旧远端 main 原样推到 aggregate，再用带精确 lease 的推送将 main 改为安全基线。不要把聚合提升回 main。

维护规则和脚本以 `fork-tooling` 为准，安全基线只同步 AGENTS 的 Fork 维护块，不为默认分支合入整个维护分支。旧 clone 的现场不自动迁移；有未提交改动、未推送提交或 BB 环境引用的 clone 保留。其他 clone 先完整归档并校验后才能删除。

## 每日安全维护

本机自动化统一在独立的本地仓库 `/data/code/fork-maintenance`，运行入口和判断规则见该仓库的 `README.md`：09:30 `baseline-watch` 扫描并修复 `origin/security/baseline` 的同 major 依赖漏洞，验证通过后推送并调用 `scripts/fork-base`；09:40 `branch-sync` 为未包含 baseline、干净且没有运行任务的功能 worktree 合入当前 `fork-base/<tag>`，再 frozen 安装及 prune；09:47 全量扫描把 BB 的基线问题和分支落后分别交回前两项，仅为分支自己引入的漏洞派发修复线程。三个任务均采用 `Asia/Shanghai`。

基线需要代码适配、只有 major 或没有补丁时交给 DSH，提示词仅引用仓库 AGENTS.md 的安全修复流程。分支同步发生冲突时 abort 并记录，不派线程。旧 clone 的 remote/main 不自动迁移，首次真实验收只执行 dry-run；这些任务不发布、不部署、不停止或重启 BB。

## 1. 开发新功能或修复

修改功能前先读 [功能维护与插件更新索引](feature-index.md)，业务定制优先使用公开插件扩展点；旧安装来源迁移见 [插件迁出说明](steward/plugin-extraction.md)。插件集合以其 `.bb/plugins.json` 管理；本仓库 `.fork/branches` 只记录仍需合入 BB 的核心、内置公共实现和维护分支。

在 `fork-tooling` 的 worktree 中，从 `fork-base/<tag>` 拉分支：

```bash
scripts/fork-worktree <name>                  # 默认 feature/<name>
scripts/fork-worktree <name> fix/<name>       # 修复用 fix/<name>
```

- `scripts/fork-worktree` 会先确保 `fork-base/<tag>` 存在，再创建 worktree，默认安装依赖并执行 `pnpm prune`。
- 可以从已同步的 `main` / `origin/main` 拉分支；脚本显式使用 `fork-base/<tag>`。不要从 `aggregate` 或裸 `desktop-v*` tag 拉独立功能分支。
- 只有真正依赖另一个 fork 分支时，才从那个分支拉出（叠放），并在清单说明里写"叠在 X 上"。
- 修改已有功能：直接在它的分支上继续提交。分支落后于基线也没关系，merge 会处理；只有冲突时才 rebase。
- 完成后：相关测试通过 → 提交 → `git push origin <branch>` 并核对远端 SHA。
- 在 `fork-tooling` 分支的 `.fork/branches` 加一行（分支、上游状态、说明），提交并推送 `fork-tooling`。
- 整项任务进入最终交付时，按第 3 节完成适用的聚合与发布收尾；不要以分支已推送或已登记清单代替安装包交付。

### 安全基线

`security/baseline` 是所有 worktree 和聚合的唯一安全祖先。它收纳已验收的安全修复，以及升级必需的代码/测试适配；修复分支（`fix/*`）仍作为上游 PR 材料保留，但只有合入 baseline 后才对本地 worktree 生效。

新增安全修复时：

1. 在修复分支完成实现和验证。
2. 在 `security/baseline` 的 worktree 中执行 `git merge --no-ff <fix-branch>`。冲突时取修复分支的版本。不要只挑 manifest/锁文件：升级必需的代码/测试适配要一起进入基线，否则新 worktree 会安装新依赖但 typecheck/test 失败。
3. 运行 `pnpm install --frozen-lockfile && pnpm prune`，确认修复版本已安装且检查通过。
4. `git push origin security/baseline`。
5. 运行 `scripts/fork-base --base <tag>` 生成/更新 `fork-base/<tag>`，并同步远端 main 与干净的本地 main；main 换 tag 允许 force-with-lease，其他分支普通推送。
6. 新 worktree 默认从同步后的 `main` / `origin/main` 创建，也可显式选 `fork-base/<tag>`；`scripts/fork-worktree <name>` 会先更新并校验基线。禁止 `git worktree add <tag>`。

校验 fork-base 已包含基线：

```bash
git merge-base --is-ancestor security/baseline fork-base/<tag>
```

新上游基线确定后，同样运行 `scripts/fork-base --base <new-tag>`；如果 `security/baseline` 合入新 tag 冲突，先在该分支上 `git merge <new-tag>`，解决并验证后 `git push origin security/baseline`，再重新生成。已有 worktree 需要新安全修复时，执行 `git merge fork-base/<tag>` 后重新 `pnpm install --frozen-lockfile && pnpm prune`。

修改 daemon wire 或 SDK 导出时，在功能分支提交/审查前运行已有契约测试，不等到聚合阶段才检查：

```bash
scripts/run-resource-isolated --profile package -- pnpm exec turbo run test --filter=@bb/host-daemon-contract --concurrency=1 --output-logs=errors-only
scripts/run-resource-isolated --profile package -- pnpm exec turbo run test --filter=@bb/server --concurrency=1 --output-logs=errors-only -- test/services/plugins/plugin-authoring-docs.test.ts
```

旧基线没有 resource runner 时，使用已发布 fork 中的 runner 显式执行该 worktree 的命令。已有 fixture 设置自己的 Git 签名开关和模拟用户身份；不修改宿主全局 Git 配置或生产 systemd 来让测试通过。

## 2. 聚合打包

以下命令从 `fork-tooling` 的独立 worktree 运行；根目录 `main` 是安全基线，维护脚本从 `fork-tooling` 调用。

```bash
scripts/fork-base --base <tag>             # 先生成/更新 fork-base/<tag>
scripts/fork-package                       # 聚合 → 验证 → 提升 → 构建 → 发布 tag → 打印 cutover 提示
scripts/fork-package --no-release          # 只验证、提升、构建，不打 tag
scripts/fork-package --test-filter <pkg>   # 覆盖默认的测试范围，可重复
scripts/fork-package --resume <sha>        # 从失败阶段接续同一个聚合 SHA
scripts/fork-aggregate --preflight         # 不改聚合 worktree，一次列出与上游的全部冲突
```

`fork-package` 把整个打包流程串成一条命令，每一步都在单个 `run-resource-isolated` scope 里串行执行，失败就停在原地；
Agent 只需要在它停下时处理冲突或失败，不要自己把步骤拆开并行跑。它依次做：

0. 持有 Git common directory 的执行锁，一轮只同步 upstream/origin 各一次，按 local 优先解析稳定 tag 对象、安全 tip、tooling 清单 blob、有序分支 tip 和 previous aggregate，保存本轮私有输入快照。后续基线、预检、真实 merge 和提升只消费固定 SHA；执行期间 refs 移动留到下轮，远端普通推送冲突则停止。
1. `scripts/fork-base`：确保 `fork-base/<tag>` 已包含最新的 `security/baseline`；`fork-package` 会自动执行，单独聚合时需要先手动运行。
2. `scripts/fork-aggregate`：先只读预检所有输入与 `fork-base/<tag>` 的冲突，集中报告；通过后从该分支开始依次 `merge --no-ff`，生成 `.worktrees/aggregate-next`，并在结束时断言 `security/baseline` 是结果的祖先。merge 提交的时间固定取基线、各分支 tip 和上一版 aggregate 中最新的提交时间。生成候选后用 ours merge 保留上一版 aggregate 为祖先，文件树仍完全取本次清单结果，使普通推送能够快进；文件树与上一版相同且基线已包含时复用上一版 SHA。相同输入得到同一个 SHA。
3. 把 `aggregate-next` 改名为 `.worktrees/aggregate-deploy-<短 SHA>` 并 detach。之后的安装、验证、构建、服务切换都用这一个检出，不再第二次安装依赖。
4. 显式 `CI=true NODE_ENV=development npm_config_production=false pnpm install --frozen-lockfile --prod=false` 后先运行维护脚本测试与上面的两个契约检查，再运行全仓 `typecheck --concurrency=1` 和相关包 `test`。全仓检查带 `--continue`，一次收集失败。包测试默认只跑 `--filter='[<上一次 aggregate>]'`；即使显式覆盖包过滤器，也不跳过前置契约检查。
5. `scripts/fork-aggregate --base <固定tag> --promote-only --result <已验证sha>`：把 `aggregate` 更新到已验证的提交并普通推送 origin，保留根目录 `main`，不依赖可能已被其他任务移动的 `aggregate-next`。
6. 按 `config/local-aggregate-web.json` 的 Node 做运行时构建和原生模块检查（`--no-build` 跳过）。
7. 按第 3 节给聚合 SHA 打 `fork-v*` tag 并推送；同一 SHA 已有 tag 则复用。
8. 删除被取代的 `aggregate-deploy-*` 检出：只删干净且既不是本次结果、也不是服务运行目录或上一次 `aggregate` 的那些。
9. 打印聚合 SHA、部署检出路径和只读 cutover 计划生成命令。安装包服务先下载、校验并解压同一 SHA 的 Release，再生成计划；不把源码检出当成已安装包。实际切换走部署 skill；允许从 BB 内发起，由独立 systemd 任务完成停服、启动及失败回退，线程恢复后核验结果。

修改分支后重新运行 `fork-package`，生成新候选并记录新的 previous 和测试范围；只有 `--resume <sha>` 保留原来的基线、输入快照、比较起点、测试范围和部署检出。Git common directory 的 `fork-package/` 保存阶段成功回执、日志和每轮 `runs/run.*` 记录，不写入产品 Git。旧格式缺少快照的记录须重新运行入口。

回执身份包含源码、精确命令和过滤器、阶段依赖、实际 Node 文件内容/版本/ABI、pnpm 版本及入口内容、平台/libc、锁文件/工作区配置、资源脚本与流水线实现。只排除本轮锁描述符映射、快照路径、systemd 自动 INVOCATION_ID、shell 层数和工作目录等执行元数据；INVOCATION_ID 仍用于归属校验，其余未知环境变量只存摘要并继续使回执失效，不保存环境值。安装回执按 pnpm-lock.yaml 的 importers 覆盖根目录及每个 workspace 的 node_modules，以版本5回执记录存在性、成员、权限、链接和完整文件signature（dev/ino/size/mtime/ctime/mode），安装目录首次不再全读内容计算SHA；任何signature变化直接重装并使后续阶段失效，即使内容相同也不复用。此规则保持既有signature完全相同时不重读内容的边界，不接受mtime单字段或marker；没有 lockfile 的维护夹具用 Git package manifests 取目录。安装回执只排除各安装根下实际普通目录 `.vite/vitest/<40位小写十六进制>/results.json` 的封闭缓存布局及其空容器，以及真实安装根下普通、完全为空的 `.vite-temp` 目录；目录中出现未知文件、其他层级或异常链接时不套用排除，`.cache` 等其他目录仍完整检查。目录成员仅扣除已确认的工具缓存子树，父目录继续记录设备/inode、mode、uid/gid；不使用会随缓存增删变化的目录mtime/ctime/大小/nlink。普通依赖文件和链接继续核对完整signature，目录的其他成员增删、权限或身份变化仍重装并级联。缓存中的符号链接及依赖链接指向被排除缓存的情况不复用。此排除仅适用于安装回执，产物回执仍保留完整SHA。检查及构建从当前 Turbo 根配置、包配置的 outputs 取得产物根，包含 .bundled-runtime、生成文件及 bb-app 包装目录，并补充已经出现的 ignored dist/generated/bundled-types 根。不存在的声明根也记录；复用时重新枚举根清单并检查目录完整性和内容，新增根、缺根、workspace 链接变化均使回执失效。文件元信息未变时复用已计算的内容摘要；外部未知目录链接保守重跑。回执检查本身也计入阶段耗时，需结合真实仓库 benchmark 评估开销。

安装阶段先执行 frozen development 安装，再以该 Node 执行现有 ensure-native-modules 准备当前 ABI、分离 hardlink，全部成功后才写安装回执。后续 native 检查不更新安装基线；native 文件仍逐项核对完整 signature，不列入缓存例外。配置的运行时若使用另一 ABI，原生检查仍会失败，不能将不同 ABI 的部分结果视为可复用。

安装或工具身份变化、产物丢失/损坏、覆盖变化、阶段失败均重跑，并使后续阶段失效；失败和中断不写成功回执。运行时构建与原生检查也纳入同一回执和 package 资源 scope。接续要求检出仍为该 SHA 且干净，不支持手工在聚合顶端追加修复后跳过验证。锁覆盖 Git 操作和全部阶段，嵌套入口继承父锁；阶段写入另持独占锁。锁使用内核 flock（没有 flock 命令时使用 Perl Fcntl），锁文件永久保留，只关闭自身描述符，不删除或显式解锁共享描述符。

Linux 执行入口和阶段为每次命令保留独立 systemd user Slice 的内核归属，记录 boot ID、InvocationID、ControlGroup 和目录设备/inode。准入检查递归 cgroup.events 的 populated；Node 默认 spawn 丢弃额外 FD、detached 后代、命令和包装器同时 SIGKILL、writer 通过 systemd-run 重归组时，仍按整个 Slice 判断。资源 scope 通过 --slice-inherit 留在执行 Slice 内。启动 payload 前验证实际归属，不以 PID、PGID 或环境 token 判断 writer 是否已经结束。元数据查询失败保留归属并拒绝恢复；同名新 unit 不当成旧实例。只有全部 writer 退出后才能自动恢复，无需人工清锁；并发恢复仍由内核文件锁串行准入，失败竞争者不会释放其他执行锁。

正常收尾只核验归属，不再对可复用 unit 名称执行 stop。scope 使用 --collect 随命令退出自然回收；空 Slice 可以仍为 active/populated=0，保留给 systemd 管理，不为删除空结构增加协议。新执行按记录的实例身份和实际成员判断恢复，不要求手工清锁或清空 Slice。

取消先传 TERM，3 秒后对身份验证且目录 FD 钉住的 cgroup 写 cgroup.kill；控制侧 7 秒后以失败结束等待。查询或清理失败保留归属，不能写成功回执。恢复取得锁后，未完成记录保留 interrupted，再完成必要验证。此路径需要 Linux、可用的 systemd user manager、cgroup v2 和可写 cgroup.kill；不再依赖 Python subreaper。轻量真实 scope 回归覆盖双 SIGKILL、忽略 TERM 后代、重归组、并发恢复和查询失败；不将这些结果扩展为非 Linux 平台保证。主动将 writer 迁出受管 Slice 的特权操作不属于本维护入口的派生契约。

托管 Ubuntu CI 的共享准备脚本给准确 user service 写入运行时 Delegate=cpu memory pids，使用 PID1 支持的资源 Accounting 属性开启祖先传播，再原位 daemon-reexec user manager；不 restart 后向已启用子控制器的委派根重新挂接进程。首次与重复准备均由非发布分支 workflow 验证实际 scope CPU/memory/pids 限额。准备失败保留 unit Result、ExecMainStatus、status 和 journal。该脚本只用于临时 GitHub Actions runner，不用于本机线上 manager。

资源scope不设置仅适用于service的 OOMPolicy；部署service的 OOMPolicy=continue drop-in保留。CI兼容回归在透明systemd-run夹具中拒绝scope的该属性，其余调用转发到真实systemd。

资源预算不固定为旧的 5G/7G/300%。每轮按实际 affinity/祖先 CPU 限制、可用内存及祖先 headroom 选择，保留线上余量；查询失败拒绝执行。verification/package 两个显式 profile 继续接受，同轮预算冻结为 BB_RESOURCE_BUDGET，package 可嵌套 verification，反向升级拒绝。新一轮重新探测；嵌套不重新分配预算，并核验 scope 的实际 CPU、memory.high/max、swap 和 tasks 限额。实际选值及选择器实现进入阶段身份，选值变化使回执失效。runs/run.*.resources.json 与阶段 events 记录所选预算；环境中只传不含秘密的资源数字及策略摘要。BB_RESOURCE_VITEST_WORKERS 表示默认 worker 建议或显式预算覆盖，wrapper 将默认值桥接到 server/Turbo 已有的 VITEST_MAX_WORKERS。既有显式正整数请求保留到冻结 CPU/内存容量允许的上限；显式 BB_RESOURCE_VITEST_WORKERS 另作 worker 上限。嵌套只允许继续收紧，不重新探测容量或放宽已冻结值。实际传入值以预算的 vitestWorkers 字段记录。server worker 配置仍可按现场有效容量进一步收紧。`node scripts/resource-worker-check.mjs --server-repo <带 server-worker-budget 配置及依赖的检出>` 使用独立微型 scope 运行真实 createVitest，仅解析两个 project，不执行测试。资源策略、可用的显式覆盖及低容量拒绝见 [resource-profile.md](../scripts/resource-profile.md)。

每轮结果分别记录验证、提升、运行时构建、tag；推送 tag 只表示已触发流水线，Release 和安装保留 `not-observed`，直到各自独立验收。`runs/run.*` 给出每段起止、耗时和失败状态；源码状态的 events 给出每次阶段执行/复用、耗时和失败/中断原因。

普通发布在安装前检查根目录是否为干净的 `main`；根目录有并行工作时保留现场，使用独立干净 clone，或先用 `--verify-only` 验证。不要移动用户文件来绕过提升检查。

Turbo 缓存统一在 `~/.cache/bb-turbo`（`run-resource-isolated` 和 `build-runtime.mjs` 都默认设置 `TURBO_CACHE_DIR`），
所以每次只有被改动分支触及的包及其下游会真正重新 typecheck 和构建，其余命中缓存。缓存目录可以随时删除，只影响速度。

手工分步时等价于：

```bash
scripts/fork-base --base <tag>              # 先确保 fork-base/<tag> 含最新安全基线
scripts/fork-aggregate                      # 只生成本地临时验证候选 aggregate-next
scripts/run-resource-isolated --profile package -- pnpm install --frozen-lockfile
scripts/run-resource-isolated --profile package -- pnpm exec turbo run typecheck --concurrency=1 --continue --output-logs=errors-only
scripts/run-resource-isolated --profile package -- pnpm exec turbo run test --concurrency=1 --continue --output-logs=errors-only --filter=<涉及的包>
scripts/fork-aggregate --promote-only       # 把已验证候选提升到 aggregate 并推送 origin/aggregate
scripts/fork-aggregate --promote            # 重新聚合并提升到 aggregate；已验证的候选用 --promote-only
```

全仓 typecheck 必须用 `--profile package --concurrency=1`：默认 verification 档（3G）加 turbo 默认并发会让 tsc 被内存限流卡住。
`run-resource-isolated` 启动前会释放上一次遗留的空 scope；scope 里仍有进程时它会拒绝并列出 pid，说明另一个验证还在跑。
提升、推送到 origin 和打包后的 tag 发布不需要再询问；替换本机运行中的 BB 服务需要用户明确授权，走 [local-aggregate-deploy](../.bb/skills/local-aggregate-deploy/SKILL.md)。

### 冲突怎么解决

脚本遇到冲突会停下，并判断是哪一类：

| 类型                  | 判断                                         | 处理                                                                                                                                              |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分支与上游冲突        | 该分支单独合入 `fork-base/<tag>` 就冲突      | 在该分支 worktree 里 `git rebase --no-autostash fork-base/<tag>`，修复、测试、`git push --force-with-lease origin <branch>`，重跑脚本。           |
| 安全基线与新 tag 冲突 | `security/baseline` 合入新 `desktop-v*` 冲突 | 在 `security/baseline` 上 `git merge <new-tag>`，解决并验证后普通推送，再运行 `scripts/fork-base --base <new-tag>`。                              |
| 分支之间冲突          | 单独都能合入，一起才冲突                     | 在 `.worktrees/aggregate-next` 里只做两边合并、不加新行为，`git add` 后 `git commit --no-edit`，重跑脚本。`rerere` 会记住这次解决，下次自动复用。 |

- 产品修复永远回到对应分支，不写在聚合的 merge 提交里。
- 独立的正确性修复继续保留独立分支；同一功能的补充分支、共享测试隔离设置可以在保留双方内容后收敛。减少清单行数不能代替减少实际改动和冲突。
- 分支与基线相同或多个分支 tip 相同，只是核对线索。先与升级前成功安装的聚合中对应 merge 的第二父提交比较，确认功能实际保留；不能通过重置到基线或另一个分支来解决功能迁移。
- 同一对分支反复出现非平凡冲突时，把后者 rebase 到前者上（叠放），更新清单顺序和说明。
- 叠放分支 rebase 时从栈底开始，用 `git rebase --update-refs` 让上层分支一起移动。

### 每日自动检查与汇报

`scripts/daily-fork-sync.sh <project-id> <checkout-path>` 供本机 cron 调用，调度信息保留在本机，不写进脚本。脚本从上游远端选择严格匹配 `desktop-vX.Y.Z` 的最新 tag，并将检查时的目标写入线程任务；这一轮始终使用该目标，后来出现的新版本留到下一轮。有更新时沿用聚合、验证、发布与已授权的本机部署流程，并在遇到冲突时继续解决；基线已更新但发布或安装未完成时仍接续交付，确认没有待交付变化后才仅汇报。

每日线程最终用简体中文报告相对更新前版本的新增功能、修复问题、测试结果、Release 与本机安装状态。上游变化核对稳定 tag 范围，fork 变化核对更新前实际运行包的 source；切换服务前保存比较起点和汇报上下文，恢复后继续交付。没有变化、未测试、未生效或失败均明确说明。

### 纳入上游新版本

1. 把 `.fork/branches` 的 `base` 改成新的 `desktop-v*` tag，运行 `scripts/fork-base --base <tag>`，再用 `scripts/fork-aggregate --preflight` 试跑。
2. 运行脚本，按上表逐个处理冲突。没有冲突的分支不用动。
3. 某个分支 rebase 后变空时，对照升级前 tip、对应上游提交和实际行为确认已吸收，再从清单移除，提交说明写明稳定版本与上游提交。仍被 worktree 使用或上游反馈链接引用的旧 ref 先保留；完成检查后再清理。
4. 验证、`--promote`，提交并推送 `fork-tooling` 上的新 `base`。

## 3. 发布预编译聚合包

`.github/workflows/fork-release.yml` 只在 `hxy91819/bb` 的 `fork-v*` tag 推送时运行。它直接构建 tag 对应的聚合代码，不在 CI 里重新聚合或 rebase，也不发布到 npm。

### 发布

功能、修复及影响安装产物的依赖改动完成必要验证和适用的 review 后，聚合与发布是默认收尾，已有持续授权，无需另问是否打包。先完成本任务分支的提交、推送与清单登记，再在整项任务最后统一运行 `scripts/fork-package`，跟踪它触发的 Release 流水线至结束；同一任务的中间检查点提交不反复发版。

用户或其他 Agent 已完成本任务的发布时，先核对产品内容、聚合 SHA、远端 tag 和成功的 Release 结果并复用。纯规则或文档改动只提交、推送并完成必要检查，不为相同产品重新打运行包；BB 维护规则提交到 `fork-tooling`，随下一次产品聚合进入 `aggregate`。用户明确要求仅验证、不推送或不发布时按其要求执行。构建或必要验证失败时先修复，不给失败结果打发布 tag；推送或发布实际受阻时明确交付尚未完成的步骤。

维护入口需要立即在默认 `main` 可用时，只将 AGENTS 的 Fork 维护规则块同步到 `security/baseline`，普通推送后运行 `scripts/fork-base`。维护脚本和完整文档仍从 `fork-tooling` 读取，不把产品聚合或整个 tooling 分支合入安全入口。

发布完成的凭据是本任务产品改动已进入已验证聚合、远端 tag 指向该聚合，以及对应流水线成功且 Release 资产齐全。只打 tag、推送分支、登记清单或看到流水线开始都不是发布完成。此授权覆盖个人 fork 的代码与 Release 发布；上游反馈和运行服务替换仍按各自的授权规则执行。

1. 完成聚合、必要验证、打包及提升，记录实际打包的聚合 SHA；确认它已推送到 `origin`，并包含发布 workflow。后续即使 `aggregate` 被其他任务移动，也使用这个已验证的 SHA。
2. 查询 fork 的发布 tag 和 Release。同一 SHA 已有成功发布的 `fork-v*` Release 时复用并交付链接；已有 tag 的流水线尚未成功时跟踪或重跑原任务，处理方法见下方「失败后重跑」。
3. 需要新增发布时，使用 `fork-v<上游基线版本>-<UTC日期YYYYMMDD>.<序号>` 的 annotated tag。序号从 1 开始，递增到本地和 origin 远端均未使用的名称，tag 指向第 1 步记录的 SHA，并只推送这个 tag 到 `origin`。
4. 核对远端 tag 解引用后的 commit SHA。流水线要 20 到 30 分钟，不要停下来盯着它：先完成构建、清理、cutover 提示等本地收尾，最后再用 `gh run watch` 等一次，确认 Release 已公开，Linux x64 包、校验文件及通用 SDK 三件资产齐全。
5. 交付 tag、聚合 SHA 和 Release 链接。tag 推送成功只代表已触发构建；流水线失败、无法查询或资产不全时，明确报告发布未完成。

以下是新发布的命令示例，版本、日期、序号和聚合 SHA 以本次打包结果为准：

```bash
git status --short
aggregate_sha='<本次打包时记录的聚合SHA>'
git show "${aggregate_sha}:.github/workflows/fork-release.yml"
git tag -a fork-v0.44.0-20261001.1 "$aggregate_sha" -m "BB fork aggregate 2026-10-01"
git push origin refs/tags/fork-v0.44.0-20261001.1
git ls-remote origin 'refs/tags/fork-v0.44.0-20261001.1^{}'
```

workflow 接受以 `fork-v` 和数字开头、后续只含字母、数字、点、下划线或连字符的 tag。新增发布使用新 tag；源码里的上游 package version 保持原值，包内 `release.json` 另行记录 fork tag、聚合 SHA、平台和 Node 版本。

在 [fork 的 Actions](https://github.com/hxy91819/bb/actions) 查看 `Release fork aggregate`。默认构建 Linux x64 自部署包、Windows x64 桌面安装器和通用 Plugin SDK。Linux 使用 GitHub 托管 runner 构建、检查 launcher、运行 tarball 集成验证，再解压验证 CLI、server/host-daemon 健康和内置插件。Windows 使用原生 Windows runner，复用上游 NSIS 打包与真实 Electron 启动验证。SDK 从同一个 tag/SHA 构建并冷安装检查全部 exports 的 runtime/types。三项全部通过才发布 [GitHub Release](https://github.com/hxy91819/bb/releases)。

| 包名后缀           | 目标机器                                              |
| ------------------ | ----------------------------------------------------- |
| `linux-x64.tar.gz` | Linux x86_64，glibc ≥ 2.35（Ubuntu 22.04 或同等系统） |
| `.exe`             | Windows x64，按用户安装的 Electron 桌面版             |

Linux 包包含 Node 24.15.0、生产依赖、网页、服务端、host daemon、CLI、SDK 和内置插件。Windows 安装器使用 Electron 自带运行时，包含同一聚合的界面和后台组件。两者均无需目标机器安装 Node、pnpm 或编译源码；Provider CLI 和登录仍由目标机器配置。

Windows 构建将桌面应用版本映射为 `<上游版本>-fork.<日期>.<序号>`，例如 `0.47.0-fork.20261030.2`，只在 CI 检出中生成，不修改仓库版本或 SDK 版本。安装器、blockmap、两种更新 metadata、SHA-256 和 `bb-fork-windows.json` 来源记录一起发布；来源记录绑定不可变 fork tag、完整 source SHA 和逐文件哈希。下载后校验 `.exe.sha256` 再安装。未配置 `WINDOWS_CERTIFICATE_PFX` / `WINDOWS_CERTIFICATE_PASSWORD` 时沿用上游无签名构建；两项必须同时配置或同时留空。

Windows 自动更新使用本 fork 的独立 `fork-desktop-latest` Release，构建时固定 `BB_DESKTOP_UPDATE_BASE_URL`，不会拉取上游安装包。CI 在不可变 fork Release 发布并回读 Windows 字节后，串行更新该频道：先追加每个版本的独立水位（不覆盖旧水位），再上传带版本名的二进制，最后更新 feeds 和来源记录，保留旧二进制。中途中断后水位仍阻止旧任务回退频道；同 tag 重跑复用已公开的原始资产，不要求重新构建的安装器字节相同。该频道是更新指针，实际发布来源以其 `bb-fork-windows.json` 指向的不可变 fork tag 为准。

流程仅使用 GitHub 自带的 `GITHUB_TOKEN`，发布 job 获得 `contents: write`；无需 npm token、Apple 签名证书或上游的 Blacksmith runner。Fork 的 Actions 需已启用。

### 独立插件开发使用 SDK

SDK 是通用 npm tarball，不是平台服务包。每次新 Release 额外包含：

- `bb-plugin-sdk-<fork-tag>.tgz`：完整的 `@get-bb/plugin-sdk`，保留源码中的包名与版本。
- 同名 `.tgz.sha256`：`sha256sum --check` 可读的校验文件。
- `bb-plugin-sdk-<fork-tag>.json`：`tag`、40 位聚合 `source` SHA、原 `package` / `version`、`filename`、`sha256`。记录不含构建路径。

不需要 npm token，也不向上游 `@get-bb` 发布包。同一个 SDK 版本号不表示 stock npm 包包含 fork API；插件应固定 Release 资产 URL，并提交 lockfile 中的 integrity。示例（将 tag 与 SHA 换成实际已验收的 Release）：

```bash
tag=fork-v0.46.0-20261014.1
source_sha='替换为该Release的40位聚合SHA'
stem="bb-plugin-sdk-${tag}"
url="https://github.com/hxy91819/bb/releases/download/${tag}"
curl -fLO "${url}/${stem}.tgz"
curl -fLO "${url}/${stem}.tgz.sha256"
curl -fLO "${url}/${stem}.json"
sha256sum --check "${stem}.tgz.sha256"
node /path/to/bb/scripts/fork-release/verify-sdk.mjs . "$tag" "$source_sha" /path/to/matching-bb-checkout
npm install --save-exact "@get-bb/plugin-sdk@${url}/${stem}.tgz"
git add package.json package-lock.json
```

`verify-sdk.mjs` 交叉核对来源记录、SHA、tag、实际 tgz 内的包名/版本以及匹配 BB checkout 的 SDK manifest；来源 SHA 还应与已解析的 Release tag commit 和平台包 `release.json` 的 `source` 一致。来源 JSON 与 checksum 用于一致性验证，信任根是固定的仓库和不可变 Release 资产，不是单独下载的 JSON。macOS 可用 `shasum -a 256 --check`。

构建循环中，先在已固定且干净的聚合候选上安装 frozen 依赖，再用同一脚本产出候选 SDK；输出目录必须在源码树外（或已被忽略），正常 gitignored 生成文件不算脏源码。无需先打 tag：若同名 tag 已存在，脚本要求它指向同一 SHA。

```bash
node /path/to/fork-tooling/scripts/fork-release/package-sdk.mjs /path/to/clean-candidate /tmp/sdk-candidate "$tag" "$source_sha"
node /path/to/fork-tooling/scripts/fork-release/smoke-sdk.mjs /tmp/sdk-candidate "$tag" "$source_sha" /path/to/clean-candidate
```

本机安装、构建和冷消费检查应放在既有资源隔离流程内串行执行。正式 Release 从同一聚合 SHA 使用相同脚本构建；候选包的字节 hash 不必与正式构建相同，正式 URL/integrity 以正式资产为准。插件 owner 联合验收后固定该 URL 和 lockfile；兼容声明写明实际验收的 BB fork tag 与聚合 SHA，不能仅写 SDK 原版本。BB 发布不依赖尚未发布的插件。

### 在其他机器安装

新装或升级目标实例时，同时按 [功能索引的外置插件更新流程](feature-index.md#升级时同步外置插件) 检查目标实例已安装的外置插件，包括插件集合、升级续跑、Account Limits 和 Usage。Account Limits 的新环境安装入口见[功能索引](feature-index.md#聚合环境中的-account-limits)。BB 安装包不会自动更新外置 Git/path 插件；兼容的新版本默认在同一项环境更新任务里完成安装和验收，保留目标机的配置与启停状态。

从 Release 下载 Linux x64 的 `.tar.gz` 和同名 `.sha256`：

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

历史 Release 的其他平台包继续保留；今后新增平台需明确修改 workflow 和资产校验，不加入默认发布依赖。保持解压目录完整，直接调用其中的 `bin/bb-app`、`bin/bb-server`、`bin/bb-host-daemon`、`bin/bb`；可以把该目录的 `bin` 加入 `PATH`，不要把启动脚本软链接到别处。脚本始终用包内的 Node，因此不受系统 Node 版本影响。

升级时下载并解压新包，停下旧实例，再让现有 service 的启动命令指向新包的 `bin/bb-app`（或原先使用的单独 server/host-daemon 启动入口）。默认仍使用 `~/.bb`；原有启动参数、数据目录和 service 环境变量应保留。包不会安装或重启服务。数据库 schema 变化时沿用部署流程的备份与迁移规则，同一个数据目录只运行一个实例。本机现有服务的切换仍按 [local-aggregate-deploy](../.bb/skills/local-aggregate-deploy/SKILL.md) 执行。

### 失败后重跑

构建或验证失败时修复所属分支，重新聚合后使用新 tag 发布。纯网络或 runner 故障可在 Actions 重跑原 tag。

上传从 draft Release 开始，全部资产上传成功才公开；上传中断时重跑会补全这个 draft。已经公开的 Release 保留原包，重跑核对源码 SHA 和 Linux、SDK、Windows 的完整资产清单，并回读 Windows 字节，不覆盖已发布包。需要修订已发布版本时使用新 tag。缺任何目标的必需资产会失败；历史已公开的 Release 不回填、不修改，沿用原 workflow。流程只更新本 fork 的 `fork-desktop-latest`，不修改 `desktop-latest`、`desktop-nightly` 或上游安装渠道。

## 4. 向上游反馈

分支本身就是上游 PR 的材料，这也是分支必须保持独立、基于 tag 的原因。

1. 先在 get-bb/bb 搜索是否已有相关 issue/PR；按 [docs/filing-issues.md](filing-issues.md) 准备内容。
2. **向 get-bb/bb 提 issue、评论或 PR 之前，必须把拟提交的内容给用户逐项确认。** 用户可以决定把它标为 `fork-only` 保留在本地。
3. 提 PR 时：`git rebase --onto upstream/main fork-base/<tag> <branch>`，只保留 feature commits 并去掉安全基线和聚合层，再推送到 origin 的 `upstream/<name>` 后开 PR；叠放分支要先把依赖部分一并处理或拆开。
4. 在 `.fork/branches` 更新该行的状态和链接（`reported` / `pr-open` / `fork-only`）。
5. 上游合并后，等它进入一个 `desktop-v*` tag 再从清单移除（见上一节第 3 步）。issue 关闭本身不是移除理由。

## 已废弃的做法

2026-09-23 之前使用过“一级来源 + 二级领域 + 冻结列车 + 登记表”的维护模型（`config/local-aggregate-features.json`、`config/local-aggregate-trains/`、`integration/*` 分支、`fork-candidate/*` tag）。它们已被本流程取代，不要恢复；历史内容保留在 tag `archive/two-tier-maintenance` 上。
