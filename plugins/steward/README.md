# 管家

管家技能的看门狗脚本自动登记会话，标题列直接打开工作簿、要求帐的 BB 内建 Markdown 预览。浮窗可收合，摘要按需运行现有 Python `check` / `ledger-check`，不在渲染时执行检查。手机标题列使用有可存取名称的图示，浮窗放在上方并限制高度，避开输入区。

`bb steward --help` 提供 register、show、unregister、refresh；RPC 使用相同实现。文件路径和 checker 路径指向会话所属 host。线程 metadata 是登记唯一来源；重载保留登记。同一 host、Git 主仓库、工作簿相对路径的接任串行处理，失败可重新登记修复。切换环境不会改变已登记文件。

本版只支持磁盘文件，Git-ref 登记由技能脚本明确跳过 UI，不显示另一版本的磁盘内容。检查结果只证明格式检查，业务验收仍由管家负责。

使用 `bb plugin build plugins/steward` 构建后，以 `bb plugin install <完整插件目录> --yes` 本地安装。此插件依赖独立安装的 bb-steward 技能，不加入官方商店目录。

浮窗由当前焦点会话的标题列组件通过 React portal 挂载到页面，保留会话的文件导航能力；全局 overlay 槽位没有会话文件预览能力。导航返回 false 时显示可见提示。
