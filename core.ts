import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface Snippet {
  id: string;
  name: string;
  description: string;
  /** Optional Pi skill name. Not a path or a shell command. */
  skill?: string;
  placement: "prepend" | "append";
  order: number;
  body: string;
}

export type Mode = "once" | "sticky";

export const MAX_FILE_BYTES = 16 * 1024;
export const MAX_SELECTED_BYTES = 32 * 1024;
export const SKILL_NAME_PATTERN = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseSnippet(id: string, raw: string): Snippet | undefined {
  const matched = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!matched) return undefined;
  const meta: Record<string, string> = {};
  for (const line of matched[1].split(/\r?\n/)) {
    const field = line.match(/^([a-zA-Z][\w-]*)\s*:\s*(.*?)\s*$/);
    if (field) {
      const key = field[1].toLowerCase();
      // Reject repeated Skill keys instead of silently choosing the last declaration.
      if (key === "skill" && Object.hasOwn(meta, key)) return undefined;
      meta[key] = field[2].replace(/^(['"])(.*)\1$/, "$2").trim();
    }
  }
  const body = matched[2].trim();
  // Only a single scalar Skill on an explicitly prepend Snippet may trigger native dispatch.
  if (meta.skill !== undefined &&
    (!SKILL_NAME_PATTERN.test(meta.skill) || meta.placement !== "prepend")) return undefined;
  if (!body && meta.skill === undefined) return undefined;
  const order = /^-?\d{1,6}$/.test(meta.order ?? "") ? Number(meta.order) : 9999;
  return {
    id,
    name: meta.name || id.replace(/\.md$/i, ""),
    description: meta.description ?? "",
    skill: meta.skill,
    placement: meta.placement === "prepend" ? "prepend" : "append",
    order,
    body,
  };
}

export function sortSnippets(snippets: Snippet[]): Snippet[] {
  return [...snippets].sort((a, b) =>
    (a.placement === "prepend" ? 0 : 1) - (b.placement === "prepend" ? 0 : 1) ||
    a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  );
}

export function loadSnippets(dir: string): Snippet[] {
  if (!existsSync(dir)) return [];
  const result: Snippet[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    try {
      const path = join(dir, entry.name);
      if (statSync(path).size > MAX_FILE_BYTES) continue;
      const snippet = parseSnippet(entry.name, readFileSync(path, "utf8"));
      if (snippet) result.push(snippet);
    } catch {
      // Individual malformed/unreadable files must not block other snippets.
    }
  }
  return sortSnippets(result);
}

export function getActive(snippets: Snippet[], selected: ReadonlySet<string>): Snippet[] {
  // Already sorted; cap the amount of additional prompt content.
  let bytes = 0;
  return snippets.filter((snippet) => {
    if (!selected.has(snippet.id)) return false;
    const next = Buffer.byteLength(snippet.body, "utf8");
    if (bytes + next > MAX_SELECTED_BYTES) return false;
    bytes += next;
    return true;
  });
}

/** Keep at most one Skill-bearing Snippet per message, preserving non-Skill rules. */
export function keepOneSkill(active: Snippet[]): { kept: Snippet[]; ignored: Snippet[] } {
  let hasSkill = false;
  const kept: Snippet[] = [];
  const ignored: Snippet[] = [];
  for (const snippet of active) {
    if (snippet.skill && hasSkill) {
      ignored.push(snippet);
      continue;
    }
    if (snippet.skill) hasSkill = true;
    kept.push(snippet);
  }
  return { kept, ignored };
}

/** Pi 1.3 only expands an explicit /skill:name command at the very start of input. */
export function explicitSkillName(text: string): string | undefined {
  return text.match(/^\/skill:([a-z0-9]+(?:-[a-z0-9]+)*)(?= |$)/)?.[1];
}

/**
 * Put the skill dispatch prefix before *all* snippets, regardless of placement.
 * Explicit user /skill:name takes priority over snippet-declared skills.
 * Passing null for skillOverride means deliberately omit automatic skill dispatch.
 */
export function composeMessage(
  active: Snippet[], original: string, skillOverride?: string | null,
): string {
  const before = active.filter((s) => s.placement === "prepend").map((s) => s.body);
  const after = active.filter((s) => s.placement === "append").map((s) => s.body);
  const userSkill = explicitSkillName(original);
  const userText = userSkill ? original.slice(("/skill:" + userSkill).length).trimStart() : original;
  const body = [...before, userText, ...after].filter((text) => text.length > 0).join("\n\n");
  const skill = userSkill ?? (skillOverride === null
    ? undefined
    : skillOverride ?? active.find((snippet) => snippet.skill)?.skill);
  return skill ? "/skill:" + skill + (body ? " " + body : "") : body;
}
