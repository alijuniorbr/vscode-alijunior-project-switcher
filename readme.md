# VSCode Project Switcher

Switch between open VSCode windows from the status bar, with per-project names, colors and icons.

## Features

- Status bar item showing the current project
- Hover lists your pinned projects and the most recently used ones, as direct links
- One click either opens the full picker or jumps to the last used project — your choice
- Per-project display name, color, icon and pin, set through a guided command
- Full picker lists all open windows sorted alphabetically
- No extra permissions required

## Usage

Hover the project name in the status bar to pick from your pinned and recent projects. Click it to open the picker (or to jump to the last project, if you set `clickAction` to `last`).

Press `⌃⌘O` (macOS) or `Ctrl+Alt+O` (Windows/Linux) to jump to the last used project without leaving the keyboard.

Press `⌃⌘P` (macOS) or `Ctrl+Alt+P` (Windows/Linux) to open the full window picker.

Run `Switch Projects: Configure Current Project` from the Command Palette — or click the gear at the top of the hover — to set this project's name, color, icon, order and pin.

## Recommended: make the hover snappier

The delay before the hover appears is controlled by VSCode itself, not by this extension. The default is slow enough that the hover feels unresponsive for something you use dozens of times a day.

```json
"workbench.hover.delay": 200
```

Add it to your `settings.json`. This setting is workbench-wide, so it also speeds up hovers on tabs, the activity bar and the rest of the UI — which is usually a win, but try `300` if `200` feels too eager elsewhere.

## The hover

The hover is built in sections, top to bottom:

**Last N opened** — the projects you used most recently, where N is `recentCount`. Pinned projects are left out, so they never take these slots. Which projects make the list is decided by recency; the order they appear in is alphabetical, so each one keeps a stable position instead of moving around as you work.

**Pinned** — the projects you marked as pinned, in the order you declared. Pinned projects without an order fall behind, alphabetically.

**Last Active** — the project you came from. Shown only when `clickAction` is `picker`, since otherwise the click already does this. It appears even if the same project is already listed above.

The footer is always the complement of the click: with `clickAction` set to `last`, the hover ends with the picker instead of the last active project.

## Configuration

All settings are available under `switchProjects.*` in your `settings.json`.

### `switchProjects.clickAction`

What clicking the status bar item does — `"picker"` opens the full window picker, `"last"` jumps straight to the last used project.

**Default:** `"picker"`

```json
"switchProjects.clickAction": "last"
```

### `switchProjects.projectSettings`

Per-project overrides, keyed by absolute project path. Every field is optional, and anything left out falls back to the derived value: the folder name, the global color, the default icon.

Easier to set through `Switch Projects: Configure Current Project` than by hand, but the shape is plain JSON:

```json
"switchProjects.projectSettings": {
  "/Users/me/dev/comum-core": {
    "name": "Core",
    "color": "#7FD1B9",
    "icon": "package",
    "order": 1,
    "pinned": true
  }
}
```

When a project has a display name, the hover shows it with the real folder name as a suffix — `Core (comum-core)` — so the directory stays recognizable. The status bar shows only the display name.

Note that the key is an absolute path: moving a project to another folder orphans its settings.

### `switchProjects.recentCount`

How many recently used projects are listed in the hover. Pinned projects don't take these slots.

Set it to `0` to turn the hover off entirely. The status bar item then shows only the current project name, and clicking it opens the full picker.

**Default:** `3`

```json
"switchProjects.recentCount": 5
```

### `switchProjects.statusBarColor`

Default color of the status bar item, used when the current project has no color of its own. Accepts a hex value or a theme color id — a theme color id makes the item follow the current theme instead of pinning one tone. Leave it empty to use the status bar default color.

**Default:** `"#FFD700"`

```json
"switchProjects.statusBarColor": "statusBarItem.warningForeground"
```

### `switchProjects.palette`

List of icons assigned to projects in the picker, by alphabetical position. The first project gets the first icon, the second gets the second, and so on. Wraps around if there are more projects than icons.

**Default:**
```json
"switchProjects.palette": [
  "🔴","🟠","🟡","🟢","🔵","🟣","🟤","⚫","⚪",
  "🟥","🟧","🟨","🟩","🟦","🟪","🟫","⬛","⬜"
]
```

### `switchProjects.currentIcon`

Icon shown for the currently active project in the picker, instead of its palette color.

**Default:** `"➜"`

```json
"switchProjects.currentIcon": "▶"
```

### `switchProjects.pinCurrentFirst`

When `true`, the current project is always shown at the top of the picker. When `false`, it stays in its natural alphabetical position.

**Default:** `true`

```json
"switchProjects.pinCurrentFirst": false
```

## How it works

Each VSCode window registers itself in `~/.vscode/project-switcher/project-list.json` on startup and removes itself on close. The picker and the hover read this file and display all registered windows.

While the hover is enabled, a window also refreshes its own timestamp every time it gains focus. That timestamp is what decides which projects are recent — for every other window, it marks the moment focus left it.

## Requirements

- VSCode 1.75+
- macOS, Windows, or Linux

## Credits

Modified based on [antfu/vscode-where-am-i](https://github.com/antfu/vscode-where-am-i) — the per-project name, color and icon overrides follow the approach used there.

## License

MIT