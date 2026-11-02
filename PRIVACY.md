# Dev Dashboard privacy policy

Last updated: October 27, 2026

Dev Dashboard is a Chrome extension that replaces the new tab page with your GitHub work and your repositories' links. This policy explains what data it handles and where that data goes.

## What the extension handles

- **GitHub personal access tokens** that you paste into the new tab page: one for github.com and one for each GitHub Enterprise host you connect.
- **GitHub data** fetched with that token: your login, pull requests, issues, reviews, comments, notifications, CI status and releases for the repositories you work on.
- **Things you create in the extension**: settings, your repository list, to-dos, meetings, snoozed items and saved Bob answers.
- **Bob API key** (optional), if you turn on Bob actions.

## Where it is stored

Everything is stored locally in your browser with `chrome.storage.local`. The extension has no server of its own and the developer receives none of this data.

## Who it is shared with

- **GitHub** (`api.github.com`, and any GitHub Enterprise host you connect, such as `github.ibm.com`): each token is sent only to its own host, to fetch your GitHub data.
- **IBM Bob** (optional): only when you click a Bob action, the extension sends the request and your Bob API key to the Bob helper installed on your own computer, which runs Bob Shell. Bob Shell sends the request to IBM under your Bob account and may use your local `gh` login, the web and your local clones to answer. IBM's handling of that data is covered by IBM's own terms and privacy policy.

The extension does not sell data, does not use it for advertising or analytics, does not track your browsing, and does not share it with anyone else.

The use of information received from Google APIs and Chrome will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Deleting your data

Remove your token or Bob key in Settings, or uninstall the extension to erase all of its stored data. You can revoke a GitHub token at any time on its host's tokens page, such as https://github.com/settings/tokens.

## Contact

Questions about this policy: open an issue at https://github.com/devadula-nandan/cds-bookmarks/issues.
