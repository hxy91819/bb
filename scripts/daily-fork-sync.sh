#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

project_id=${1:?Usage: daily-fork-sync.sh <project-id> <checkout-path>}
checkout_path=${2:?Usage: daily-fork-sync.sh <project-id> <checkout-path>}
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$checkout_path"

echo "=== $(date -Iseconds) 开始检查上游版本 ==="

/usr/bin/git fetch --no-tags origin 'refs/tags/desktop-v*:refs/tags/desktop-v*'

latest_tag=$(node "$here/fork-inputs.mjs" latest "$PWD")
echo "上游最新稳定版本: $latest_tag"

current_base=$(/usr/bin/git show fork-tooling:.fork/branches 2>/dev/null | awk '$1=="base"{print $2}')
if [[ -z "$current_base" ]]; then
  echo "错误: 无法读取当前基线"
  exit 1
fi
echo "当前基线: $current_base"

if [[ "$latest_tag" == "$current_base" ]]; then
  echo "上游基线无变化，创建安装进度检查与每日结果汇报线程"
fi

echo "创建每日检查、更新及结果汇报线程: $current_base -> $latest_tag"

prompt_file=$(mktemp)
trap 'rm -f "$prompt_file"' EXIT
cat > "$prompt_file" <<'EOF'
检查上游稳定版本，每次结束都在本线程向用户输出简体中文日报。先记录更新前的上游基线，以及本机实际运行包 release.json 的 tag/source，作为本次变化的比较起点。上游基线已是本次目标时，仍须核对上次聚合、Release 和本机安装是否完成：有未完成交付时按其记录接续，不能因 base 已提交就宣称无需升级；确认没有待交付变化后才报告“今日无新增功能或修复”，并注明未执行测试或部署。

如果有新版本则执行以下操作：

1. 保持根目录 main，在 fork-tooling 的独立 worktree 中把 .fork/branches 的 base 更新为本次固定目标；后续出现的新稳定版留到下一轮
2. 提交并推送 fork-tooling
3. 先执行 scripts/fork-base --base <本次固定目标>，再执行 scripts/fork-aggregate --preflight --base <本次固定目标>，集中处理冲突，最后执行 scripts/fork-package --base <本次固定目标>；中断后按脚本输出的 --resume <sha> 接续，不手工跳过阶段
4. 聚合成功后，使用 local-aggregate-deploy skill 将新版本安装到本机服务

遇到冲突时自动解决：
- 分支与上游冲突：在该分支 worktree 里 rebase --no-autostash 到 fork-base/<本次固定目标>，修复、测试、push --force-with-lease 到 fork
- 分支之间冲突：在聚合 worktree 里只做两边合并（不加新行为），git add 后 git commit --no-edit，rerere 会记住解决
- 修复回到所属分支；用重置到基线或其他分支消除冲突不等于保留功能。移除分支前核对升级前 tip 和目标上游的实际行为。

结果汇报要求：
- 先说本次成功、失败或无更新，以及更新前后版本。
- 分别列出“新增功能”和“修复问题”，用用户能理解的话解释具体行为及影响；不只列版本号、提交标题或测试通过。
- 上游变化以更新前后稳定 tag 之间的 Release notes、提交和实际代码差异为依据；fork 自有变化以更新前运行包 source 到本次聚合 source 的实际变化为依据，去掉重复与早已存在的内容。没有的类别写“无”。
- 说明必要测试结果、Release 链接及本机实际安装/健康检查结果。未安装成功的变化标为“待生效”，不声称已可用；失败也报告已完成步骤和阻塞原因。
- 服务切换前把比较起点、已核实的功能/修复清单和未完成的汇报要求写入恢复上下文；恢复后继续验收并交付日报。
- 证据不足时明确写无法确认，不猜测新增功能或修复。不把未运行的测试写成通过。
EOF
printf '\n本次固定上游目标：%s\n检查时基线：%s\n' "$latest_tag" "$current_base" >> "$prompt_file"
printf '本次维护脚本目录：%s\n预检入口：%s/fork-aggregate --preflight --base %s\n打包入口：%s/fork-package --base %s\n优先使用上述 fork-tooling 入口，根目录聚合中的脚本可能仍是旧版。根目录有未提交或未跟踪工作时保留现场，使用独立干净 clone 打包。\n' "$here" "$here" "$latest_tag" "$here" "$latest_tag" >> "$prompt_file"

if bb thread spawn \
  --prompt-file "$prompt_file" \
  --title "Daily fork sync and deploy" \
  --project "$project_id" \
  --environment "$checkout_path"; then
  echo "=== $(date -Iseconds) BB 线程已创建，将由 Agent 执行完整流程 ==="
else
  echo "=== $(date -Iseconds) BB 线程创建失败 ==="
  exit 1
fi
