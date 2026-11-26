# 验证与回归测试

## 当前验证基线

| 条目 | 实际值 |
|---|---|
| 操作系统 | Linux |
| Node.js | 26.13.1 |
| npm | 12.2.3 |
| Bun（补充验证） | 1.4.2 |
| Pi SDK | @earendil-works/pi-coding-agent 1.6.1 |
| Pi TUI | @earendil-works/pi-tui 1.6.1 |
| Pi CLI（项目本地） | 1.6.1 |
| TypeScript | 7.0.2 |

项目的 Node.js 最低版本跟随 Pi 1.6.1 的官方 `engines.node >=22.19.0` 要求；开发与回归验证使用上表中的当前环境。

## 自动化验证

常规验证：

```bash
npm ci
npm run verify
bun test tests
npm pack --dry-run
```

`npm run verify` 等价于 `tsc --noEmit` 与 `node --test tests/*.test.mjs`。测试不调用大模型，也不需要 API Key。

当前自动化套件共 **23 项**，覆盖：

- frontmatter 解析、默认值、排序、非法 Skill 声明、符号链接与超大文件过滤；
- 单文件 16 KiB 与选中正文 32 KiB 上限；
- prepend / append 拼接、显式 `/skill:name` 优先级与单 Skill 约束；
- 默认关闭、once / sticky、会话重置、扩展来源输入过滤与图片保留；
- TUI 多选、预览、滚动、清空、模式切换、Widget 状态与非 TUI 提示；
- 已加载 / 未加载 Skill 的选择限制、重新加载检测与失效选择清理；
- 真实 Pi SDK `loadExtensions()` 加载、原生 Skill 展开与 Snippet 文件热加载。

Node.js 与 Bun 两套测试运行器都应为 **23/23 通过、0 失败**。

## 集成测试边界

集成测试使用 Pi 1.6.1 的真实 SDK loader、`AgentSession.prototype._expandSkillCommand` 和扩展运行时接口；TUI 交互通过实现 `ctx.ui.custom` 的测试上下文驱动，因此可以验证扩展回调、菜单状态和消息变换，但不等同于人工终端验收。

需要人工检查真实终端交互时，在项目目录运行：

```bash
./node_modules/.bin/pi --no-extensions -e .
```

启用后的 Snippet 会进入用户消息正文，因此已经发送的内容仍可能保留在会话历史中；关闭 once / sticky 只影响后续消息。
