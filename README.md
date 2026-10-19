# pi-prompt-snippets

[English](README.md) | [简体中文](README.zh-CN.md)

A [Pi](https://github.com/earendil-works/pi) extension for opt-in, composable Markdown instructions. Inserts selected snippets into the current user message without permanently changing the system prompt.

Inspired by [amosblomqvist's prompt-snippets](https://github.com/amosblomqvist/pi-config/tree/main/extensions/prompt-snippets), with once/sticky modes and optional native Skill activation.

## Install

```bash
pi install npm:@hfrancisla/pi-prompt-snippets
```

Restart Pi or run `/reload`. Requires Node.js >=22.19 and the Pi 1.3 API.

## Usage

| Action | Behavior |
| --- | --- |
| `Alt+S` or `/snippets` | Select snippets in the terminal |
| `/snippets list` | Show available snippet IDs |
| `/snippets once` | Apply once on the next user message (default) |
| `/snippets sticky` | Keep applying to subsequent messages |
| `/snippets off` | Clear selections and disable injection |

Use **Space** to select, **Tab** to preview, **M** to switch modes, and **Enter** to apply. Snippets are off by default, reloaded from disk on use, and ignored for extension-generated inputs. Previously inserted text may remain in chat history.

## Custom Snippets

Add `.md` files to this package's `snippets/` directory:

```markdown
---
name: Concise
description: Keep answers brief
placement: append
order: 50
---
Answer succinctly and focus on actionable details.
```

`name`, `description`, `placement` (`prepend` / `append`), and `order` are optional. A `skill: skill-name` field activates a **loaded** native Pi Skill; it requires explicit `placement: prepend`, and at most one Skill snippet may be selected. Files use a simple frontmatter parser, not full YAML.

Snippets are limited to 16 KiB each and 32 KiB combined. See [design details](docs/DESIGN.zh-CN.md) and [test notes](TESTING.md).

## Development

```bash
npm ci
npm run verify       # Typecheck and tests
npm pack --dry-run   # Ensure snippets/ is included
```

## Release

Version: **0.1.0**.

```bash
npm publish --access public
```

MIT License. See [LICENSE](LICENSE).
