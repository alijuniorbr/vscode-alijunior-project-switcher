# VSCode Project Switcher

Switch between open VSCode windows in alphabetical order, with consistent colors per project.

## Features

- Lists all open VSCode windows sorted alphabetically
- Each project gets a consistent color based on its position in the list
- Current window highlighted with a customizable icon
- Option to pin the current project at the top or keep it in alphabetical order
- No extra permissions required

## Usage

Press `⌃⌘P` (macOS) or `Ctrl+Alt+P` (Windows/Linux) to open the window picker.

Or run `Switch Projects: Open Window Picker` from the Command Palette.

## Configuration

All settings are available under `switchProjects.*` in your `settings.json`.

### `switchProjects.palette`

List of icons assigned to projects by alphabetical position. The first project gets the first icon, the second gets the second, and so on. Wraps around if there are more projects than icons.

**Default:**
```json
"switchProjects.palette": [
  "🔴","🟠","🟡","🟢","🔵","🟣","🟤","⚫","⚪",
  "🟥","🟧","🟨","🟩","🟦","🟪","🟫","⬛","⬜"
]
```

### `switchProjects.currentIcon`

Icon shown for the currently active project instead of its palette color.

**Default:** `"➜"`

```json
"switchProjects.currentIcon": "▶"
```

### `switchProjects.pinCurrentFirst`

When `true`, the current project is always shown at the top of the list. When `false`, it stays in its natural alphabetical position.

**Default:** `true`

```json
"switchProjects.pinCurrentFirst": false
```

## How it works

Each VSCode window registers itself in `~/.vscode/project-switcher/project-list.json` on startup and removes itself on close. The picker reads this file and displays all registered windows.

## Requirements

- VSCode 1.75+
- macOS, Windows, or Linux

## License

MIT