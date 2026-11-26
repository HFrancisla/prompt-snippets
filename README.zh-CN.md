# pi-prompt-snippets

[English](README.md) | [简体中文](README.zh-CN.md)

一个按需组合 Markdown 指令的 [Pi](https://github.com/earendil-works/pi) 扩展。只在用户显式选择后，向当前用户消息插入片段，不常驻修改系统提示词。

基于 [amosblomqvist/prompt-snippets](https://github.com/amosblomqvist/pi-config/tree/main/extensions/prompt-snippets) 的思路，增加 `once`/`sticky`、可选原生 Skill 激活等功能。

## 安装

```bash
pi install npm:@hfrancisla/pi-prompt-snippets
```

重启 Pi 或执行 `/reload`。要求 Node.js >=22.19 和 Pi 1.6.1。

## 使用

| 操作 | 效果 |
| --- | --- |
| `Alt+S` / `/snippets` | 打开终端片段选择菜单 |
| `/snippets list` | 显示可用片段 ID |
| `/snippets once` | 下一条用户消息生效一次（默认） |
| `/snippets sticky` | 持续应用于后续消息 |
| `/snippets off` | 清空选择并关闭注入 |

**Space** 勾选、**Tab** 预览、**M** 切换模式、**Enter** 应用。默认不开启；使用时重新读取文件；扩展产生的输入不注入。已发送的片段内容仍可能保留在会话历史中。

## 自定义片段

在包的 `snippets/` 目录中添加 Markdown：

```markdown
---
name: Concise
description: Keep answers brief
placement: append
order: 50
---
请简洁回答，突出可执行的步骤。
```

`name`、`description`、`placement`（`prepend`/`append`）和 `order` 均可选。`skill: skill-name` 可引用**已加载**的 Pi 原生 Skill，必须明确设置 `placement: prepend`；一次最多选一个含 Skill 的片段。frontmatter 使用简单解析器，并非完整 YAML。

单文件上限 16 KiB，组合正文上限 32 KiB。详情见[设计说明](docs/DESIGN.zh-CN.md)和[测试记录](TESTING.md)。

## 开发

```bash
npm ci
npm run verify       # 类型检查 + 测试
npm pack --dry-run   # 确保包含 snippets/ 目录
```

## 发布

版本：**0.2.0**。

```bash
npm publish --access public
```

MIT 协议，详见 [LICENSE](LICENSE)。
