# pi-prompt-snippets

一个用于 **@earendil-works/pi-coding-agent 1.3.0** 的小型 Pi 扩展：把可组合的 Markdown 行为指令按需放到 **当前用户消息正文** 的前面或后面，而不常驻系统提示词。

灵感来源：[amosblomqvist/pi-config/prompt-snippets](https://github.com/amosblomqvist/pi-config/tree/main/extensions/prompt-snippets)。独立实现并增加了持续模式、可选 Skill 引用、显式来源过滤和注入大小限制。

## 功能与原则

- 默认所有规则关闭，只有**人工选择** Snippet 后才会注入。
- `Alt+S` 或 `/snippets` 打开 TUI 多选菜单。每个 Snippet 在列表中只占一行：勾选标记、名称、可选 Skill 名称或状态标签、简短 description；超出终端宽度的内容单行截断。`Space` 勾选，`Tab` 查看完整正文和元数据，`M` 切换一次性/持续模式，`R` 清空，`Enter` 应用，`Esc` 取消。
- 默认 `once`：只应用于下一条交互/RPC 输入；`sticky`：连续应用直到关闭、规则删除或切换会话。
- 选中规则时，在编辑器附近显示轻量状态 Widget：使用主题次要文本色（`muted`）加粗标题 `┃ Snippets [once]`（竖线为暗色；不与 prepend 共用强调色），并在下面的 `prepend` / `append` 项目前显示低对比度竖线 `│`，与普通对话文本区分但不额外增加行数；取消全部规则后自动隐藏。
- 每次发送或打开菜单都重新读取 Markdown；不需要 `/reload`。
- `prepend` 组先于原始消息，`append` 组后于原始消息，各组按 `order` / 名称排序；两部分用空行分隔。
- 输入来自其他扩展（`source=extension`）时不消费选择状态，也不插入规则。
- 保留消息中的 `images`，不注册任何模型工具，不调用模型，不修改 system prompt。
- 单个片段限制 16 KiB，选中正文总量限制 32 KiB；超限片段会被忽略并取消选择。
- 已经发送到对话的 snippet 文本仍可能出现在历史上下文中，直到会话压缩或裁剪。

## 使用方法

| 操作 | 效果 |
| --- | --- |
| `Alt+S` / `/snippets` | 打开交互式选择菜单 |
| `/snippets list` | 查看可用片段文件名 |
| `/snippets sticky` | 已启用的规则在连续消息中生效 |
| `/snippets once` | 恢复下一次发送后自动清空 |
| `/snippets off` | 立即关闭所有片段 |

仅 `/snippets` 交互选择菜单需要 TUI。命令参数也可在具备命令执行能力的其它 Pi 宿主中使用；实际对话变换支持 `interactive` 与 `rpc` 来源。

### 添加自定义规则

在 `snippets/` 里添加 Markdown 文件，例如 `snippets/concise.md`：

~~~markdown
---
name: Concise
description: Keep technical replies focused
placement: append
order: 50
---
Give a compact technical answer with concrete evidence. Avoid irrelevant preamble.
~~~

`name`、`description`、`placement`、`order` 和 `skill` 都是可选字段。`placement` 可为 `prepend` 或 `append`，默认 `append`；`order` 默认 `9999`。只有写了 `skill` 才必须明确指定 `placement: prepend`。必须包含 frontmatter 分隔符；普通 Snippet 需要非空正文，如果声明了合法的 `skill`，正文可以为空。

注意：frontmatter 使用**简单键值行解析**，不是完整的 YAML 解析器；请不要使用 YAML 列表、嵌套结构或多行字面量。

### Snippet 中声明 Skill

可以直接在 YAML 风格的 frontmatter 中增加 `skill: <skill-name>`。例如 `skill: code-review`：

~~~markdown
---
name: Code Review
description: 用指定 Skill 执行代码审查
skill: code-review
placement: prepend
order: 20
---
重点检查性能、并发安全与异常处理，只报告问题，不直接修改代码。
~~~

字段填写 **Skill 名称**，而不是 `/skill:code-review` 或文件路径。名称必须符合 Pi Skill 命名约定：小写字母、数字和单个连字符，最长 64 字符。代码样例见 [examples/review-with-skill.md](./examples/review-with-skill.md)。

选中含有 `skill` 的 Snippet 后，扩展先将消息变为 `/skill:code-review <前置规则 + 用户任务 + 后置规则>`，再交给 Pi 1.3 的原生 Skill 展开器。因为 Skill 命令被提升到消息开头，即使其他 Snippet 使用 `placement: prepend` 也不会遮挡它。

使用规则：

- `skill` **仅允许在显式声明 `placement: prepend` 的 Snippet 中使用**。省略 `placement`（默认 `append`）、设置 `placement: append` 或名称不合法时，整个 Snippet 会被忽略。
- 单个 Snippet 的 `skill` 只能填写**一个字符串名称**；不允许重复 `skill:` 字段、逗号分隔的多个名称或 YAML 列表。
- 一次选中的组合中最多只能存在一个包含 `skill` 的 Snippet，即使两个 Snippet 指向相同 Skill，也只能选一个。选中一个 Skill Snippet 后，菜单中的其他已加载 Skill Snippets 会显示为灰色 `[-] Name [locked] — Description`，按 `Space` 不会选中，并提示先取消当前 Skill；`Tab` 仍可预览。取消当前 Skill 或按 `R` 清空后，其他已加载 Skill Snippets 重新可选。普通 Snippets 可继续自由多选。
- 没有声明 `skill` 时，完全保持旧版行为。
- 用户主动输入 `/skill:another-skill ...` 时，显式指定优先；Snippet 正文仍然拼接进入任务参数。
- 运行时通过 `pi.getCommands()` 检查**当前会话实际加载**的 Skill（命令来源为 `skill`），而不是仅扫描文件系统。未安装或未加载的 Skill Snippet 仍显示在 `Alt+S` 菜单中，但标记为灰色 `[-] Name [missing] — Description`，按 `Space` 无法选中，`Tab` 预览会提示先安装并 `/reload`。重新加载后再打开菜单即可检测是否恢复。
- 如果 Skill 在已经选中的状态下变为不可用，扩展在下一次打开菜单或发送消息时会取消该 Snippet 的选择并通知用户，其他普通 Snippets 保持生效。若宿主没有提供可用的命令目录，扩展不会把“无法检测”误判为“未安装”。
- 本次收紧了解析与选择规则，更新扩展代码后需执行一次 `/reload` 或重启 Pi；只改 Markdown 内容继续支持即时热加载。

注意：完整 Skill 内容仍由 Pi 原生展开机制读取，并不是 Snippet 扩展自己加载 `SKILL.md`。其他扩展如果在我们之后改写消息并抢占消息开头，理论上仍可能干扰 Skill 展开。

## 开发与兼容环境

已验证：

- WSL2 Ubuntu，Node.js **24.15.0**。
- `@earendil-works/pi-coding-agent` **1.3.0**，`@earendil-works/pi-tui` **1.3.0**。
- TypeScript `tsc --noEmit` 通过。
- SDK 提供的真正 `loadExtensions()`：发现单个扩展，注册 `session_start`、`input`、`/snippets`、`Alt+S`；不注册任何工具。
- 自动化测试覆盖 parser、排序、热加载、直接多选、上下文注入、取消、终端导航、once/sticky 模式、来源筛选、图片保留、会话重置、删除规则和尺寸上限。

执行：

~~~bash
cd /home/hzf/workspace/projects-dev/pi-extensions-mine/prompt-snippets
npm ci
npm run verify
~~~

测试不会调用大模型，也不要求 API Key。详情见 [TESTING.md](./TESTING.md)。

## 试运行与正式启用

先进行**隔离加载**，避免和已启用的扩展发生命令或快捷键冲突：

`pi --no-extensions -e /home/hzf/workspace/projects-dev/pi-extensions-mine/prompt-snippets`

在 Pi 中通过 `Alt+S` 勾选多个 Snippets，发送一条消息并检查转化结果；再测试 `/snippets sticky` 与 `/snippets off`。手动交互测试可能涉及当前配置的模型和调用费用。

确认无冲突后，可手动执行 `pi install /home/hzf/workspace/projects-dev/pi-extensions-mine/prompt-snippets`，然后重新打开 Pi 或执行 `/reload`。

**本次开发没有修改** `~/.pi/agent/settings.json`，也没有自动安装或替换任何现有的 Pi 扩展。

## 项目结构

~~~text
prompt-snippets/
├── index.ts             # Pi SDK 事件钩子、TUI、命令和快捷键
├── core.ts              # 解析、加载、过滤、排序、消息拼接
├── snippets/            # Markdown 规则内容
├── examples/            # 可选的 Skill 引用示例（不自动加载）
├── tests/               # 纯函数 + 真实 SDK 加载器集成测试
├── package.json
├── tsconfig.json
└── TESTING.md
~~~

## 与上游原版的差异

- 增加了 `once`/`sticky` 模式，以及 frontmatter `skill:` 引用。
- 忽略其他扩展产生的输入，以免错误注入或消费用户选择。
- 加入单文件 16 KiB、总正文 32 KiB 的上限，并显式过滤无效 Markdown 和软链接。
- 更关注可验证性，包含 SDK 真实加载器及自动化交互测试。
- 仍然选择修改用户消息正文，而不是修改 System Prompt、注册模型工具或自动从用户任务猜测要开启的规则。
