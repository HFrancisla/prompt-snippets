import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseSnippet, sortSnippets, loadSnippets,
  getActive, keepOneSkill, composeMessage, explicitSkillName, MAX_FILE_BYTES, MAX_SELECTED_BYTES,
} from "../core.ts";

test("frontmatter parsing, quoted values, placement and sort order", () => {
  const a = parseSnippet("a.md", "---\nname: 'A'\norder: 20\nplacement: prepend\n---\nRule A");
  const b = parseSnippet("b.md", "---\r\nname: B\r\norder: 3\r\nplacement: append\r\n---\r\nRule B");
  const c = parseSnippet("c.md", "---\nname: C\norder: not-a-number\nplacement: wrong\n---\nRule C");
  assert.ok(a && b && c);
  assert.equal(a.name, "A");
  assert.equal(b.body, "Rule B");
  assert.equal(c.order, 9999);
  assert.equal(c.placement, "append");
  assert.deepEqual(sortSnippets([c, b, a]).map((s) => s.id), ["a.md", "b.md", "c.md"]);
});

test("invalid or empty frontmatter is ignored", () => {
  assert.equal(parseSnippet("bad.md", "No frontmatter"), undefined);
  assert.equal(parseSnippet("bad.md", "---\nname: Empty\n---\n \n"), undefined);
  assert.equal(parseSnippet("bad.md", "---\nname: MissingEnd\nbody"), undefined);
});


test("optional skill frontmatter accepts valid names and rejects malformed names", () => {
  for (const [value, name] of [
    ["code-review", "code-review"],
    ["'python-testing'", "python-testing"],
    ['"test2"', "test2"],
  ]) {
    const parsed = parseSnippet("with-skill.md", "---\nname: Review\nplacement: prepend\nskill: " + value + "\n---\nCheck correctness");
    assert.equal(parsed?.skill, name);
  }
  assert.equal(parseSnippet("skill-only.md", "---\nskill: code-review\nplacement: prepend\n---\n")?.skill, "code-review");
  for (const bad of ["", "../code-review", "/skill:code-review", "python; rm -rf", "Code_Review", "two--hyphens", "x".repeat(65)]) {
    assert.equal(parseSnippet("bad.md", "---\nplacement: prepend\nskill: " + bad + "\n---\nBody"), undefined, bad);
  }
});

test("skill dispatch stays at byte zero with prepend skill and append notes", () => {
  const items = [
    {id:"lead.md",name:"Lead",description:"",placement:"prepend",order:1,body:"Before"},
    {id:"review.md",name:"Review",description:"",placement:"prepend",order:2,body:"Review rules",skill:"code-review"},
    {id:"tail.md",name:"Tail",description:"",placement:"append",order:3,body:"After"},
  ];
  assert.equal(
    composeMessage(items, "Analyze API"),
    "/skill:code-review Before\n\nReview rules\n\nAnalyze API\n\nAfter",
  );
  assert.equal(
    composeMessage(items, "/skill:unit-test Explicit task"),
    "/skill:unit-test Before\n\nReview rules\n\nExplicit task\n\nAfter",
  );
  assert.equal(
    composeMessage(items, "/skill:unit-test"),
    "/skill:unit-test Before\n\nReview rules\n\nAfter",
  );
  assert.equal(
    composeMessage(items, "Analyze API", null),
    "Before\n\nReview rules\n\nAnalyze API\n\nAfter",
  );
  assert.equal(explicitSkillName("/skill:foo task"), "foo");
  assert.equal(explicitSkillName(" /skill:foo task"), undefined);
  assert.equal(explicitSkillName("/skill:foo\nTask"), undefined);
  assert.equal(explicitSkillName("/skill:foo"), "foo");
});

test("skill only accepted with explicit prepend and exactly one scalar declaration", () => {
  for (const meta of [
    "skill: code-review", // missing placement
    "skill: code-review\nplacement: append",
    "skill: code-review\nplacement: typo",
    "skill: [code-review]",
    "skill: code-review, unit-test",
    "skill:\n  - code-review",
    "skill: code-review\nskill: unit-test\nplacement: prepend",
  ]) {
    assert.equal(parseSnippet("invalid.md", "---\n" + meta + "\n---\nPrompt"), undefined, meta);
  }
  assert.equal(parseSnippet("ok.md", "---\nplacement: prepend\nskill: code-review\n---\n").skill, "code-review");
  assert.equal(parseSnippet("append.md", "---\nplacement: append\n---\nNormal notes").placement, "append");
});

test("at most one Skill Snippet is kept, ordinary prepend/append remain", () => {
  const items = [
    {id:"one.md",name:"First",description:"",placement:"prepend",order:1,body:"First rules",skill:"same-skill"},
    {id:"middle.md",name:"Middle",description:"",placement:"prepend",order:2,body:"Other prepend"},
    {id:"two.md",name:"Second",description:"",placement:"prepend",order:3,body:"Second rules",skill:"same-skill"},
    {id:"three.md",name:"Third",description:"",placement:"prepend",order:4,body:"Third rules",skill:"third-skill"},
    {id:"tail.md",name:"Tail",description:"",placement:"append",order:5,body:"After"},
  ];
  const {kept, ignored} = keepOneSkill(items);
  assert.deepEqual(kept.map((item)=>item.id),["one.md","middle.md","tail.md"]);
  assert.deepEqual(ignored.map((item)=>item.id),["two.md","three.md"]);
});

test("compose respects prepend/user/append and blank separators", () => {
  const active = [
    { id:"a.md",name:"A", description:"",placement:"prepend",order:1,body:"Before 1" },
    { id:"b.md",name:"B", description:"",placement:"prepend",order:2,body:"Before 2" },
    { id:"c.md",name:"C", description:"",placement:"append",order:1,body:"After" },
  ];
  assert.equal(composeMessage(active, "Original"), "Before 1\n\nBefore 2\n\nOriginal\n\nAfter");
});

test("reading snippets is reloadable, sorted and skips malformed/symlink/large files", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-snippets-core-"));
  try {
    const good = "---\nname: Good\nplacement: prepend\n---\nInitial";
    writeFileSync(join(dir,"good.md"), good);
    writeFileSync(join(dir,"broken.md"), "not a snippet");
    writeFileSync(join(dir,"huge.md"), "---\n---\n" + "x".repeat(MAX_FILE_BYTES));
    mkdirSync(join(dir,"nested"));
    writeFileSync(join(dir,"nested","ignored.md"), good);
    symlinkSync(join(dir,"good.md"), join(dir,"linked.md"));
    assert.deepEqual(loadSnippets(dir).map((s) => s.id), ["good.md"]);
    writeFileSync(join(dir,"good.md"), good.replace("Initial", "Updated"));
    assert.equal(loadSnippets(dir)[0].body, "Updated");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("active snippets respect total body-byte budget", () => {
  const longBody = "中".repeat(Math.ceil(MAX_SELECTED_BYTES / 3));
  const active = [
    {id:"huge.md", name:"large", description:"", placement:"append",order:1,body:longBody},
    {id:"small.md",name:"small",description:"",placement:"append",order:2,body:"tiny"},
  ];
  assert.deepEqual(getActive(active,new Set(["huge.md","small.md"])).map((s)=>s.id),["small.md"]);
  assert.deepEqual(getActive(active,new Set()),[]);
});
