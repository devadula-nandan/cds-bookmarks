# Dev Dashboard

A Chrome new tab page for Carbon developers: what needs you on GitHub, ranked, plus every repo's links one click away.

- **For you**: one prioritized list of broken `main`, failing CI, conflicts, change requests, PRs ready to merge, overdue reviews and mentions. Move through it with `J`/`K`, press `S` to snooze an item until tomorrow or until there's new activity on it, and undo from the message that appears. `?` lists every shortcut.
- **Repo bar**: each repo opens a menu with its board, issues, PRs, sites and Storybooks, plus `main` health, the latest release and, with Bob on, **Open in VS Code** for your local clone.
- **Search** (`/` or `⌘K`): PRs, issues, links and actions. Type `carbon 23717` to jump straight to an issue or PR.
- **Issues, Pull requests, Following**: your assigned issues and mentions; review requests, your own PRs and PRs you've reviewed (flagging new commits since your review); and issues and PRs you commented on or reacted to with 👀, with new replies flagged.
- **Today**: your recurring meetings, a to-do list that carries over, and a one-click standup draft.
- **Bob** (optional): review briefs, CI failure explanations, change-request checklists, merge messages, day plans, standup drafts, Slack replies, answers that look things up on GitHub, and a daily bug hunt in your local clones, from IBM Bob. See [Bob](#bob).
- **Background sync**: checks GitHub every few minutes, sends desktop notifications and shows a count of urgent items on the toolbar icon, even when no new tab is open.

## Install

Works in Chrome and other Chromium browsers (Edge, Brave, Arc).

1. Download **[dev-dashboard.zip](https://github.com/devadula-nandan/cds-bookmarks/releases/latest/download/dev-dashboard.zip)** from the [latest release](https://github.com/devadula-nandan/cds-bookmarks/releases/latest).
2. Unzip it. Move the `dev-dashboard` folder somewhere permanent, such as `~/Applications`. Chrome loads the extension from this folder, so don't delete it.
3. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode** in the top-right corner.
4. Click **Load unpacked** and choose the `dev-dashboard` folder.
5. Open a new tab. If Chrome asks whether to keep the new tab page this extension set, choose **Keep it**.

Optionally, pin the extension from the puzzle-piece menu so the urgent-item count shows in the toolbar. Clicking the icon opens a new tab.

### Connect GitHub

1. Create a [classic token](https://github.com/settings/tokens/new?scopes=repo,notifications,read:org&description=Dev%20Dashboard) with the `repo`, `notifications` and `read:org` scopes.
2. If the `carbon-design-system` org asks for SSO, choose **Configure SSO** next to the token on [your tokens page](https://github.com/settings/tokens) and authorize it.
3. Paste the token into the new tab and click **Connect**.

The token is stored in the extension's local storage and is only sent to `api.github.com`.

### Update

Your token, settings and to-dos are kept across updates. **Don't remove the extension to update it**, because removing it erases them.

1. Download the new `dev-dashboard.zip` from the [latest release](https://github.com/devadula-nandan/cds-bookmarks/releases/latest).
2. Replace the files in your existing `dev-dashboard` folder with the ones from the new zip.
3. In `chrome://extensions`, click the reload icon on the **Dev Dashboard** card, then open a new tab.

On macOS or Linux you can do steps 1 and 2 in one go from the folder that contains `dev-dashboard`:

```sh
curl -fsSL -o dev-dashboard.zip https://github.com/devadula-nandan/cds-bookmarks/releases/latest/download/dev-dashboard.zip \
  && unzip -oq dev-dashboard.zip && rm dev-dashboard.zip
```

### Run from a clone instead

If you'd rather track `main`, clone the repo and choose the clone's folder in **Load unpacked**. To update, `git pull` and click the reload icon on the extension's card.

## Bob

Bob actions use [Bob Shell](https://bob.ibm.com/docs/shell) on your computer, through a small helper that Chrome starts when you ask something.

1. Install Bob Shell 2.0 or later (`bob --version`).
2. From the `dev-dashboard` folder, run:

   ```sh
   sh ai-helper/install.sh
   ```

3. Open a new tab, go to **Settings → Bob**, turn on **Bob actions** and paste a Bob API key. Create an **Inference** key at [bob.ibm.com](https://bob.ibm.com) under Settings → API keys.

Re-run the installer if you move the folder or switch Node versions. `sh ai-helper/install.sh --uninstall` removes the helper.

Where Bob shows up:

| Where | What it does |
| --- | --- |
| ✦ on any work item | Picks the right help for the item: a review brief, why CI or `main` is failing, a checklist of requested changes, conflict help, a squash-merge message, a reviewer nudge, what a mention needs from you, or a plan for an issue |
| Search | **Ask Bob** answers questions about your work and links (Enter picks it for questions). **Find with Bob** turns plain English into a GitHub search |
| Header | **Plan my day** around your meetings and what's urgent |
| Today | **Write standup with Bob**, an editable draft for Slack (it replaces **Copy standup update**) |
| Activity | **Catch me up** on what changed since you last looked |
| Issues tab | **Triage with Bob** suggests type, component, severity and duplicates |
| Slack icon (top right) | Paste a support thread; Bob looks up related issues, PRs, docs and code and drafts a reply with its sources |
| Today | **Bug of the day**, see below |

Each action sends Bob a plain question with the item's link. Bob looks up the rest itself: `gh` for GitHub (it uses your own `gh` login), the web, and your local clone when it runs in one.

### Local clones and the bug hunter

Each repo's local clone is its **Local clone** path (like `~/Source/carbon`) in **Settings → Repositories → Edit repositories**, or `clone` on its entry in `bookmarks.json`; leave it blank to skip that repo. A linked repo gets **Open in VS Code** in its repo bar menu. Bob runs unrestricted in these clones (agent mode, with MCP servers and subagents), so it can run commands and change files.

Turn on **Daily bug hunt** for a **Bug of the day**. At the time you pick (9:00 by default, or when Chrome is next open after that) Bob reads one clone, taking turns between repos, and reports the most obvious easy-to-fix bug it can confirm in the code: where it is, why it's wrong, a minimal diff and how confident it is. It skips places it reported before, notes the branch and commit it checked, and lists GitHub issues that might already cover it. You get a notification, the report is on the Today card with a link to the exact line in VS Code, and follow-ups such as "write this up as an issue" read the same clone. **Hunt again** runs one now. Before each hunt the dashboard fetches the latest `main` (from the remote that points at the Carbon repo, so forks work too) and checks it out in a separate worktree under `~/.dev-dashboard/hunts/`, so your clone's branch and changes are never touched. If that fails, for example offline, Bob hunts your clone as it is. A hunt can take several minutes and uses your Bob quota.

Every answer can be copied, regenerated or followed up on, and checklists can be added to your to-dos. Answers are saved per item version (and per day for plans, standups and triage), so reopening one doesn't ask Bob again. You can tell what's waiting: on a row Bob has already answered, the ✦ turns blue (hover it to see which answer), and once you've made today's plan or standup the buttons become **Today's plan** and **Today's standup draft**, which open the saved one instantly. Bob works minimised, several tasks at once, and the button that started each one shows its progress (or its tab, for Triage); click it to bring Bob back. A toast with **Open** says when each one finishes. Follow-ups on a standup, Slack reply or GitHub query revise the draft itself, starting from your edits, with **Undo**.

Nothing is sent to Bob until you click a Bob action. Then the helper runs `bob run` unrestricted (agent mode, with MCP servers and subagents) in an empty folder (`~/.dev-dashboard/bob-workspace`), or in a repo clone for triage and bug hunts. Every answer has a **Bob Shell log** toggle with Bob's full transcript (set `SHOW_LOGS` in `src/page/bob.js` to hide them). Your key is stored with your other settings and only handed to Bob Shell on this computer. Requests count toward your Bob usage.

## Settings

Open them from the gear icon on the new tab:

- **GitHub**: replace or disconnect the token, set the sync interval, and decide when a review counts as overdue.
- **Bob**: turn Bob actions on, check the helper, save your Bob API key and set the daily bug hunt.
- **Repositories**: turn repos off to hide them from the bar, search and your work list.
- **Notifications**: choose which events raise a desktop notification. Everything is still recorded under the bell icon.
- **Meetings**: recurring weekday meetings, reminded 5 minutes before.
- **Appearance**: system, light or dark.

### If notifications don't show up

Click **Send a test notification** under Notifications in Settings. Chrome passes notifications on to the operating system, so if the test doesn't appear, the cause is usually an OS setting:

- **macOS**: go to **System Settings → Notifications → Google Chrome**. Turn on **Allow notifications** and set the alert style to **Banners** or **Alerts**, not **None**. If more than one Chrome entry is listed, change the main "Google Chrome" one.
- **Windows**: go to **Settings → System → Notifications** and turn on **Google Chrome**.
- **Focus / Do Not Disturb** hides banners. Turn it off, or add Chrome to the apps your Focus allows.
- **Check Notification Center** (click the clock in the macOS menu bar). If the test is listed there, notifications are arriving and only the banner is hidden.

## Editing links and repos

Everything in the repo bar comes from [`bookmarks.json`](bookmarks.json): each repo's `id`, `name`, optional `short` name and `clone` path, its `icon` (SVG), and link groups (`github`, `website`, `storybooks`, `others`), each with a `title` and `buttons` of `label`, `href` and optional `versionedHref`/`version`. A repo's GitHub slug is read from its "Issues" link, and its sprint board from the link labelled "Board".

To change it without editing the file, use **Settings → Repositories → Edit repositories**. Saving keeps your list in this browser, ahead of the file; **Export JSON** downloads it so you can replace `bookmarks.json`, and **Reset to bookmarks.json** goes back to the file.

## Releasing

1. Bump `version` in [`manifest.json`](manifest.json).
2. Build the zip and publish it:

```sh
./scripts/package.sh
gh release create v2.0.1 dist/dev-dashboard.zip --title "Dev Dashboard 2.0.1" --notes "…"
```

Keep the asset named `dev-dashboard.zip` so the download links above always point at the newest build. The `key` in `manifest.json` pins the extension ID, which is what lets an update keep everyone's settings. Don't change it.

## How it fits together

No build step and no dependencies: plain ES modules that Chrome loads directly. Edit a file, then click the reload icon on the extension's card.

```
manifest.json        the extension: new tab page, background worker, permissions
background.js        the background worker: syncs on a timer, notifications, toolbar badge, bug hunts
index.html           the new tab page's markup
style.css            all of its styles, light and dark
bookmarks.json       the repos and their links (also editable in Settings)
src/                 shared by the worker and the page
  core.js            small helpers, storage, settings, per-day to-dos and snoozes
  repos.js           the repo list from bookmarks.json
  github.js          the GitHub API: one query for the whole dashboard, plus the inbox
  insights.js        priorities, the header summary, the plain standup
  sync.js            fetch, compare with last time, record activity, notify; meeting reminders
  bob.js             talking to Bob Shell, the prompts, saved answers
  hunt.js            the daily bug hunt
src/page/            the new tab page only
  main.js            entry point: loads state, wires events and shortcuts, re-renders on storage changes
  ui.js              page state and the small helpers every part uses (rows, toasts, focus-safe rendering)
  header.js          greeting, tool buttons, repo bar and menus, Activity drawer
  search.js          the search box
  work.js            the work tabs, snoozing, unfollowing
  today.js           meetings, bug of the day, to-dos
  bob.js             the Bob sheet and every Bob button
  settings.js        the Settings sheet
  repo-editor.js     Settings → Repositories → Edit repositories
  markdown.js        renders Bob's answers (Markdown, syntax colours, diffs)
  icons.js           the line icons
  theme.js           sets a forced light or dark theme before the page paints
ai-helper/           the native messaging host that runs Bob Shell, and its installer
scripts/package.sh   builds dist/dev-dashboard.zip for a release
```

Data flows one way. The background worker syncs GitHub and writes the result to `chrome.storage.local`. The page reads storage on load (`main.js`), keeps a copy in `state` (`ui.js`), and re-renders whenever storage changes. Clicks are routed by `data-action` attributes to the `…Actions` objects each part exports, and anything the page saves goes back into storage.
