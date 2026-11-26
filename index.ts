/**
 * Opt-in prompt rules for Pi 1.6.1.
 * No model-facing tools, system prompt hooks, or automatic snippet injection.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
  composeMessage, explicitSkillName, getActive, keepOneSkill, loadSnippets, type Mode, type Snippet,
} from "./core.ts";

const root = dirname(fileURLToPath(import.meta.url));
const snippetsPath = join(root, "snippets");
const widgetId = "hfrancisla-prompt-snippets";

function windowSlice(
  lines: string[], scroll: number, limit: number, focus?: number,
): { rows: string[]; scroll: number } {
  const clipped = lines.length > limit;
  const count = clipped ? Math.max(1, limit - 2) : limit;
  let start = Math.max(0, Math.min(scroll, Math.max(0, lines.length - count)));
  if (focus !== undefined) {
    if (focus < start) start = focus;
    if (focus >= start + count) start = focus - count + 1;
  }
  start = Math.max(0, Math.min(start, Math.max(0, lines.length - count)));
  const rows = lines.slice(start, start + count);
  if (!clipped) return { rows, scroll: start };
  return {
    rows: [
      start ? "  ↑ " + start + " more" : "",
      ...rows,
      start + count < lines.length ? "  ↓ " + (lines.length - start - count) + " more" : "",
    ],
    scroll: start,
  };
}

export default function activate(pi: ExtensionAPI): void {
  let snippets: Snippet[] = [];
  let selected = new Set<string>();
  let applyMode: Mode = "once";

  // Pi exposes the names of Skills actually discoverable in the current session.
  // A missing runtime binding (e.g., loader-only tests) is UNKNOWN, not "not installed".
  function availableSkills(): Set<string> | undefined {
    try {
      return new Set(
        pi.getCommands()
          .filter((command) => command.source === "skill" && command.name.startsWith("skill:"))
          .map((command) => command.name.slice("skill:".length)),
      );
    } catch {
      return undefined;
    }
  }

  function refresh(): void {
    snippets = loadSnippets(snippetsPath);
    const existing = new Set(snippets.map((s) => s.id));
    selected = new Set([...selected].filter((id) => existing.has(id)));
    if (selected.size === 0) applyMode = "once";
  }

  function enforceSelection(ctx: ExtensionContext): void {
    const withinBudget = getActive(snippets, selected);
    const available = availableSkills();
    const missing = available === undefined
      ? []
      : withinBudget.filter((item) => item.skill && !available.has(item.skill));
    const eligible = withinBudget.filter((item) => !missing.includes(item));
    const { kept, ignored } = keepOneSkill(eligible);
    if (withinBudget.length !== selected.size) {
      ctx.ui.notify("Some snippets exceeded the 32 KiB prompt budget and were deselected", "warning");
    }
    if (missing.length) {
      ctx.ui.notify("Missing or unloaded Skill(s): " +
        missing.map((item) => item.skill).join(", ") + ". Deselected. Install and /reload.", "warning");
    }
    if (ignored.length) {
      ctx.ui.notify("Only one skill Snippet can be enabled; deselected: " +
        ignored.map((snippet) => snippet.name).join(", "), "warning");
    }
    selected = new Set(kept.map((snippet) => snippet.id));
    if (selected.size === 0) applyMode = "once";
  }

  function renderWidget(ctx: ExtensionContext): void {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    const active = getActive(snippets, selected);
    if (active.length === 0) {
      ctx.ui.setWidget(widgetId, undefined);
      return;
    }
    const prepends = active.filter((s) => s.placement === "prepend").map((s) => s.name);
    const appends = active.filter((s) => s.placement === "append").map((s) => s.name);
    // Distinguish persistent status from ordinary assistant prose without extra rows.
    const rail = ctx.ui.theme.fg("dim", "│ ");
    const title = ctx.ui.theme.fg("muted", ctx.ui.theme.bold("Snippets"));
    const mode = ctx.ui.theme.fg("dim", " [" + applyMode + "]");
    const lines = [ctx.ui.theme.fg("dim", "┃ ") + title + mode];
    const skills = [...new Set(active.flatMap((snippet) => snippet.skill ? [snippet.skill] : []))];
    if (skills.length) lines.push(rail + ctx.ui.theme.fg("accent", "skill: " + skills.join(" · ")));
    if (prepends.length) lines.push(rail + ctx.ui.theme.fg("accent", "↑ " + prepends.join(" · ")));
    if (appends.length) lines.push(rail + ctx.ui.theme.fg("warning", "↓ " + appends.join(" · ")));
    ctx.ui.setWidget(widgetId, lines);
  }

  async function openMenu(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI || ctx.mode !== "tui") {
      ctx.ui.notify("Snippet menu requires interactive TUI mode", "warning");
      return;
    }
    refresh();
    enforceSelection(ctx);
    if (!snippets.length) {
      ctx.ui.notify("No valid snippets in " + snippetsPath, "warning");
      renderWidget(ctx);
      return;
    }
    const working = new Set(selected);
    let workingMode: Mode = applyMode;

    const confirmed = await ctx.ui.custom<boolean>((tui, theme, _keys, done) => {
      let cursor = 0;
      let listScroll = 0;
      let previewScroll = 0;
      let preview = false;
      let note = "";

      return {
        render(width: number): string[] {
          const usable = Math.max(8, width);
          const height = Math.max(3, tui.terminal.rows - 9);
          let rows: string[];
          let heading: string;
          let hints: string;
          if (!preview) {
            const textRows: string[] = [];
            const indexRows: number[] = [];
            let previous = "";
            const activeSkill = snippets.find((snippet) => snippet.skill && working.has(snippet.id));
            const available = availableSkills();
            for (let i = 0; i < snippets.length; i++) {
              const item = snippets[i];
              if (previous !== item.placement) {
                textRows.push(theme.fg("dim", item.placement === "prepend" ? "↑ PREPEND" : "↓ APPEND"));
                previous = item.placement;
              }
              indexRows[i] = textRows.length;
              const missing = !!item.skill && available !== undefined && !available.has(item.skill);
              const locked = !!item.skill && !!activeSkill && activeSkill.id !== item.id;
              const marker = i === cursor ? "> " : "  ";
              const desc = item.description ? " — " + item.description : "";
              if (missing || locked) {
                // One dimmed row per Snippet. Details and full Skill name remain in Tab preview.
                const status = missing ? "[missing]" : "[locked]";
                const line = marker + "[-] " + item.name + " " + status + desc;
                textRows.push(truncateToWidth(theme.fg("dim", line), usable));
              } else {
                const pointer = i === cursor ? theme.fg("accent", marker) : marker;
                const check = working.has(item.id) ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]");
                const skill = item.skill ? " " + theme.fg("accent", "[" + item.skill + "]") : "";
                const description = item.description ? theme.fg("dim", desc) : "";
                textRows.push(truncateToWidth(pointer + check + " " + theme.bold(item.name) + skill + description, usable));
              }
            }
            const slice = windowSlice(textRows, listScroll, height, indexRows[cursor]);
            listScroll = slice.scroll;
            rows = slice.rows;
            heading = "Prompt snippets | " + workingMode + " | selected " + working.size;
            hints = "↑↓ select · Space toggle · Tab preview · M once/sticky · R clear · Enter apply · Esc cancel";
          } else {
            const item = snippets[cursor];
            const available = availableSkills();
            const missing = !!item.skill && available !== undefined && !available.has(item.skill);
            const contents = [
              theme.bold(item.name),
              theme.fg("dim", item.placement + " / order " + item.order + " / " + item.id),
              theme.fg("dim", "skill: " + (item.skill ?? "(none)")),
              ...(item.description ? [theme.fg("dim", "description: " + item.description)] : []),
              ...(missing ? [theme.fg("warning", "Skill not installed/loaded. Install it and run /reload.")] : []),
              ...item.body.split("\n").flatMap((line) => wrapTextWithAnsi(line, usable)),
            ];
            const slice = windowSlice(contents, previewScroll, height);
            previewScroll = slice.scroll;
            rows = slice.rows.map((line) => truncateToWidth(line, usable));
            heading = "Preview: " + item.name;
            hints = "↑↓ scroll · Tab/Esc back";
          }
          return [
            theme.fg("accent", "─".repeat(usable)),
            truncateToWidth(" " + theme.bold(heading), usable),
            truncateToWidth(" " + theme.fg("dim", note), usable),
            ...rows,
            "",
            truncateToWidth(" " + theme.fg("dim", hints), usable),
            theme.fg("accent", "─".repeat(usable)),
          ];
        },
        invalidate() {},
        handleInput(data: string): void {
          if (preview) {
            if (matchesKey(data, Key.up)) previewScroll--;
            else if (matchesKey(data, Key.down)) previewScroll++;
            else if (matchesKey(data, Key.tab) || matchesKey(data, Key.escape)) preview = false;
            tui.requestRender();
            return;
          }
          if (matchesKey(data, Key.up)) cursor = (cursor + snippets.length - 1) % snippets.length;
          else if (matchesKey(data, Key.down)) cursor = (cursor + 1) % snippets.length;
          else if (matchesKey(data, Key.space)) {
            const current = snippets[cursor];
            const available = availableSkills();
            const missing = !!current.skill && available !== undefined && !available.has(current.skill);
            if (working.has(current.id)) {
              working.delete(current.id);
              note = "";
            } else if (missing) {
              note = "Skill '" + current.skill + "' not installed/loaded; install it and run /reload";
            } else {
              const activeSkill = current.skill
                ? snippets.find((snippet) => snippet.skill && working.has(snippet.id))
                : undefined;
              if (activeSkill) {
                // A greyed-out Skill Snippet cannot be selected until the active one is deselected.
                note = "Deselect " + activeSkill.name + " before enabling " + current.name;
              } else {
                working.add(current.id);
                note = "";
              }
            }
          } else if (matchesKey(data, Key.tab)) {
            preview = true;
            previewScroll = 0;
          } else if (data.toLowerCase() === "m") {
            workingMode = workingMode === "once" ? "sticky" : "once";
          } else if (data.toLowerCase() === "r") {
            working.clear();
            note = "Selection cleared";
          } else if (matchesKey(data, Key.enter)) {
            done(true);
            return;
          } else if (matchesKey(data, Key.escape)) {
            done(false);
            return;
          }
          tui.requestRender();
        },
      };
    });

    if (confirmed) {
      selected = working;
      applyMode = selected.size ? workingMode : "once";
      enforceSelection(ctx);
    }
    renderWidget(ctx);
  }

  pi.on("session_start", (_event, ctx) => {
    selected = new Set();
    applyMode = "once";
    refresh();
    renderWidget(ctx);
  });

  pi.on("input", (event, ctx) => {
    // Messages from extensions should not unexpectedly consume user's selection.
    if (event.source === "extension" || selected.size === 0) return;
    refresh();
    enforceSelection(ctx);
    const active = getActive(snippets, selected);
    if (applyMode === "once") selected.clear();
    if (!active.length) {
      renderWidget(ctx);
      return;
    }
    const skills = [...new Set(active.flatMap((snippet) => snippet.skill ? [snippet.skill] : []))];
    const userSkill = explicitSkillName(event.text);
    let selectedSkill: string | null = skills[0] ?? null;
    if (userSkill && selectedSkill && selectedSkill !== userSkill) {
      ctx.ui.notify("Explicit /skill:" + userSkill + " overrides snippet skill " + selectedSkill, "info");
    }
    if (selectedSkill && !userSkill) {
      const available = availableSkills();
      if (available !== undefined && !available.has(selectedSkill)) {
        // Defensive: a Skill may disappear between menu selection and message dispatch.
        ctx.ui.notify("Skill '" + selectedSkill + "' is not installed/loaded", "warning");
        selectedSkill = null;
      }
    }
    renderWidget(ctx);
    return {
      action: "transform",
      text: composeMessage(active, event.text, selectedSkill),
      images: event.images,
    };
  });

  pi.registerShortcut("alt+s", {
    description: "Select prompt snippets for the next message",
    handler: openMenu,
  });

  pi.registerCommand("snippets", {
    description: "Toggle prompt rules; args: list | off | once | sticky",
    handler: async (args, ctx) => {
      const value = args.trim();
      if (!value) return openMenu(ctx);
      if (value === "off") {
        selected.clear();
        applyMode = "once";
        refresh();
        renderWidget(ctx);
        ctx.ui.notify("Prompt snippets disabled", "info");
      } else if (value === "once" || value === "sticky") {
        refresh();
        if (!selected.size) {
          ctx.ui.notify("Select snippets first with /snippets", "warning");
          return;
        }
        applyMode = value;
        renderWidget(ctx);
        ctx.ui.notify("Prompt snippets mode: " + value, "info");
      } else if (value === "list") {
        refresh();
        ctx.ui.notify("Snippets: " + snippets.map((s) => s.id).join(", "), "info");
      } else {
        ctx.ui.notify("Usage: /snippets [list|off|once|sticky]", "warning");
      }
    },
  });
}
