#!/usr/bin/env node
/**
 * Dev Dashboard ↔ Bob Shell bridge (Chrome native messaging host).
 *
 * Chrome starts this process when the new tab page asks Bob something. Each
 * request runs `bob run --mode ask` once. By default that's in an empty
 * workspace, so Bob only sees the context the page sends. When the page names
 * a local clone (bug hunts, code questions), Bob may read that clone; ask mode
 * doesn't change files.
 *
 * Protocol: 4-byte little-endian length + UTF-8 JSON, both directions.
 *   { type: "ping" }                                   → { ok, version, home }
 *   { type: "ask", prompt, key?, teamId?, workspace?, maxTurns?, timeoutMs? }
 *                                                      → { ok, text } | { ok: false, error }
 *   { type: "find-clones", slugs }                     → { ok, clones: { slug: path } }
 *   { type: "git-info", path }                         → { ok, branch, head, committed }
 * Closing the port (Cancel in the page) ends stdin, which stops Bob.
 */
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BOB = process.env.DD_BOB || "bob";
const WORKSPACE = path.join(os.homedir(), ".dev-dashboard", "bob-workspace");
const TIMEOUT_MS = 180000;
const MAX_TIMEOUT_MS = 20 * 60000;
const CLONE_ROOTS = ["Source", "src", "code", "dev", "Developer", "Projects", "projects", "repos", "git", "github", "workspace", "work", ""];
const MAX_REPLY = 900 * 1024; // Chrome caps host → browser messages at 1 MB.

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

/** `last_message` is a string, or a list of content parts in some Bob versions. */
function messageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
  return content?.text || "";
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

/** Looks one level inside the usual code folders for clones whose origin is one of `slugs`. */
function findClones({ slugs = [] }) {
  const wanted = new Map(slugs.map((s) => [s.toLowerCase(), s]));
  const exact = {};
  const forks = {};
  for (const root of CLONE_ROOTS) {
    const base = path.join(os.homedir(), root);
    let entries = [];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const dir = path.join(base, entry.name);
      let config = "";
      try {
        config = fs.readFileSync(path.join(dir, ".git", "config"), "utf8");
      } catch {
        continue;
      }
      const remotes = [...config.matchAll(/url\s*=\s*\S*github\.com[:/]([^\s]+?)(?:\.git)?\s*$/gim)].map((m) => m[1].toLowerCase());
      const short = dir.replace(os.homedir(), "~");
      for (const remote of remotes) {
        if (wanted.has(remote)) exact[wanted.get(remote)] ||= short;
        // A fork (same repo name, another owner) only counts when there's no exact clone.
        const fork = [...wanted.values()].find((slug) => slug.split("/")[1].toLowerCase() === remote.split("/")[1]);
        if (fork) forks[fork] ||= short;
      }
    }
  }
  return Promise.resolve({ ok: true, clones: { ...forks, ...exact } });
}

function git(dir, args) {
  return new Promise((resolve) => execFile("git", ["-C", dir, ...args], { timeout: 10000 }, (err, out) => resolve(err ? "" : String(out).trim())));
}

async function gitInfo({ path: p }) {
  try {
    const dir = cloneDir(p);
    const [branch, head, committed] = await Promise.all([git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), git(dir, ["rev-parse", "HEAD"]), git(dir, ["log", "-1", "--format=%cI"])]);
    return { ok: true, branch, head, committed };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function ask({ prompt, key, teamId, workspace, maxTurns, timeoutMs }) {
  if (!prompt) return Promise.resolve({ ok: false, error: "Empty prompt." });
  let dir = WORKSPACE;
  try {
    if (workspace) dir = cloneDir(workspace);
    else fs.mkdirSync(WORKSPACE, { recursive: true });
  } catch (err) {
    return Promise.resolve({ ok: false, error: err.message });
  }
  const turns = Math.min(Math.max(Number(maxTurns) || 4, 1), 80);
  const limit = Math.min(Math.max(Number(timeoutMs) || TIMEOUT_MS, 10000), MAX_TIMEOUT_MS);
  const args = ["run", "--mode", "ask", "--format", "json", "--disable-mcp", "--disable-subagents", "--max-turns", String(turns), "--log-level", "error", "--trust", "--workspace", dir];
  if (teamId) args.push("--team-id", teamId);
  args.push(prompt);

  const env = { ...process.env, BOB_LOG_LEVEL: "error" };
  if (key) env.BOB_API_KEY = key;
  const [cmd, argv] = bobCommand(args);

  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    children.add(child);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), limit);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    child.on("error", (err) => {
      clearTimeout(timer);
      children.delete(child);
      resolve({ ok: false, error: `Couldn't start Bob Shell: ${err.message}` });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      children.delete(child);
      let result = null;
      const errors = [];
      for (const line of stdout.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "result") result = event;
          if (event.type === "error" && event.message) errors.push(event.message);
        } catch {}
      }
      const text = result ? messageText(result.last_message).trim() : "";
      if (text) return resolve({ ok: true, text: text.slice(0, MAX_REPLY), cost: result.stats?.session_costs ?? null });
      const plain = stdout.replace(/^\s*\{.*\}\s*$/gm, "").trim();
      const reason =
        signal === "SIGTERM" ? `Bob didn't answer within ${Math.round(limit / 1000)}s.` : errors[0] || stderr.trim().split("\n").slice(-3).join(" ") || plain.slice(-400) || `Bob exited with code ${code}.`;
      resolve({ ok: false, error: redact(reason, key).slice(0, 600) });
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
    const handler = { ping, ask, "find-clones": findClones, "git-info": gitInfo }[message.type];
    if (!handler) send({ id: message.id, ok: false, error: `Unknown request: ${message.type}` });
    else handler(message).then((reply) => send({ id: message.id, ...reply }));
  }
});
process.stdin.on("end", shutdown);
process.on("SIGTERM", shutdown);
