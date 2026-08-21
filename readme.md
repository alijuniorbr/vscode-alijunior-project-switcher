# VSCode Project Switcher

Switch between open VSCode windows from the status bar, with per-project names, colors and icons.

## Features

- Status bar item showing the current project
- Hover lists your pinned projects and the most recently used ones, as direct links
- Pin and unpin straight from the hover, one click per project
- One click on the item either opens the full picker or jumps to the last used project — switchable from the hover itself
- Per-project display name, color, icon and order
- Full picker lists all open windows sorted alphabetically, each with a stable palette icon
- No extra permissions required

## Usage

Hover the project name in the status bar to pick from your pinned and recent projects. Click it to open the picker — or to jump to the last project, if you switch `clickAction` to `last`.

Everything is also reachable from the keyboard and the Command Palette:

| Command | Shortcut | What it does |
| --- | --- | --- |
| `Switch Projects: Open Window Picker` | `⌃⌘P` / `Ctrl+Alt+P` | Lists every open window, filterable |
| `Switch Projects: Go to Last Project` | `⌃⌘O` / `Ctrl+Alt+O` | Jumps straight to the window you came from |
| `Switch Projects: Configure Current Project` | — | Sets this project's name, color, icon or order |

## Recommended: make the hover snappier

The delay before the hover appears is controlled by VSCode itself, not by this extension. The default is slow enough that the hover feels unresponsive for something you use dozens of times a day.

```json
"workbench.hover.delay": 200
```

Add it to your `settings.json`. This setting is workbench-wide, so it also speeds up hovers on tabs, the activity bar and the rest of the UI — which is usually a win, but try `300` if `200` feels too eager elsewhere.

## The hover

Top to bottom:

**Header** — the current project, plus a gear that configures it. `Open picker` sits right below when clicking the status bar item already opens the picker. It stays visible on purpose: the status bar item is the extension's only entry point, and hiding the picker would leave a first-time user with no way to find it.

**Last N opened** — the projects you used most recently, where N is `recentCount`. Pinned projects are left out, so they never take these slots. Which projects make the list is decided by recency; the order they appear in is alphabetical, so each one keeps a stable position instead of moving around as you work.

**Pinned** — the projects you marked as pinned, in the order you declared. Pinned projects without an order fall behind, alphabetically.

**Footer** — a single line, the closest one to the mouse, holding whatever the click doesn't do: the last active project when `clickAction` is `picker`, `Open picker` when it's `last`. A gear opens on its left, switching the click between **Last** and **Picker**.

Every project line above the footer starts with a pin icon: `$(pin)` adds the project to the Pinned section, `$(pinned)` removes it. Unpinning keeps the rest of that project's settings — name, color, icon and order all stay, and come back if you pin it again.

Icons lead each line so the click targets stack in the same column. Two consequences worth knowing: the footer line has no pin, because that column belongs to the gear; and the tooltip closes on any click, so after pinning you'll need to hover again to see the result.

When no other window is registered there is no last active project, so the footer falls back to `Open picker`.

## Configuring a project

Click the gear next to the project name at the top of the hover, or run `Switch Projects: Configure Current Project` from the Command Palette.

It asks which field to change — name, color, icon or order — and edits only that one. The icon step opens a filterable list of codicons; the color accepts a hex value or a theme color id.

## Upgrading

`clickAction` defaults to `picker`, so clicking the status bar item keeps doing what it always did. Nothing to configure after an update — the hover simply has more in it.

## Configuration

All settings are available under `switchProjects.*` in your `settings.json`.

### `switchProjects.clickAction`

What clicking the status bar item does — `"picker"` opens the full window picker, `"last"` jumps straight to the last used project. Switchable from the gear in the hover footer.

**Default:** `"picker"`

```json
"switchProjects.clickAction": "last"
```

### `switchProjects.projectSettings`

Per-project overrides, keyed by absolute project path. Every field is optional, and anything left out falls back to the derived value: the folder name, the global color, the default icon.

Easier to set through the gear in the hover than by hand, but the shape is plain JSON:

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

Icons used to mark projects in the picker. Each project's icon is picked by hashing its absolute path, so it never changes — not when other windows open or close, and not when you rename the project. Two projects can land on the same icon; the palette is a set of marks, not a set of identities.

**Default:**
```json
"switchProjects.palette": [
  "🔴","🟠","🟡","🟢","🔵","🟣","🟤","⚫","⚪",
  "🟥","🟧","🟨","🟩","🟦","🟪","🟫","⬛","⬜"
]
```

### `switchProjects.currentIcon`

Icon shown for the currently active project in the picker, instead of its palette icon.

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

Modified based on [antfu/vscode-where-am-i](https://github.com/antfu/vscode-where-am-i) — the per-project overrides and the hashed color idea follow the approach used there.

## License

MIT