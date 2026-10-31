#!/usr/bin/env node
/**
 * Dev Dashboard ↔ Bob Shell bridge (Chrome native messaging host).
 *
 * Chrome starts this process when the new tab page asks Bob something. Each
 * request runs `bob run` once in Bob's default agent mode, with MCP servers and
 * subagents. By default that's in an empty workspace; when the page names a
 * local clone (bug hunts, triage), Bob works in that clone. `readOnly` turns
 * off Bob's file-editing tools; `maxCost` stops it at that much Bob usage.
 *
 * Protocol: 4-byte little-endian length + UTF-8 JSON, both directions.
 *   { type: "ping" }                                   → { ok, version, home }
 *   { type: "ask", prompt, key?, workspace?, readOnly?, maxCost? }   (no time limit; Cancel stops it)
 *                                                      → { ok, text, log } | { ok: false, error, log }
 *   { type: "git-info", path }                         → { ok, branch, head }
 *   { type: "hunt-checkout", path, slug }              → { ok, path, branch, head }
 * Closing the port (Cancel in the page) ends stdin, which stops Bob.
 */
const { spawn, execFile, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BOB = process.env.DD_BOB || "bob";
const WORKSPACE = path.join(os.homedir(), ".dev-dashboard", "bob-workspace");
const MAX_REPLY = 600 * 1024; // Chrome caps host → browser messages at 1 MB; the reply and its log share it.
const MAX_LOG = 300 * 1024;

const children = new Set();

function send(message) {
  const json = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([header, json]));
}

/** Bob is a Node script; run it with this Node so Chrome's minimal PATH doesn't matter. */
function bobCommand(args) {
  return /\.(c|m)?js$/.test(BOB) ? [process.execPath, [BOB, ...args]] : [BOB, args];
}

function redact(text, key) {
  let out = String(text || "");
  if (key) out = out.split(key).join("[redacted]");
  return out.replace(/(api[_ -]?key|authorization|token)(\s*[:=]\s*)\S+/gi, "$1$2[redacted]");
}

function ping() {
  const [cmd, args] = bobCommand(["--version"]);
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000 }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: `Couldn't run Bob Shell (${err.code || err.message}). Re-run ai-helper/install.sh.` });
      resolve({ ok: true, version: String(stdout).split("\n")[0].trim(), home: os.homedir() });
    });
  });
}

/** A message's content: a string, or a list of content parts in some Bob versions. */
function messageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
  return content?.text || "";
}

/**
 * Bob Shell's JSON events as a readable transcript: streamed reply pieces joined up, tool calls
 * paired with their results (long outputs clipped), and lines that aren't events kept as they are.
 */
function readableLog(stdout, stderr) {
  const out = [];
  const tools = {};
  let open = null; // the reply block being streamed into: "reply" or "thinking"
  const time = (e) => (e.timestamp ? new Date(e.timestamp).toTimeString().slice(0, 8) : "--:--:--");
  const clip = (text, max = 3000) => (text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text);
  for (const line of stdout.split("\n")) {
    let e = null;
    try {
      if (line.trim().startsWith("{")) e = JSON.parse(line);
    } catch {}
    if (!e) {
      if (line.trim()) out.push(line), (open = null);
      continue;
    }
    if (e.type === "message" && e.role === "assistant") {
      const kind = e.isReasoning ? "thinking" : "reply";
      if (open !== kind) out.push(`\n[${time(e)}] Bob${kind === "thinking" ? " (thinking)" : ""}`, ""), (open = kind);
      out[out.length - 1] += messageText(e.content);
      continue;
    }
    open = null;
    if (e.type === "message") out.push(`\n[${time(e)}] ${e.role === "user" ? "Prompt" : e.role}`, messageText(e.content));
    else if (e.type === "tool_use") {
      tools[e.tool_id] = e.tool_name;
      out.push(`\n[${time(e)}] → ${e.tool_name} ${JSON.stringify(e.parameters ?? {})}`);
    } else if (e.type === "tool_result")
      out.push(`[${time(e)}] ← ${tools[e.tool_id] || "tool"} ${e.status}`, clip(String(e.output ?? e.error?.message ?? "")));
    else if (e.type === "result") {
      const st = e.stats || {};
      const bits = [st.duration_ms != null && `${Math.round(st.duration_ms / 1000)}s`, st.tool_calls != null && `${st.tool_calls} tool calls`, st.total_tokens != null && `${st.total_tokens} tokens`, st.session_costs != null && `cost ${st.session_costs}`];
      out.push(`\n[${time(e)}] Done (${e.status})${bits.some(Boolean) ? ` · ${bits.filter(Boolean).join(" · ")}` : ""}`);
    } else if (e.type === "error") out.push(`\n[${time(e)}] Error: ${e.message}`);
    else out.push(`\n[${time(e)}] ${JSON.stringify(e)}`);
  }
  if (stderr.trim()) out.push("\n--- stderr ---", stderr.trim());
  return out.join("\n").trim();
}

/**
 * Chrome starts this helper with a bare PATH (no Homebrew, nvm and so on), so Bob couldn't run tools like gh.
 * Ask the login shell for the PATH a terminal would have, once; fall back to the usual folders.
 */
let shellPath = null;
function userPath() {
  if (shellPath != null) return shellPath;
  const extra = ["/opt/homebrew/bin", "/usr/local/bin", path.dirname(process.execPath)];
  try {
    const out = execFileSync(process.env.SHELL || "/bin/zsh", ["-ilc", "printf '%s' \"$PATH\""], { timeout: 5000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    extra.unshift(...out.trim().split("\n").pop().split(":"));
  } catch {}
  shellPath = [...new Set([...extra, ...String(process.env.PATH || "").split(":")].filter(Boolean))].join(":");
  return shellPath;
}

function expandHome(p) {
  return String(p || "").replace(/^~(?=$|\/)/, os.homedir());
}

/** A local clone the page asked for: must be an existing directory with a .git folder. */
function cloneDir(p) {
  const dir = path.resolve(expandHome(p));
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Folder not found: ${p}`);
  if (!fs.existsSync(path.join(dir, ".git"))) throw new Error(`Not a git clone: ${p}`);
  return dir;
}

/** Runs git in `dir`; fails with git's own message. */
function gitStrict(dir, args, timeout = 10000) {
  return new Promise((resolve, reject) =>
    execFile("git", ["-C", dir, ...args], { timeout }, (err, out, stderr) => (err ? reject(new Error(String(stderr).trim().split("\n").pop() || err.message)) : resolve(String(out).trim())))
  );
}

/** Like gitStrict(), but an empty string instead of a failure, for details that are nice to have. */
function git(dir, args) {
  return gitStrict(dir, args).catch(() => "");
}

/**
 * The latest `main` of `slug`, checked out in a worktree of the user's clone
 * that only the bug hunter uses, so the clone's own branch and changes are
 * never touched. Fetches from the remote that points at `slug` (often
 * "upstream" in a fork), else "upstream", else "origin".
 */
async function huntCheckout({ path: p, slug }) {
  try {
    const dir = cloneDir(p);
    const lines = (await gitStrict(dir, ["remote", "-v"])).split("\n");
    const names = [...new Set(lines.map((l) => l.split(/\s+/)[0]).filter(Boolean))];
    const match = lines.find((l) => new RegExp(`github\\.com[:/]${String(slug).replace(/[.]/g, "\\.")}(\\.git)?\\s`, "i").test(l));
    const remote = match ? match.split(/\s+/)[0] : names.includes("upstream") ? "upstream" : "origin";
    await gitStrict(dir, ["fetch", "--quiet", remote, "main"], 180000);
    const head = await gitStrict(dir, ["rev-parse", "FETCH_HEAD"]);
    const target = path.join(os.homedir(), ".dev-dashboard", "hunts", String(slug).replace("/", "__"));
    if (fs.existsSync(path.join(target, ".git"))) {
      await gitStrict(target, ["checkout", "--quiet", "--force", "--detach", head], 300000);
    } else {
      fs.rmSync(target, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await gitStrict(dir, ["worktree", "prune"]);
      await gitStrict(dir, ["worktree", "add", "--quiet", "--detach", target, head], 300000);
    }
    return { ok: true, path: target.replace(os.homedir(), "~"), branch: `${remote}/main`, head };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function gitInfo({ path: p }) {
  try {
    const dir = cloneDir(p);
    const [branch, head] = await Promise.all([git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), git(dir, ["rev-parse", "HEAD"])]);
    return { ok: true, branch, head };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function ask({ prompt, key, workspace, readOnly, maxCost }) {
  if (!prompt) return Promise.resolve({ ok: false, error: "Empty prompt." });
  let dir = WORKSPACE;
  try {
    if (workspace) dir = cloneDir(workspace);
    else fs.mkdirSync(WORKSPACE, { recursive: true });
  } catch (err) {
    return Promise.resolve({ ok: false, error: err.message });
  }
  const args = ["run", "--format", "stream-json", "--log-level", "error", "--trust", "--workspace", dir];
  // Bob's file-editing tools are switched off; it can still read, search and run commands such as gh.
  if (readOnly) args.push("--disable-tool-groups", "edit");
  if (Number(maxCost) > 0) args.push("--max-cost", String(Number(maxCost)));
  args.push(prompt);

  const env = { ...process.env, PATH: userPath(), BOB_LOG_LEVEL: "error" };
  if (key) env.BOB_API_KEY = key;
  const [cmd, argv] = bobCommand(args);

  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    children.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-MAX_LOG)));
    child.on("error", (err) => {
      children.delete(child);
      resolve({ ok: false, error: `Couldn't start Bob Shell: ${err.message}` });
    });
    child.on("close", (code, signal) => {
      children.delete(child);
      let result = null;
      const errors = [];
      // The reply is what Bob streamed after its last tool call; thinking doesn't count.
      let reply = "";
      for (const line of stdout.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "result") result = event;
          if (event.type === "error" && event.message) errors.push(event.message);
          if (event.type === "message" && event.role === "assistant" && !event.isReasoning) reply += messageText(event.content);
          else if (event.type === "tool_use" || event.type === "tool_result" || (event.type === "message" && event.role === "user")) reply = "";
        } catch {}
      }
      // Bob Shell's whole output, for the page's log toggle. The tail is kept when it's too long.
      const full = redact(readableLog(stdout, stderr), key);
      const log = full.length > MAX_LOG ? `… (earlier output cut)\n${full.slice(-MAX_LOG)}` : full;
      const text = result ? reply.trim() : "";
      if (text) return resolve({ ok: true, text: text.slice(0, MAX_REPLY), log });
      const plain = stdout.replace(/^\s*\{.*\}\s*$/gm, "").trim();
      const reason =
        signal === "SIGTERM" ? "Bob was stopped." : errors[0] || stderr.trim().split("\n").slice(-3).join(" ") || plain.slice(-400) || `Bob exited with code ${code}.`;
      resolve({ ok: false, error: redact(reason, key).slice(0, 600), log });
    });
  });
}

function shutdown() {
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 200);
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (buffer.length < 4 + length) break;
    const raw = buffer.subarray(4, 4 + length).toString("utf8");
    buffer = buffer.subarray(4 + length);
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      send({ ok: false, error: "Malformed message." });
      continue;
    }
    const handler = { ping, ask, "git-info": gitInfo, "hunt-checkout": huntCheckout }[message.type];
    if (!handler) send({ id: message.id, ok: false, error: `Unknown request: ${message.type}` });
    else handler(message).then((reply) => send({ id: message.id, ...reply }));
  }
});
process.stdin.on("end", shutdown);
process.on("SIGTERM", shutdown);
