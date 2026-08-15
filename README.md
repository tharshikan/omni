# Leap

Leap between tabs, commands, and history — a fast, keyboard-first command palette for Chrome. 🚀

Leap is a heavily reworked fork of [Omni](https://github.com/alyssaxuu/omni) by [Alyssa X](https://twitter.com/alyssaxuu), with a redesigned macOS-style UI, an IntelliJ-style recents switcher, an explorer drawer, and a hardened keyboard/focus model.

## Features

🗄 Switch, open, close, and search your tabs<br> 📚 Browse and manage your bookmarks<br> 🔍 Search your browsing history<br> ⚡️ 50+ actions to improve your productivity<br> 🔮 Special commands to filter and perform more actions<br> ⌨️ Shortcuts for actions such as muting, pinning, bookmarking...<br> 🌙 Dark mode<br> ...and much more - all for free & no sign in needed!

## The three surfaces

- **Command palette** — `⌘+Shift+K` (Mac) / `Ctrl+Shift+K` (Windows). Type a command or search across tabs, bookmarks, history, and actions.
- **Recents switcher** — `⌘+Shift+A` / `Ctrl+Shift+A`. Opens with your previous tab preselected, IntelliJ-style: tap the shortcut then Enter to bounce between your two most recent tabs, or type to search recents and the shortcut rail.
- **Explorer drawer** — `⌘+Shift+E` / `Ctrl+Shift+E`. The same recents switcher as a full-height drawer that slides in from the left edge.

Press `Esc` to close any of them, or click outside. You can change shortcuts at chrome://extensions/shortcuts.

## List of commands

- **/tabs**: Search your tabs
- **/bookmarks**: Search your bookmarks
- **/history**: Search your browser history
- **/actions**: Search all available actions
- **/remove**: Remove a bookmark or close a tab

## Installing

1. Download the code — green "Code" button → "Download ZIP" (or clone the repo).
2. Go to chrome://extensions/ and enable developer mode.
3. Click "Load unpacked" and select the `src` folder.
4. That's it — press `⌘+Shift+K` to leap.

## Libraries used

- [jQuery](https://jquery.com/) - for better event handling and DOM manipulation
- [dom-focus-lock](https://github.com/theKashey/dom-focus-lock) - to keep focus on the input field

## Credits

Based on [Omni](https://github.com/alyssaxuu/omni) by [Alyssa X](https://alyssax.com). See [LICENSE](LICENSE) for details.
