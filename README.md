# Dev Dashboard

A Chrome new tab page for Carbon developers: what needs you on GitHub, ranked, plus every repo's links one click away.

- **For you**: one prioritized list of broken `main`, failing CI, conflicts, change requests, PRs ready to merge, overdue reviews and mentions. Snooze anything until tomorrow.
- **Repo bar**: each repo opens a menu with its board, issues, PRs, sites and Storybooks, plus `main` health, the latest release and, with Bob on, **Open in VS Code** for your local clone.
- **Search** (`/` or `⌘K`): PRs, issues, links and actions. Type `carbon 23717` to jump straight to an issue or PR.
- **Following**: issues and PRs you commented on or reacted to with 👀, with new replies flagged. **Reviews** also lists open PRs you've already reviewed and flags new commits since your review.
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

The token is stored in the extension's local storage and is only sent to `api.github.com`. Not ready to connect? Choose **Explore with sample data first**.

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

Bob actions use [Bob Shell](https://bob.ibm.com/docs/shell) on your computer, through a small helper that Chrome starts when you ask something. They only work in the extension, not the web version.

1. Install Bob Shell 2.0 or later (`bob --version`).
2. From the `dev-dashboard` folder, run:

   ```sh
   sh ai-helper/install.sh
   ```

3. Open a new tab, go to **Settings → Bob**, turn on **Bob actions** and paste a Bob API key. Create an **Inference** key at [bob.ibm.com](https://bob.ibm.com) under Settings → API keys. A **General** key also needs your team ID.

Re-run the installer if you move the folder or switch Node versions. `sh ai-helper/install.sh --uninstall` removes the helper.

Where Bob shows up:

| Where | What it does |
| --- | --- |
| ✦ on any work item | Picks the right help for the item: a review brief from the diff, why CI or `main` is failing (from the failed checks and job logs), a checklist of requested changes, conflict help, a squash-merge message, a reviewer nudge, what a mention needs from you, or a plan for an issue |
| Search | **Ask Bob** answers questions about your work and links (Enter picks it for questions). **Find with Bob** turns plain English into a GitHub search |
| Header | **Plan my day** around your meetings and what's urgent |
| Today | **Write standup with Bob**, an editable draft for Slack |
| Activity | **Catch me up** on what changed since you last looked |
| Issues tab | **Triage with Bob** suggests type, component, severity and duplicates |
| Slack icon (top right) | Paste a support thread; Bob looks up related issues and PRs, reads your local clone if it's about code, and drafts a reply with its sources |
| Today | **Bug of the day**, see below |

**Ask Bob** and Slack replies first have Bob plan what to look up (searches and issue numbers). The dashboard fetches those from GitHub and Bob answers from what was found. If the question is about code and that repo has a local clone, Bob reads it too.

### Local clones and the bug hunter

With Bob on, the dashboard links each repo to its clone on your computer automatically: it looks one level inside `~/Source`, `~/src`, `~/code`, `~/Projects` and similar folders, at most once a day, and never replaces a path you set. Edit the paths under **Settings → Bob → Local clones**, or click **Find clones on this computer** to look again. A linked repo gets **Open in VS Code** in its repo bar menu. Bob runs in ask mode in these clones, so it reads files but doesn't change them.

Turn on **Daily bug hunt** for a **Bug of the day**. At the time you pick (9:00 by default, or when Chrome is next open after that) Bob reads one clone, taking turns between repos, and reports the most obvious easy-to-fix bug it can confirm in the code: where it is, why it's wrong, a minimal diff and how confident it is. It skips places it reported before, notes the branch and commit it checked, and lists GitHub issues that might already cover it. You get a notification, the report is on the Today card with a link to the exact line in VS Code, and follow-ups such as "write this up as an issue" read the same clone. **Hunt again** runs one now. A hunt can take several minutes and uses your Bob quota, and it's only as current as your clone, so keep it pulled.

Every answer can be copied, regenerated or followed up on, and checklists can be added to your to-dos. Answers are saved per item version (and per day for plans, standups and triage), so reopening one doesn't ask Bob again.

Nothing is sent to Bob until you click a Bob action. Then the helper runs `bob run --mode ask` in an empty folder (`~/.dev-dashboard/bob-workspace`) with that item's title, description, comments, diff or CI logs as the prompt. Your key is stored with your other settings and only handed to Bob Shell on this computer. Requests count toward your Bob usage.

## Settings

Open them from the gear icon on the new tab:

- **GitHub**: replace or disconnect the token, set the sync interval, and decide when a review counts as overdue.
- **Bob**: turn Bob actions on, check the helper, save your Bob API key, set local clones and the daily bug hunt.
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

The web version also needs the site's permission. Chrome asks for it the first time you send a test. If you blocked it, allow it again from the site settings icon in the address bar. On the web, notifications only appear while the tab is open in the background. While the tab is in front, updates show as messages on the page instead.

## Editing links and repos

Everything in the repo bar comes from [`bookmarks-data.js`](bookmarks-data.js). A repo's GitHub slug is read from its "Issues" link, and its sprint board from the link labelled "Board".

## Web version

The same page runs without installing at https://devadula-nandan.github.io/cds-bookmarks/. It keeps its data in that site's `localStorage` and syncs only while the page is open, so it can't sync in the background or show a toolbar badge. To preview a local change the same way:

```sh
python3 -m http.server 8000
```

## Releasing

1. Bump `version` in [`manifest.json`](manifest.json).
2. Build the zip and publish it:

```sh
./scripts/package.sh
gh release create v2.0.1 dist/dev-dashboard.zip --title "Dev Dashboard 2.0.1" --notes "…"
```

Keep the asset named `dev-dashboard.zip` so the download links above always point at the newest build. The `key` in `manifest.json` pins the extension ID, which is what lets an update keep everyone's settings. Don't change it.

## Layout

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest; overrides the new tab page |
| `background.js` | Service worker: alarms, sync, notifications, toolbar badge |
| `index.html`, `js/app.js`, `css/app.css` | The new tab page |
| `js/sync.js` | Fetch → diff → activity log → notifications (shared) |
| `js/github.js`, `js/insights.js` | GitHub API client and prioritization |
| `js/core.js` | Utilities, storage (`chrome.storage` or `localStorage`), settings, per-day state |
| `js/ai.js` | Bob: native-messaging client, prompts and context, answer cache, Markdown rendering |
| `ai-helper/` | Native messaging host that runs Bob Shell, and its installer |
| `scripts/package.sh` | Builds `dist/dev-dashboard.zip` for a release |
