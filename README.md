# Dev Dashboard

A Chrome new tab page for Carbon developers: what needs you on GitHub, ranked, plus every repo's links one click away. Optional [IBM Bob](https://bob.ibm.com) actions brief you on PRs, plan your day and hunt for bugs.

## What's on the page

- **For you**: one ranked list of broken `main`, failing CI, merge conflicts, change requests, PRs ready to merge, overdue reviews, mentions and new replies, grouped into Now, Next and Later. Snooze an item until tomorrow or until it has new activity.
- **Issues, Pull requests, Following**: issues assigned to you and mentions; review requests, your PRs and PRs you've reviewed (new commits flagged); threads you commented on or reacted to with 👀.
- **Repo bar**: each repo's GitHub, website and Storybook links, `main` status, latest release and **Open in VS Code** for your local clone.
- **Search** (`/` or `⌘K`): your PRs, issues, links and actions. `carbon 23717` jumps to an issue or PR.
- **Today**: recurring meetings, the bug of the day, and to-dos that carry over to the next day.
- **Activity** (bell): everything that changed since you last looked.
- **In the background**: syncs every few minutes, sends desktop notifications, and shows the count of urgent items on the toolbar icon.

Shortcuts: `J`/`K` move through your work, `S` snoozes, `R` syncs, `A` opens Activity, `1`–`4` switch tabs, `?` lists them all.

## Install

1. Download `dev-dashboard.zip` from the [latest release](https://github.com/devadula-nandan/cds-bookmarks/releases/latest), unzip it and keep the `dev-dashboard` folder somewhere permanent.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose that folder.
3. Open a new tab and choose **Keep it** if Chrome asks.
4. Create a [classic GitHub token](https://github.com/settings/tokens/new?scopes=repo,notifications,read:org&description=Dev%20Dashboard) with `repo`, `notifications` and `read:org`, authorize it for the `carbon-design-system` org's SSO, and paste it into the new tab.

The token stays in the extension's storage and is only sent to `api.github.com`.

To update, replace the folder's files with a newer release and click the reload icon on the extension's card. Don't remove the extension: that erases your token, settings and to-dos. To track `main` instead, load a clone of this repo and `git pull` to update.

## Bob

Bob actions run [Bob Shell](https://bob.ibm.com/docs/shell) 2.0+ on your computer through a small helper.

1. Install Bob Shell, then from the extension folder run `sh ai-helper/install.sh` (`--uninstall` removes it).
2. In **Settings → Bob**, turn on **Bob actions** and paste an **Inference** API key from [bob.ibm.com](https://bob.ibm.com).

| Where | What Bob does |
| --- | --- |
| ✦ on a work row | The right help for that row: review brief, why CI or `main` is failing, a checklist of requested changes, conflict help, merge message, reviewer nudge, what a mention needs, or a plan for an issue |
| Search | **Ask Bob** a question, or **Find with Bob** to turn plain English into a GitHub search |
| Header | **Plan my day**: your 9–5 working day (the next weekday after 5 PM), meetings kept free, assigned issues first |
| Today | **Write standup with Bob**, an editable draft for Slack |
| Activity | **Catch me up** on what changed |
| Issues tab | **Triage with Bob**: type, package, severity and duplicates for issues needing triage |
| Slack icon | Paste a support thread and get a reply draft with sources |
| Today | **Bug of the day**, below |

How it works:

- Each action sends Bob a plain question with the item's link. Bob looks things up itself with `gh` (your own login), the web and your local clones.
- Bob runs **unrestricted** (agent mode, with MCP servers and subagents) in an empty folder, or in a clone for triage and bug hunts, so it can run commands and change files there.
- Tasks run minimised and several can run at once. The button that started one shows its progress, and a toast says when it's ready.
- Answers for work rows, plans, standups and triage are saved, so asking again opens instantly (a row's ✦ turns blue). Follow-ups continue the thread; on drafts they revise the draft, with Undo.
- Every answer has a **Bob Shell log** with Bob's full transcript. Set `SHOW_LOGS` in `src/page/bob.js` to hide it.
- Requests count toward your Bob usage. Nothing is sent until you click a Bob action.

**Bug of the day**: turn on **Daily bug hunt** in Settings → Bob. At the chosen time (9:00 by default) Bob checks out the latest `main` of one clone into its own worktree under `~/.dev-dashboard/hunts/` (your clone isn't touched), finds the most obvious easy-to-fix bug, and reports it with a fix, its confidence and any matching GitHub issue. Repos take turns; a missing clone is skipped.

## Repos and links

The repos come from [`bookmarks.json`](bookmarks.json):

```json
{
  "id": "cds",
  "name": "Carbon Design System",
  "short": "Carbon",
  "clone": "~/Source/carbon",
  "icon": "<svg …>",
  "github": { "title": "GitHub", "buttons": [{ "label": "Issues", "href": "https://github.com/carbon-design-system/carbon/issues" }] },
  "website": { "title": "Website", "buttons": [] },
  "storybooks": { "title": "Storybooks", "buttons": [] },
  "others": { "title": "Playgrounds", "buttons": [] }
}
```

- The GitHub repo is read from a GitHub issues or pulls link, and the sprint board from a link labelled "Board".
- A link can have a `versionedHref` with `<v>` and a default `version`, to open a specific version.
- `clone` is optional; without it, the repo gets no VS Code link or bug hunts.

You can also edit the list in **Settings → Repositories → Edit repositories**. That saves your list in the browser, ahead of the file. **Export JSON** downloads it, and **Reset to bookmarks.json** goes back to the file.

## Notifications

Choose which events notify you in **Settings → Notifications**; everything is still listed under the bell. If **Send a test notification** shows nothing, check that the OS allows Chrome's notifications (macOS: **System Settings → Notifications → Google Chrome**) and that Focus or Do Not Disturb is off.

## Code

Plain ES modules with no build step and no dependencies. Edit a file, then reload the extension.

```
manifest.json     the extension: new tab page, background worker, permissions
background.js     background worker: sync timer, notifications, toolbar badge, bug hunts
index.html        the new tab page
style.css         its styles, light and dark
bookmarks.json    the repos and their links
src/              shared by the worker and the page
  core.js         helpers, storage, settings, per-day to-dos and snoozes
  repos.js        the repo list
  github.js       GitHub API: one query for the dashboard, plus the inbox
  insights.js     priorities, the header summary, the plain standup
  sync.js         fetch, compare with the last sync, record activity, notify; meeting reminders
  bob.js          talking to Bob Shell, prompts, saved answers
  hunt.js         the daily bug hunt
src/page/         the new tab page only
  main.js         entry point: loads state, wires events and shortcuts, re-renders on storage changes
  ui.js           page state and shared view helpers
  header.js       greeting, tool buttons, repo bar, Activity drawer
  work.js         the work tabs, snoozing, unfollowing
  today.js        meetings, bug of the day, to-dos
  bob.js          the Bob sheet and every Bob button
  search.js       the search box
  settings.js     the Settings sheet
  repo-editor.js  the repo editor
  markdown.js     renders Bob's answers (Markdown, syntax colours, diffs)
  icons.js        line icons
  tooltip.js      the page's one tooltip, for every [data-tooltip]
  theme.js        applies a forced light or dark theme before the page paints
ai-helper/        the native messaging host that runs Bob Shell, and its installer
scripts/package.sh  builds dist/dev-dashboard.zip
```

Data flows one way: the background worker syncs GitHub into `chrome.storage.local`; the page loads storage into `state` and re-renders whenever it changes. Clicks are routed by `data-action` attributes to the `…Actions` object of the part that owns them.

## Releasing

1. Bump `version` in `manifest.json`.
2. Push a `v*` tag (for example `v2.0.1`). The `chrome-web-store-publish` workflow builds the zip with `scripts/package.sh` and uploads it to the Chrome Web Store.
3. For the GitHub release download, run `./scripts/package.sh` and attach `dist/dev-dashboard.zip` to the release, keeping that file name.

Don't change `key` in `manifest.json`: it pins the extension ID, which keeps everyone's settings across updates and lets the Bob helper recognize the extension.
