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
scripts/fork-aggregate            # 生成 .worktrees/aggregate-next 上的 aggregate/next
scripts/fork-aggregate --promote  # 成功后移动根目录 local/aggregate 并推送到 fork
```

脚本从基线 tag 开始，依次 `merge --no-ff` 清单中的分支。每次都从头生成，没有中间状态需要维护。
验证通过后再 `--promote`。在 `.worktrees/aggregate-next` 里：

```bash
scripts/run-resource-isolated --profile package -- pnpm install --frozen-lockfile
scripts/run-resource-isolated --profile package -- pnpm exec turbo run typecheck --concurrency=1 --output-logs=errors-only
scripts/run-resource-isolated --profile package -- pnpm exec turbo run test --concurrency=1 --output-logs=errors-only --filter=<本次冲突/改动涉及的包>
```

全仓 typecheck 必须用 `--profile package --concurrency=1`：默认 verification 档（3G）加 turbo 默认并发会让 tsc 被内存限流卡住几十分钟。
测试只跑本次改动或冲突涉及的包；各分支自己的测试在分支上已经跑过。
提升与推送到 fork 不需要再询问；替换本机运行中的 BB 服务需要用户明确授权，走 [local-aggregate-deploy](../.bb/skills/local-aggregate-deploy/SKILL.md)。

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

## 3. 向上游反馈

分支本身就是上游 PR 的材料，这也是分支必须保持独立、基于 tag 的原因。

1. 先在 get-bb/bb 搜索是否已有相关 issue/PR；按 [docs/filing-issues.md](filing-issues.md) 准备内容。
2. **向 get-bb/bb 提 issue、评论或 PR 之前，必须把拟提交的内容给用户逐项确认。** 用户可以决定把它标为 `fork-only` 保留在本地。
3. 提 PR 时：从该分支 rebase 到 `origin/main` 得到一个新分支（如 `upstream/<name>`）推送到 fork，再开 PR；叠放分支要先把依赖部分一并处理或拆开。
4. 在 `.fork/branches` 更新该行的状态和链接（`reported` / `pr-open` / `fork-only`）。
5. 上游合并后，等它进入一个 `desktop-v*` tag 再从清单移除（见上一节第 3 步）。issue 关闭本身不是移除理由。

## 已废弃的做法

2026-09-23 之前使用过“一级来源 + 二级领域 + 冻结列车 + 登记表”的维护模型（`config/local-aggregate-features.json`、`config/local-aggregate-trains/`、`integration/*` 分支、`fork-candidate/*` tag）。它们已被本流程取代，不要恢复；历史内容保留在 tag `archive/two-tier-maintenance` 上。
