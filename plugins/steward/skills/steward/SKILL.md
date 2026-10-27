---
name: steward
description: 查看 BB 管家插件的文件绑定与检查结果；管家技能的脚本会自动登记，无须模型另行使用插件。
---

# 管家平台入口

日常启动按 bb-steward 的会话开始步骤执行，看门狗自动登记；无需额外调用插件。

诊断使用 `bb steward show --thread <id> --json` 查看绑定，`bb steward refresh --thread <id> --json` 在文件所属主机按需运行工作簿和要求帐检查。解除使用 `bb steward unregister --thread <id>`。文件移动后重新执行原管家登记步骤。

手动登记与脚本共用 RPC：`bb steward register --thread <id> --topic <名称> --workbook <绝对路径> --ledger <绝对路径> --checker <steward_workbook.py 绝对路径>`。接任撤销同目标旧线程标记，不改变线程标题或权限。`--ref` 不受支持；远端分支工作簿保留原技能流程和回复文件链接。
