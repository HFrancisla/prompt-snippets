# 兼容性与回归测试

## 环境

| 条目 | 实际值 |
|---|---|
| 操作系统 | WSL2 Ubuntu（通过 AgentDock 远程执行） |
| Node.js | 24.15.0 |
| Bun（补充验证） | 1.4.2 |
| Pi SDK | @earendil-works/pi-coding-agent 1.3.0 |
| Pi TUI | @earendil-works/pi-tui 1.3.0 |
| TypeScript | 5.9.3 |

## 兼容性验证结果（2026-10-19）

- `npm ci --ignore-scripts --no-audit --no-fund`：之前已完成干净安装，共 121 个依赖包。
- `npm run verify`：**TypeScript 类型检查通过，Node.js 自动化测试 24/24 通过、0 失败**。
- `bun test tests`：Bun 1.4.2 环境下运行同一套 24 项自动化测试。
- Pi 1.3 原生 Skill 展开器：使用真实 `AgentSession.prototype._expandSkillCommand` 将 Snippet 产生的 `/skill:code-review` 输入展开为包含 `SKILL.md` 正文的 Skill block。
- 已测试 Widget 标题的主题强调色、竖线分隔、once/sticky 显示与关闭隐藏；前置/后置 Snippet 混合、显式 Skill 优先、失效 Skill 回退、多个 Skill Snippets 选择约束、合法及非法 Skill 名称。菜单测试覆盖单行紧凑显示（名称、Skill 标签、description）、灰色锁定、未安装 Skill 灰色提示及禁选、Tab 预览原因、Skill 重新加载后恢复选择、已选 Skill 在会话中途消失后自动解除选择、普通 Snippets 持续生效；还验证同名扩展命令不冒充已安装 Skill。解析器拒绝缺少 prepend、append 下声明 skill、重复 skill 键和多值写法。
- 真实 Pi 1.3 SDK loader：1 个扩展、2 个事件钩子、1 个命令、1 个快捷键、**0 个模型工具**、0 个加载错误。

## 测试方法

命令：`npm run verify`（等价于 `tsc --noEmit` 与 Node 内置 `node --test tests/*.test.mjs`）。无需真实 LLM 或 API Key。

单元测试：检查 frontmatter 解析、默认值、排序、无效文档跳过、符号链接跳过、文件热加载、正文拼接、选中规则总大小限制。

集成测试：直接加载真实 SDK 模块 `dist/core/extensions/loader.js`，调用 `loadExtensions([root], root)` 并验证注册情况，再利用 mock TUI/RPC 上下文触发**真实插件导出的命令和事件回调**；不只是用假的 SDK 对象测试源函数。

覆盖结果：未启用时不改写；手动多选及单次自动复位；图片附件保留；扩展来源输入忽略；sticky 连续发送、关闭及 session_start 清空；菜单直接选择、预览、取消、滚动；无 TUI 提示；已移除旧预设命令的处理验证；复制插件到临时目录之后通过 SDK 加载器验证前置规则、文件内容热更新及删除后清理。

## 边界与限制

- **真实 SDK 与 Skill 展开验证 ≠ 完整 Pi 用户交互验收**：Skill 展开测试使用临时创建的示例 `SKILL.md`，验证真实 SDK 解析路径，但没有通过终端人工键入并与真实模型对话，也未操作私有 `~/.pi/agent` 主配置。
- 交互测试使用实现了 `ctx.ui.custom` API 的模拟 TUI，验证 UI 控件的回调和状态转移，但无法覆盖每一种真实终端键盘/渲染组合。
- 启用后的规则作为用户消息正文进入会话历史，单次开关并不会从历史上下文移除之前注入的内容。
- 已验证的是当前本机安装并在测试依赖中固定的 **earendil-works 1.3.0**；不宣称其它 Pi 分支和未来版本兼容。

测试若失败，应先以 `npm run typecheck` 排除类型/API 不兼容，再以 `npm test` 定位功能退化，并在 `pi --no-extensions -e <path>` 模式下人工验收。
