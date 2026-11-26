import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, unlinkSync } from "node:fs";
import { createExtensionRuntime, loadExtensions } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { AgentSession, parseSkillBlock } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function createExtensionSandbox(prefix) {
  const temp = mkdtempSync(join(root, "tests", prefix));
  for (const file of ["index.ts", "core.ts", "package.json"]) {
    copyFileSync(join(root, file), join(temp, file));
  }
  mkdirSync(join(temp, "snippets"));
  return temp;
}

function enableScriptedMenu(ctx) {
  const theme = {fg:(_color, value) => value, bold:(value) => value};
  ctx.mode = "tui";
  ctx.hasUI = true;
  ctx.ui.theme = theme;
  ctx.ui.custom = async (factory) => {
    if (!ctx.keys) throw new Error("Missing scripted menu keys");
    let complete;
    const completed = new Promise((resolve) => { complete = resolve; });
    const tui = {terminal:{rows:15},requestRender(){}};
    const menu = await factory(tui,theme,{},complete);
    menu.render(90);
    for (const key of ctx.keys) {
      menu.handleInput(key);
      menu.render(90);
    }
    ctx.keys = undefined;
    return await completed;
  };
}

async function setup() {
  const loaded = await loadExtensions([root], root);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const ext = loaded.extensions[0];
  const widgets = [];
  const notifications = [];
  const theme = { fg: (_color, text) => text, bold: (text) => text };
  const tui = {terminal: { rows: 13 }, requestRender() {}};
  const ctx = {
    mode:"tui",
    hasUI:true,
    ui: {
      theme,
      setWidget: (id, contents) => widgets.push({id, contents}),
      notify: (message, kind) => notifications.push({message,kind}),
      async custom(factory) {
        if (!ctx.keys) throw new Error("Missing scripted menu keys");
        let finish;
        const done = new Promise((resolve) => { finish = resolve; });
        const menu = await factory(tui, theme, {}, finish);
        const rendered = menu.render(70);
        assert.ok(rendered.length > 5);
        for (const key of ctx.keys) {
          menu.handleInput(key);
          menu.render(70);
        }
        ctx.keys = undefined;
        return await done;
      },
    },
  };
  const sessionStart = ext.handlers.get("session_start")[0];
  const input = ext.handlers.get("input")[0];
  const command = ext.commands.get("snippets").handler;
  const send = (text="Request", source="interactive", images) =>
    input({type:"input",text,source,images},ctx);
  await sessionStart({type:"session_start"},ctx);
  return {ext,ctx,widgets,notifications,command,send,sessionStart};
}

test("real Pi SDK loader: only opt-in handlers, one command and shortcut, zero model tools", async () => {
  const {ext,widgets} = await setup();
  assert.deepEqual([...ext.handlers.keys()], ["session_start","input"]);
  assert.deepEqual([...ext.commands.keys()], ["snippets"]);
  assert.deepEqual([...ext.shortcuts.keys()], ["alt+s"]);
  assert.equal(ext.tools.size,0);
  assert.ok(widgets.at(-1).contents === undefined);
});

test("disabled by default, even with a registered input hook", async () => {
  const {send} = await setup();
  assert.equal(await send("Hello"),undefined);
});

test("status widget has a neutral bold header and colored prepend/append groups", async () => {
  const {command, ctx, widgets, send} = await setup();
  const palette = [];
  ctx.ui.theme.fg = (color, text) => { palette.push({color, text}); return text; };
  ctx.keys = [" ","\x1b[B"," ","\r"];
  await command("",ctx);
  assert.ok(palette.some(({color,text}) => color === "muted" && text === "Snippets"));
  assert.ok(palette.some(({color,text}) => color === "dim" && text === "┃ "));
  assert.ok(palette.some(({color,text}) => color === "accent" && text === "↑ Session kickoff"));
  assert.ok(palette.some(({color,text}) => color === "warning" && text === "↓ Verify, don't assume"));
  assert.deepEqual(widgets.at(-1).contents, [
    "┃ Snippets [once]",
    "│ ↑ Session kickoff",
    "│ ↓ Verify, don't assume",
  ]);
  await command("sticky",ctx);
  assert.equal(widgets.at(-1).contents[0], "┃ Snippets [sticky]");
  await send("Investigate");
  assert.equal(widgets.at(-1).contents[0], "┃ Snippets [sticky]");
  await command("off",ctx);
  assert.equal(widgets.at(-1).contents, undefined);
});

test("multi-select two append rules: correct order and once-only transformation", async () => {
  const {command,send,ctx,widgets} = await setup();
  ctx.keys = ["\x1b[B"," ","\x1b[B"," ","\r"];
  await command("",ctx);
  const image = {type:"image",mimeType:"image/png",data:"fake"};
  const out = await send("Find the bug", "interactive",[image]);
  assert.equal(out.action, "transform");
  assert.ok(out.text.startsWith("Find the bug\n\n"), "both selected rules are appended");
  assert.ok(out.text.indexOf("Verify critical facts") < out.text.indexOf("Diagnose the problem"));
  assert.ok(out.text.endsWith("Do not modify files or apply the fix in this task."));
  assert.equal(out.text.includes("Find the bug\n\nVerify critical facts"),true);
  assert.deepEqual(out.images,[image]);
  assert.equal(await send("Another input"),undefined);
  assert.equal(widgets.at(-1).contents,undefined);
});

test("input from another extension does not use or consume a one-shot selection", async () => {
  const {command,send,ctx} = await setup();
  ctx.keys = ["\x1b[B","\x1b[B","\x1b[B","\x1b[B"," ","\r"];
  await command("",ctx);
  assert.equal(await send("Internal","extension"),undefined);
  assert.equal((await send("Actual","rpc")).action,"transform");
  assert.equal(await send("Subsequent","interactive"),undefined);
});

test("sticky mode applies to multiple messages and can be turned off", async () => {
  const {command,send,ctx,sessionStart} = await setup();
  ctx.keys = ["\x1b[B"," ","\x1b[B","\x1b[B"," ","\r"];
  await command("",ctx);
  await command("sticky",ctx);
  assert.match((await send("First")).text,/After making changes/);
  assert.match((await send("Second")).text,/After making changes/);
  await command("off",ctx);
  assert.equal(await send("Third"),undefined);
  ctx.keys = ["\x1b[B","\x1b[B","\x1b[B","\x1b[B"," ","\r"];
  await command("",ctx);
  await command("sticky",ctx);
  await sessionStart({type:"session_start"},ctx);
  assert.equal(await send("New session"),undefined);
});

test("menu interaction supports direct selection, preview, mode toggle and confirm", async () => {
  const {command,send,ctx,ext} = await setup();
  // Navigate to Diagnose only, toggle, preview, return and use sticky mode.
  ctx.keys = ["\x1b[B","\x1b[B"," ","\t","\x1b","m","\r"];
  await command("",ctx);
  const first = await send("Investigate");
  assert.match(first.text,/Diagnose the problem/);
  assert.equal((await send("Investigate again")).action,"transform");
  assert.ok(ext.shortcuts.get("alt+s").handler);
});

test("cancelled menu has no side effects; non-TUI menu warns", async () => {
  const {command,send,ctx,notifications} = await setup();
  ctx.keys = [" ","\x1b"];
  await command("",ctx);
  assert.equal(await send("Cancelled"),undefined);
  ctx.mode = "rpc";
  await command("",ctx);
  assert.match(notifications.at(-1).message,/requires interactive TUI/);
});

test("command validation and one-shot vs sticky mode", async () => {
  const {command,send,ctx,notifications} = await setup();
  await command("sticky",ctx);
  assert.match(notifications.at(-1).message,/Select snippets first/);
  await command("unknown-command",ctx);
  assert.match(notifications.at(-1).message,/Usage: \/snippets/);
  ctx.keys = ["\x1b[B","\x1b[B","\x1b[B","\x1b[B"," ","\r"];
  await command("",ctx);
  await command("sticky",ctx);
  assert.match((await send("Read")).text,/For broad codebase exploration/);
  await command("once",ctx);
  assert.ok((await send("Read again")).text);
  assert.equal(await send("Last"),undefined);
  await command("list",ctx);
  assert.match(notifications.at(-1).message,/session-kickoff.md/);
});

test("menu scrolls in a narrow terminal without crashing", async () => {
  const {command,send,ctx} = await setup();
  ctx.keys = ["\x1b[B","\x1b[B","\x1b[B","\t","\x1b"," ","\r"];
  await command("",ctx);
  assert.equal((await send("Render")).action,"transform");
});



test("frontmatter skill loads through the real Pi Skill expansion method", async () => {
  const temp = createExtensionSandbox(".skill-sandbox-");
  try {
    const reviewFile = join(temp,"snippets","review.md");
    const kickoffFile = join(temp,"snippets","kickoff.md");
    writeFileSync(reviewFile, "---\nname: Code review\nskill: code-review\nplacement: prepend\n---\nInspect concurrency and error handling.");
    writeFileSync(kickoffFile, "---\nname: Start\nplacement: prepend\n---\nRead important context first.");
    const skillDir = join(temp,"fake-skill");
    mkdirSync(skillDir);
    const skillFile = join(skillDir,"SKILL.md");
    writeFileSync(skillFile,"---\nname: code-review\ndescription: Example reviewer\n---\n# Actual skill workflow\nRead source files carefully.");
    const available = createExtensionRuntime();
    available.getCommands = () => [{name: "skill:code-review", source:"skill"}];
    const loaded = await loadExtensions([temp],temp,undefined,available);
    assert.deepEqual(loaded.errors, []);
    const extension = loaded.extensions[0];
    const notices = [];
    const ctx = {mode:"rpc",hasUI:true,ui:{setWidget(){},notify:(message)=>notices.push(message)}};
    enableScriptedMenu(ctx);
    const command = extension.commands.get("snippets").handler;
    const send = (text) => extension.handlers.get("input")[0]({type:"input",text,source:"rpc"},ctx);
    await extension.handlers.get("session_start")[0]({},ctx);
    ctx.keys = [" ","\x1b[B"," ","\r"];
    await command("",ctx);
    const result = await send("Review my API");
    assert.equal(result.action,"transform");
    assert.equal(result.text,
      "/skill:code-review Inspect concurrency and error handling.\n\nRead important context first.\n\nReview my API");
    // Invoke the actual SDK method, not a local fake of the Pi parser.
    const expanded = AgentSession.prototype._expandSkillCommand.call({
      resourceLoader:{getSkills:()=>({skills:[{name:"code-review",filePath:skillFile,baseDir:skillDir}]})},
    },result.text);
    const skillBlock = parseSkillBlock(expanded);
    assert.equal(skillBlock.name, "code-review");
    assert.match(skillBlock.content, /# Actual skill workflow/);
    assert.match(skillBlock.userMessage, /Review my API/);
    assert.match(skillBlock.userMessage, /Inspect concurrency and error handling/);
    assert.equal(await send("Second turn"),undefined);

    // Explicit /skill:name overrides the Snippet field and survives prepends.
    ctx.keys = [" ","\x1b[B"," ","\r"];
    await command("",ctx);
    const manual = await send("/skill:unit-test Check this");
    assert.equal(manual.text, "/skill:unit-test Inspect concurrency and error handling.\n\nRead important context first.\n\nCheck this");
    assert.ok(notices.some((line)=>line.includes("overrides snippet skill")));

    // Missing Skills are now disabled in the menu. The normal Snippet still works.
    available.getCommands = () => [];
    ctx.keys = [" ","\x1b[B"," ","\r"];
    await command("",ctx);
    const missing = await send("Check implementation");
    assert.equal(missing.text,"Read important context first.\n\nCheck implementation");
    assert.equal(missing.text.includes("/skill:code-review"),false);
  } finally {
    rmSync(temp,{recursive:true,force:true});
  }
});

test("TUI greys out a second Skill until first is deselected; ordinary notes remain selectable", async () => {
  const temp = createExtensionSandbox(".menu-skill-");
  try {
    writeFileSync(join(temp,"snippets","first.md"),"---\nname: First\ndescription: First task\nskill: first-skill\nplacement: prepend\norder: 10\n---\nFirst rules");
    writeFileSync(join(temp,"snippets","second.md"),"---\nname: Second\ndescription: Second task\nskill: second-skill\nplacement: prepend\norder: 20\n---\nSecond rules");
    writeFileSync(join(temp,"snippets","notes.md"),"---\nname: Notes\nplacement: append\norder: 30\n---\nAdditional notes");
    const loaded = await loadExtensions([temp], temp);
    assert.deepEqual(loaded.errors, []);
    const extension = loaded.extensions[0];
    const notes = [];
    const rendered = [];
    const theme = {fg:(color,value)=>color === "dim" ? "[DIM]" + value + "[/DIM]" : value,bold:(value)=>value};
    const ctx = {
      mode:"tui",hasUI:true,
      ui:{
        theme,
        setWidget(){},
        notify:(value)=>notes.push(value),
        custom:async (factory)=>{
          let complete;
          const finished = new Promise((resolve)=>{complete=resolve});
          const tui={terminal:{rows:15},requestRender(){}};
          const menu=await factory(tui,theme,{},complete);
          menu.render(100);
          // 1. Select First, 2. attempt disabled Second, 3. select ordinary Notes,
          // 4. deselect First, 5. select Second once it is enabled again.
          for (const key of [
            " ","\x1b[B"," ","\t","\x1b","\x1b[B"," ",
            "\x1b[A","\x1b[A"," ","\x1b[B"," ","\r",
          ]) {
            menu.handleInput(key);
            rendered.push(menu.render(100).join("\n"));
          }
          return await finished;
        },
      },
    };
    await extension.handlers.get("session_start")[0]({},ctx);
    await extension.commands.get("snippets").handler("",ctx);
    const changed=await extension.handlers.get("input")[0]({type:"input",source:"interactive",text:"Review code"},ctx);
    assert.equal(changed.text,"/skill:second-skill Second rules\n\nReview code\n\nAdditional notes");
    assert.match(rendered[0], /\[DIM\].*\[-\] Second \[locked\] — Second task\[\/DIM\]/);
    assert.match(rendered[2], /Deselect First before enabling Second/);
    assert.match(rendered[2], /\[x\] First/);
    assert.match(rendered[3], /skill: second-skill/);
    assert.doesNotMatch(rendered[9], /\[locked\]/); // No Skill selected after deselecting First.
    assert.match(rendered[11], /\[x\] Second \[second-skill\].* — Second task/);
    assert.match(rendered[11], /\[-\] First \[locked\] — First task/);
    assert.equal(notes.some((text)=>text.includes("Multiple")),false);
  } finally {
    rmSync(temp,{recursive:true,force:true});
  }
});

test("unloaded Skills are shown disabled with a reason; detection refreshes and stale selections are removed", async () => {
  const temp = createExtensionSandbox(".missing-skill-");
  try {
    writeFileSync(join(temp, "snippets", "available.md"),
      "---\nname: Available\nskill: ready-skill\nplacement: prepend\norder: 10\n---\nAvailable workflow");
    writeFileSync(join(temp, "snippets", "missing.md"),
      "---\nname: Missing\ndescription: Unavailable task\nskill: missing-skill\nplacement: prepend\norder: 20\n---\nMissing workflow");
    writeFileSync(join(temp, "snippets", "normal.md"),
      "---\nname: Normal\nplacement: append\norder: 30\n---\nOrdinary instructions");

    const skills = new Set(["ready-skill"]);
    const runtime = createExtensionRuntime();
    runtime.getCommands = () => [
      {name:"skill:missing-skill",source:"extension"}, // spoofed name is not a loaded Skill
      ...[...skills].map((name) => ({name: "skill:" + name, source:"skill"})),
    ];
    const loaded = await loadExtensions([temp], temp, undefined, runtime);
    assert.deepEqual(loaded.errors, []);
    const extension = loaded.extensions[0];
    const notifications = [];
    const menuFrames = [];
    const theme = {
      fg: (color, value) => color === "dim" ? "[DIM]" + value + "[/DIM]" : value,
      bold: (value) => value,
    };
    const ctx = {
      mode:"tui", hasUI:true,
      ui:{
        theme,
        setWidget(){},
        notify:(message)=>notifications.push(message),
        custom: async (factory)=>{
          let finish;
          const done = new Promise((resolve)=>{finish=resolve;});
          const tui = {terminal:{rows:19},requestRender(){}};
          const menu = await factory(tui, theme, {}, finish);
          const frames = [menu.render(120).join("\n")];
          for (const key of ctx.keys) {
            menu.handleInput(key);
            frames.push(menu.render(120).join("\n"));
          }
          menuFrames.push(frames);
          ctx.keys = undefined;
          return await done;
        },
      },
    };
    const command = extension.commands.get("snippets").handler;
    const send = (text)=>extension.handlers.get("input")[0](
      {type:"input",source:"interactive",text},ctx);
    await extension.handlers.get("session_start")[0]({},ctx);

    // Missing skill is visible but grey, Space does nothing and Tab explains why.
    ctx.keys = ["\x1b[B"," ","\t","\x1b","\x1b[B"," ","\r"];
    await command("",ctx);
    assert.match(menuFrames[0][0], /\[DIM\].*\[-\] Missing \[missing\] — Unavailable task/);
    assert.match(menuFrames[0][2], /Skill 'missing-skill' not installed\/loaded; install it and run \/reload/);
    assert.match(menuFrames[0][3], /Skill not installed\/loaded\. Install it and run \/reload/);
    assert.doesNotMatch(menuFrames[0][2], /\[x\] Missing/);
    assert.equal((await send("First")).text, "First\n\nOrdinary instructions");

    // Once the Skill becomes discoverable, the same Snippet can be selected.
    skills.add("missing-skill");
    ctx.keys = ["\x1b[B"," ","\x1b[B"," ","\r"];
    await command("",ctx);
    assert.doesNotMatch(menuFrames[1][0], /Missing.*Skill not installed\/loaded/);
    await command("sticky",ctx);
    const active = await send("Second");
    assert.equal(active.text,"/skill:missing-skill Missing workflow\n\nSecond\n\nOrdinary instructions");

    // If a previously selected Skill is uninstalled during sticky mode,
    // only its selection is dropped; the ordinary Snippet stays active.
    skills.delete("missing-skill");
    const result = await send("Third");
    assert.equal(result.text,"Third\n\nOrdinary instructions");
    assert.ok(notifications.some((message)=>message.includes("Missing or unloaded Skill(s): missing-skill")));
    assert.equal((await send("Fourth")).text,"Fourth\n\nOrdinary instructions");
    await command("off",ctx);
  } finally {
    rmSync(temp, {recursive:true,force:true});
  }
});

test("real loader hot-reloads snippet bodies, supports prepend and clears removed selections", async () => {
  const tmp = createExtensionSandbox(".sandbox-");
  try {
    const file = join(tmp,"snippets","alpha.md");
    writeFileSync(file,"---\nname: Alpha\nplacement: prepend\n---\nRevision 1");
    const loaded = await loadExtensions([tmp],tmp);
    assert.deepEqual(loaded.errors,[]);
    const ext = loaded.extensions[0];
    const messages = [];
    const ctx = {mode:"rpc",hasUI:true,ui:{
      notify:(text)=>messages.push(text),
      setWidget(){},
    }};
    enableScriptedMenu(ctx);
    const command = ext.commands.get("snippets").handler;
    const send = (text) => ext.handlers.get("input")[0]({type:"input",source:"rpc",text},ctx);
    await ext.handlers.get("session_start")[0]({},ctx);
    ctx.keys=[" ","\r"];
    await command("",ctx);
    await command("sticky",ctx);
    assert.equal((await send("Original")).text,"Revision 1\n\nOriginal");
    writeFileSync(file,"---\nname: Alpha\nplacement: prepend\n---\nRevision 2");
    assert.equal((await send("Next")).text,"Revision 2\n\nNext");
    unlinkSync(file);
    assert.equal(await send("Gone"),undefined);
    assert.equal(await send("Still gone"),undefined);
  } finally {
    rmSync(tmp,{recursive:true,force:true});
  }
});
