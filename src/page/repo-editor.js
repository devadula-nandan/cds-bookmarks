// The repository editor (Settings → Repositories → Edit repositories): a form over every option of an
// entry in bookmarks.json. Saving keeps the list in this browser (`repoData`), ahead of the file; Export
// JSON downloads it to replace bookmarks.json, and Reset loads the file back in.

import { esc, storage } from "../core.js";
import { fileRepos, rawRepos } from "../repos.js";
import { icon } from "./icons.js";
import { $, toast } from "./ui.js";

const GROUPS = [
  ["github", "GitHub"],
  ["website", "Website"],
  ["storybooks", "Storybooks"],
  ["others", "Playgrounds"],
];
// Optional fields: left out of the JSON when blank.
const OPTIONAL = new Set(["short", "clone", "versionedHref", "version"]);

let draft = [];
// Repos unfolded in the editor, kept across re-renders (by entry, so moving one keeps it open).
const unfolded = new WeakSet();

async function openEditor() {
  draft = rawRepos();
  render();
  const dialog = $("#repo-editor");
  if (!dialog.open) dialog.showModal();
}

function field(path, label, value, { mono = false, placeholder = "" } = {}) {
  return `<label class="field"><span>${label}</span><input class="input${mono ? " mono" : ""}" data-path="${path}" value="${esc(value ?? "")}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false"></label>`;
}

function linkRow(path, link, j) {
  const p = `${path}.buttons.${j}`;
  return `
    <div class="editor-link">
      ${field(`${p}.label`, "Label", link.label)}
      ${field(`${p}.href`, "URL", link.href, { mono: true, placeholder: "https://…" })}
      ${field(`${p}.versionedHref`, "Versioned URL", link.versionedHref, { mono: true, placeholder: "Optional, uses <v>" })}
      ${field(`${p}.version`, "Version", link.version, { placeholder: "Optional" })}
      <button class="icon-btn icon-btn--sm editor-link__remove" data-action="editor-remove" data-path="${p}" aria-label="Remove ${esc(link.label || "link")}" data-tooltip="Remove link">${icon("trash", 14)}</button>
    </div>`;
}

function groupBlock(entry, i, key, fallback) {
  const group = entry[key];
  if (!group) return "";
  const path = `${i}.${key}`;
  return `
    <fieldset class="editor-group">
      <div class="editor-group__head">
        ${field(`${path}.title`, `${fallback} group title`, group.title)}
        <button class="btn btn--ghost btn--sm" data-action="editor-remove" data-path="${path}">Remove group</button>
      </div>
      ${(group.buttons || []).map((link, j) => linkRow(path, link, j)).join("")}
      <button class="btn btn--ghost btn--sm" data-action="editor-add-link" data-path="${path}">${icon("plus", 14)}Add link</button>
    </fieldset>`;
}

function repoBlock(entry, i) {
  const missing = GROUPS.filter(([key]) => !entry[key]);
  return `
    <details class="editor-repo" data-index="${i}" ${unfolded.has(entry) ? "open" : ""}>
      <summary>
        <span class="editor-repo__logo" aria-hidden="true">${entry.icon || ""}</span>
        <span class="editor-repo__name">${esc(entry.name || "Untitled repo")}<small class="mono">${esc(entry.id || "")}</small></span>
        <button class="icon-btn icon-btn--sm" data-action="editor-move" data-index="${i}" data-by="-1" aria-label="Move up" data-tooltip="Move up" ${i ? "" : "disabled"}>${icon("arrowUp", 14)}</button>
        <button class="icon-btn icon-btn--sm" data-action="editor-move" data-index="${i}" data-by="1" aria-label="Move down" data-tooltip="Move down" ${i < draft.length - 1 ? "" : "disabled"}>${icon("arrowDown", 14)}</button>
        <button class="icon-btn icon-btn--sm" data-action="editor-remove" data-path="${i}" aria-label="Remove ${esc(entry.name || "repo")}" data-tooltip="Remove repo">${icon("trash", 14)}</button>
      </summary>
      <div class="editor-repo__body">
        <div class="fields">
          ${field(`${i}.id`, "ID", entry.id, { mono: true, placeholder: "cds" })}
          ${field(`${i}.name`, "Name", entry.name, { placeholder: "Carbon Design System" })}
          ${field(`${i}.short`, "Short name", entry.short, { placeholder: "Optional, for tight spots" })}
          ${field(`${i}.clone`, "Local clone", entry.clone, { mono: true, placeholder: "Optional, like ~/Source/carbon" })}
        </div>
        <label class="field"><span>Logo (SVG)</span><textarea class="input mono editor-svg" rows="3" data-path="${i}.icon" spellcheck="false">${esc(entry.icon || "")}</textarea></label>
        <p class="hint">The GitHub repo comes from a GitHub link to its issues or pulls, and the sprint board from a link labelled “Board”.</p>
        ${GROUPS.map(([key, title]) => groupBlock(entry, i, key, title)).join("")}
        ${missing.length ? `<p class="editor-add">${missing.map(([key, title]) => `<button class="btn btn--ghost btn--sm" data-action="editor-add-group" data-index="${i}" data-key="${key}">${icon("plus", 14)}${title} group</button>`).join("")}</p>` : ""}
      </div>
    </details>`;
}

function render() {
  const el = $("#repo-editor");
  const body = $(".sheet__body", el);
  const scroll = body?.scrollTop || 0;
  el.innerHTML = `
    <header class="sheet__head">
      <h2>Edit repositories</h2>
      <button class="icon-btn" data-action="editor-close" aria-label="Close">${icon("x", 18)}</button>
    </header>
    <div class="sheet__body">
      <p class="hint">Everything in the repo bar, search and work list. Saving keeps this list in this browser, ahead of <code>bookmarks.json</code>; use <b>Export JSON</b> to update the file.</p>
      ${draft.map(repoBlock).join("")}
      <button class="btn btn--sm" data-action="editor-add-repo">${icon("plus", 14)}Add repository</button>
    </div>
    <footer class="editor__foot">
      <label class="btn btn--ghost btn--sm">Import JSON<input type="file" accept="application/json,.json" data-editor-import hidden></label>
      <button class="btn btn--ghost btn--sm" data-action="editor-reset">Reset to bookmarks.json</button>
      <span class="editor__spacer"></span>
      <button class="btn btn--sm" data-action="repo-export">Export JSON</button>
      <button class="btn btn--primary btn--sm" data-action="editor-save">Save</button>
    </footer>`;
  const next = $(".sheet__body", el);
  if (next) next.scrollTop = scroll;
}

/** Walks "2.github.buttons.0" to [parent, key]. */
function locate(path) {
  const keys = path.split(".").map((k) => (/^\d+$/.test(k) ? Number(k) : k));
  const last = keys.pop();
  return [keys.reduce((o, k) => o[k], draft), last];
}

export function bindEditor() {
  const el = $("#repo-editor");
  el.addEventListener("input", (e) => {
    const path = e.target.dataset.path;
    if (!path) return;
    const [parent, key] = locate(path);
    const value = e.target.value;
    if (OPTIONAL.has(key) && !value.trim()) delete parent[key];
    else parent[key] = value;
  });
  el.addEventListener(
    "toggle",
    (e) => {
      if (!e.target.matches(".editor-repo")) return;
      const entry = draft[e.target.dataset.index];
      if (entry) e.target.open ? unfolded.add(entry) : unfolded.delete(entry);
    },
    true
  );
  el.addEventListener("change", async (e) => {
    if (!e.target.matches("[data-editor-import]")) return;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error("expected a list of repos");
      draft = parsed;
      render();
      toast(`Imported ${file.name}. Save to use it.`, "success");
    } catch (err) {
      toast(`Couldn't import ${file.name}: ${err.message}`, "error");
    }
  });
}

/** Downloads `list` as bookmarks.json. */
function exportJson(list = rawRepos()) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(list, null, 2) + "\n"], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "bookmarks.json" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function problems() {
  const ids = draft.map((e) => String(e.id || "").trim());
  const out = [];
  draft.forEach((e, i) => {
    if (!ids[i]) out.push(`repo ${i + 1} needs an ID`);
    else if (ids.indexOf(ids[i]) !== i) out.push(`ID “${ids[i]}” is used twice`);
    if (!String(e.name || "").trim()) out.push(`${ids[i] || `repo ${i + 1}`} needs a name`);
  });
  return out;
}

async function save() {
  const issues = problems();
  if (issues.length) return toast(`Can't save: ${issues.slice(0, 2).join("; ")}`, "error");
  // Matching the file again means there's nothing to keep: drop the saved copy so file updates come through.
  const same = JSON.stringify(draft) === JSON.stringify(await fileRepos());
  if (same) await storage.remove("repoData");
  else await storage.set({ repoData: draft });
  // The page reloads on the change (see onStorage), so everything picks up the new list.
}

export const editorActions = {
  "repo-editor": openEditor,
  "repo-export": () => ($("#repo-editor").open ? exportJson(draft) : exportJson()),
  "editor-close": () => $("#repo-editor").close(),
  "editor-save": save,
  "editor-reset": async () => {
    draft = await fileRepos();
    render();
    toast("Loaded bookmarks.json. Save to use it.");
  },
  "editor-add-repo": () => {
    const entry = { id: "", name: "", github: { title: "GitHub", buttons: [{ label: "Issues", href: "https://github.com/OWNER/REPO/issues" }] } };
    draft.push(entry);
    unfolded.add(entry);
    render();
  },
  "editor-add-group": (el) => {
    const entry = draft[el.dataset.index];
    entry[el.dataset.key] = { title: GROUPS.find(([k]) => k === el.dataset.key)[1], buttons: [] };
    render();
  },
  "editor-add-link": (el) => {
    const [parent, key] = locate(el.dataset.path);
    (parent[key].buttons ||= []).push({ label: "", href: "" });
    render();
  },
  "editor-remove": (el) => {
    const [parent, key] = locate(el.dataset.path);
    if (Array.isArray(parent)) parent.splice(key, 1);
    else delete parent[key];
    render();
  },
  "editor-move": (el) => {
    const i = Number(el.dataset.index);
    const j = i + Number(el.dataset.by);
    if (j < 0 || j >= draft.length) return;
    [draft[i], draft[j]] = [draft[j], draft[i]];
    render();
  },
};
