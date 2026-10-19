# Dev Dashboard

A Chrome new tab page for Carbon developers: what needs you on GitHub, ranked, plus every repo's links one click away.

- **For you**: one prioritized list of broken `main`, failing CI, conflicts, change requests, PRs ready to merge, overdue reviews and mentions. Snooze anything until tomorrow.
- **Repo bar**: each repo opens a menu with its board, issues, PRs, sites and Storybooks, plus `main` health and the latest release.
- **Search** (`/` or `⌘K`): PRs, issues, links and actions. Type `carbon 23717` to jump straight to an issue or PR.
- **Today**: your recurring meetings, a to-do list that carries over, and a one-click standup draft.
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

## Settings

Open them from the gear icon on the new tab:

- **GitHub**: replace or disconnect the token, set the sync interval, and decide when a review counts as overdue.
- **Repositories**: turn repos off to hide them from the bar, search and your work list.
- **Notifications**: choose which events raise a desktop notification. Everything is still recorded under the bell icon.
- **Meetings**: recurring weekday meetings, reminded 5 minutes before.
- **Appearance**: system, light or dark.

If notifications don't appear on macOS, allow them for Chrome in **System Settings → Notifications**.

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
| `scripts/package.sh` | Builds `dist/dev-dashboard.zip` for a release |
