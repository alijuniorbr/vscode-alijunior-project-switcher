import * as vscode from 'vscode'
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import ICONS from './icons'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceEntry {
  name: string
  path: string
  ts:   number
}

type Registry = Record<string, WorkspaceEntry>

// Per-project override, every field optional: whatever is missing falls back to
// the derived value (folder name, global color, default icon).
interface ProjectOverride {
  name?:   string
  color?:  string
  icon?:   string
  order?:  number
  pinned?: boolean
}

type ProjectSettings = Record<string, ProjectOverride>

type ClickAction = 'picker' | 'last'

// What a click does when it lands on a window that was not focused: repeat the
// click action, open the picker, or nothing at all — leaving the mouse parked
// over the item, which is what makes the hover open on its own.
type ColdClickAction = 'same' | 'picker' | 'none'

type ConfigField = 'name' | 'color' | 'icon' | 'order'

// A registry entry already resolved against its override, ready to render.
// `label` is what shows up; `sort` is what orders — without the folder suffix,
// otherwise the display name would lose its effect on ordering.
interface ProjectView {
  path:    string
  label:   string
  sort:    string
  icon:    string
  color?:  string
  order?:  number
  pinned:  boolean
  current: boolean
  ts:      number
}

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('switchProjects')
  return {
    palette:         cfg.get<string[]>('palette', DEFAULT_PALETTE),
    currentIcon:     cfg.get<string>('currentIcon', DEFAULT_CURRENT),
    pinCurrent:      cfg.get<boolean>('pinCurrentFirst', true),
    recentCount:     cfg.get<number>('recentCount', DEFAULT_RECENT_COUNT),
    statusBarColor:  cfg.get<string>('statusBarColor', DEFAULT_STATUS_COLOR),
    clickAction:     resolveClickAction(cfg.get<string>('clickAction', DEFAULT_CLICK_ACTION)),
    coldClickAction: resolveColdClickAction(cfg.get<string>('coldClickAction', DEFAULT_COLD_CLICK_ACTION)),
    projectSettings: cfg.get<ProjectSettings>('projectSettings', {}),
  }
}

function resolveClickAction(value: string): ClickAction {
  return value === 'last' ? 'last' : 'picker'
}

function resolveColdClickAction(value: string): ColdClickAction {
  if (value === 'picker') {
    return 'picker'
  }

  if (value === 'none') {
    return 'none'
  }

  return 'same'
}

function saveProjectSettings(settings: ProjectSettings): Thenable<void> {
  return vscode.workspace
    .getConfiguration('switchProjects')
    .update('projectSettings', settings, vscode.ConfigurationTarget.Global)
}

function saveClickAction(action: ClickAction): Thenable<void> {
  return vscode.workspace
    .getConfiguration('switchProjects')
    .update('clickAction', action, vscode.ConfigurationTarget.Global)
}

function saveColdClickAction(action: ColdClickAction): Thenable<void> {
  return vscode.workspace
    .getConfiguration('switchProjects')
    .update('coldClickAction', action, vscode.ConfigurationTarget.Global)
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const REGISTRY_DIR  = path.join(os.homedir(), '.vscode', 'project-switcher')
const REGISTRY_FILE = path.join(REGISTRY_DIR, 'project-list.json')

function readRegistry(): Registry {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8')) as Registry
  } catch {
    return {}
  }
}

function writeRegistry(data: Registry): void {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true })
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2), 'utf8')
}

function registerSelf(workspacePath: string, workspaceName: string): void {
  const reg = readRegistry()
  reg[workspacePath] = { name: workspaceName, path: workspacePath, ts: Date.now() }
  writeRegistry(reg)
}

function unregisterSelf(workspacePath: string): void {
  const reg = readRegistry()
  delete reg[workspacePath]
  writeRegistry(reg)
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CURRENT = '➜'

const DEFAULT_RECENT_COUNT = 3

const DEFAULT_STATUS_COLOR = '#FFD700'

const DEFAULT_CLICK_ACTION = 'picker'

const DEFAULT_COLD_CLICK_ACTION = 'same'

const DEFAULT_ICON = 'folder-opened'

const DEFAULT_PALETTE = [
  '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫', '⚪',
  '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '🟫', '⬛', '⬜',
]

// ─── Views ────────────────────────────────────────────────────────────────────

// With a display name set, the folder name becomes a suffix so the project
// stays recognizable by its real directory.
function describe(entry: WorkspaceEntry, settings: ProjectSettings, currentPath: string): ProjectView {
  const override = settings[entry.path]
  const alias    = override?.name?.trim()
  const icon     = override?.icon?.trim()
  const color    = override?.color?.trim()

  return {
    path:    entry.path,
    label:   alias ? `${alias} (${entry.name})` : entry.name,
    sort:    alias ? alias : entry.name,
    icon:    icon ? icon : DEFAULT_ICON,
    color:   color && color.length > 0 ? color : undefined,
    order:   override?.order,
    pinned:  override?.pinned === true,
    current: entry.path === currentPath,
    ts:      entry.ts,
  }
}

// The current project is part of the list: it keeps its alphabetical position
// like everyone else. Whoever must not see it filters it out with `otherViews`.
function describeAll(currentPath: string, settings: ProjectSettings): ProjectView[] {
  return Object.values(readRegistry())
    .map(entry => describe(entry, settings, currentPath))
}

function otherViews(views: ProjectView[]): ProjectView[] {
  return views.filter(view => !view.current)
}

// ─── Ordering ─────────────────────────────────────────────────────────────────

// Alphabetical is the only order ever displayed: a stable position is what lets
// you memorize where each project sits.
function compareByName(a: ProjectView, b: ProjectView): number {
  return a.sort.localeCompare(b.sort, undefined, { sensitivity: 'base' })
}

// Among pinned projects the declared order wins; whoever declared none falls
// behind, alphabetically.
function comparePinned(a: ProjectView, b: ProjectView): number {
  if (a.order !== undefined && b.order !== undefined) {
    return a.order - b.order
  }

  if (a.order !== undefined) {
    return -1
  }

  if (b.order !== undefined) {
    return 1
  }

  return compareByName(a, b)
}

// `ts` is rewritten every time a window gains focus, so descending order is
// real usage order. Recency only picks WHICH projects make the list; what
// decides each one's position is `compareByName`.
//
// The current project is left out of that selection — it is always the most
// recent one and would eat a slot — and comes back in as an extra line, so the
// section holds `limit` other projects plus this one.
function recentViews(views: ProjectView[], limit: number): ProjectView[] {
  const others = views
    .filter(view => !view.pinned && !view.current)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)

  const current = views.find(view => view.current && !view.pinned)

  return (current ? [...others, current] : others).sort(compareByName)
}

// A pinned current project shows up here instead, by its declared order.
function pinnedViews(views: ProjectView[]): ProjectView[] {
  return views
    .filter(view => view.pinned)
    .sort(comparePinned)
}

// The last active project ignores pinning: it shows up in the footer even when
// already listed above.
function lastView(views: ProjectView[]): ProjectView | undefined {
  const [last] = [...views].sort((a, b) => b.ts - a.ts)
  return last
}

// ─── Palette ──────────────────────────────────────────────────────────────────

// Hashing the absolute path is what keeps a project's mark still: it doesn't
// move when other windows open or close, and it survives a rename. Two projects
// can land on the same mark — the palette is a set of marks, not of identities.
function paletteMark(wsPath: string, palette: string[]): string {
  if (palette.length === 0) {
    return ''
  }

  let hash = 2166136261

  for (let i = 0; i < wsPath.length; i += 1) {
    hash ^= wsPath.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  return palette[Math.abs(hash) % palette.length]
}

// ─── Focus window (cross-platform) ───────────────────────────────────────────

function focusWindow(workspacePath: string): void {
  const platform = process.platform

  let cmd: string
  let args: string[]

  if (platform === 'darwin') {
    cmd  = 'open'
    args = ['-a', 'Visual Studio Code', workspacePath]
  } else if (platform === 'win32') {
    cmd  = 'cmd'
    args = ['/c', 'start', '', 'code', workspacePath]
  } else {
    cmd  = 'code'
    args = ['--reuse-window', workspacePath]
  }

  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
}

// ─── Cold click ───────────────────────────────────────────────────────────────

// The window is already focused by the time the command runs — the click itself
// brought it to the front — so `window.state.focused` is useless here. What is
// left is timing: a click that lands right after focus arrived is a click that
// came from another window.
const COLD_CLICK_WINDOW_MS = 250

let lastFocusAt = 0

function stampFocus(): void {
  lastFocusAt = Date.now()
}

function isColdClick(): boolean {
  return Date.now() - lastFocusAt < COLD_CLICK_WINDOW_MS
}

// ─── Status bar ──────────────────────────────────────────────────────────────

// High enough for the item to sit left of the git branch indicator, the most
// contested neighbour in that corner of the bar.
const STATUS_PRIORITY = 100000

const TRUSTED_COMMANDS = {
  enabledCommands: [
    'projectSwitcher.goto',
    'projectSwitcher.switch',
    'projectSwitcher.pin',
    'projectSwitcher.unpin',
    'projectSwitcher.configureProject',
    'projectSwitcher.openSettings',
    'projectSwitcher.quickConfig',
  ],
}

const GEAR_LINK = '[$(gear)](command:projectSwitcher.quickConfig)  '

const PICKER_LINK = '[$(list-flat)  Open picker](command:projectSwitcher.switch)'

const SETTINGS_LINK = '[$(gear)  Current settings](command:projectSwitcher.configureProject)'

const CONFIG_FILE_LINK = '[$(json)  Open config file](command:projectSwitcher.openSettings)'

// Marks the current project's line, in place of its folder icon.
const CURRENT_MARK = 'circle-filled'

// The tooltip renderer sanitizes the HTML it is given, and whether the `style`
// attribute survives is not guaranteed across versions. When it is dropped the
// label still renders, only uncolored. Set to false to skip the span entirely.
const COLOR_CURRENT = true

// A hex value is used literally; anything else is treated as a theme color id,
// which lets the item follow the palette instead of pinning one tone.
function resolveColor(value: string): string | vscode.ThemeColor | undefined {
  const trimmed = value.trim()

  if (trimmed.length === 0) {
    return undefined
  }

  if (trimmed.startsWith('#')) {
    return trimmed
  }

  return new vscode.ThemeColor(trimmed)
}

// Only a hex value can be inlined as CSS: a theme color id means nothing to the
// tooltip, which has no access to the theme's palette.
function paint(text: string, color: string | undefined): string {
  if (!COLOR_CURRENT || color === undefined || !color.startsWith('#')) {
    return text
  }

  return `<span style="color:${color};">${text}</span>`
}

function projectLink(view: ProjectView): string {
  const args = encodeURIComponent(JSON.stringify([view.path]))
  return `[$(${view.icon})  ${view.label}](command:projectSwitcher.goto?${args})`
}

// The current project is not a link: clicking it would ask for focus on the
// window it is already in. Dropping the link also drops the link color, which
// is what tells the line apart from the ones around it.
function currentEntry(view: ProjectView): string {
  return `$(${CURRENT_MARK})  **${paint(view.label, view.color)}**`
}

// The action icon opens each line so the click targets stack in the same
// column — without CSS there is no right alignment available in a tooltip.
function appendItem(md: vscode.MarkdownString, view: ProjectView): void {
  const args   = encodeURIComponent(JSON.stringify([view.path]))
  const toggle = view.pinned ? 'projectSwitcher.unpin' : 'projectSwitcher.pin'
  const badge  = view.pinned ? 'pinned' : 'pin'
  const entry  = view.current ? currentEntry(view) : projectLink(view)

  md.appendMarkdown(`[$(${badge})](command:${toggle}?${args})  ${entry}\n\n`)
}

function appendSection(md: vscode.MarkdownString, title: string, views: ProjectView[]): void {
  if (views.length === 0) {
    return
  }

  md.appendMarkdown(`**${title}**\n\n`)

  for (const view of views) {
    appendItem(md, view)
  }

  md.appendMarkdown('---\n\n')
}

// Last line of the tooltip, the closest one to the mouse: it always carries
// whatever the click doesn't do. The gear takes the left column, where the pin
// sits on the lines above.
function appendFooter(
  md:          vscode.MarkdownString,
  views:       ProjectView[],
  clickAction: ClickAction,
): void {
  const last = clickAction === 'picker' ? lastView(otherViews(views)) : undefined

  if (!last) {
    md.appendMarkdown(`${GEAR_LINK}${PICKER_LINK}`)
    return
  }

  md.appendMarkdown('**Last active**\n\n')
  md.appendMarkdown(`${GEAR_LINK}${projectLink(last)}`)
}

// The header is about this window's configuration, not about its name — the
// name is right below the tooltip, on the status bar item itself, and again in
// the list at its alphabetical position. The picker shows up once: here when
// the click already opens it, in the footer when the click goes to the last
// project.
function buildTooltip(
  views:       ProjectView[],
  recentCount: number,
  clickAction: ClickAction,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString('', true)
  md.isTrusted   = TRUSTED_COMMANDS
  md.supportHtml = true

  md.appendMarkdown(`${SETTINGS_LINK}\n\n`)
  md.appendMarkdown(`${CONFIG_FILE_LINK}\n\n`)

  if (clickAction === 'picker') {
    md.appendMarkdown(`${PICKER_LINK}\n\n`)
  }

  md.appendMarkdown('---\n\n')

  if (otherViews(views).length === 0) {
    md.appendMarkdown('_No other window open_\n\n')
  }

  appendSection(md, `Last ${recentCount} opened`, recentViews(views, recentCount))
  appendSection(md, 'Pinned', pinnedViews(views))

  appendFooter(md, views, clickAction)

  return md
}

// With `recentCount` at zero the item becomes just the current project label:
// no tooltip, and the click falling back to the picker.
function refreshStatusBar(item: vscode.StatusBarItem): void {
  const { recentCount, statusBarColor, clickAction, projectSettings } = getConfig()

  const folder      = vscode.workspace.workspaceFolders?.[0]
  const currentPath = folder?.uri.fsPath ?? ''
  const override    = projectSettings[currentPath]
  const alias       = override?.name?.trim()
  const icon        = override?.icon?.trim()
  const color       = override?.color?.trim()

  const currentLabel = alias ? alias : (folder?.name ?? 'Switch Projects')

  item.text  = `$(${icon ? icon : DEFAULT_ICON})  ${currentLabel}`
  item.color = resolveColor(color ? color : statusBarColor)

  if (recentCount <= 0) {
    item.tooltip = undefined
    item.command = 'projectSwitcher.switch'
    item.show()
    return
  }

  const views = describeAll(currentPath, projectSettings)

  item.tooltip = buildTooltip(views, recentCount, clickAction)
  item.command = 'projectSwitcher.statusClick'
  item.show()
}

// ─── Pin ──────────────────────────────────────────────────────────────────────

// Unpinning keeps the record with `pinned: false`: name, color, icon and order
// stay in place and apply again if the project is pinned later.
function setPinned(wsPath: string, pinned: boolean): Thenable<void> {
  const settings = getConfig().projectSettings
  const next     = { ...settings }

  next[wsPath] = { ...settings[wsPath], pinned }

  return saveProjectSettings(next)
}

// ─── Project configuration ───────────────────────────────────────────────────

async function pickIcon(current: string): Promise<string | undefined> {
  const items = ICONS.map(name => ({
    label:       `$(${name})`,
    description: name,
  }))

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder:        current,
    matchOnDescription: true,
  })

  return pick?.description
}

async function pickField(current: ProjectOverride | undefined): Promise<ConfigField | undefined> {
  const items = [
    { label: 'Name',  description: current?.name ?? '', field: 'name' as ConfigField },
    { label: 'Color', description: current?.color ?? '', field: 'color' as ConfigField },
    { label: 'Icon',  description: current?.icon ?? DEFAULT_ICON, field: 'icon' as ConfigField },
    {
      label:       'Order',
      description: current?.order === undefined ? '' : String(current.order),
      field:       'order' as ConfigField,
    },
  ]

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'What to configure for this project?',
  })

  return pick?.field
}

// Each field is edited on its own: nothing but the chosen one is touched, and
// cancelling at any point writes nothing.
async function configureProject(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]

  if (!folder) {
    vscode.window.showInformationMessage('No project open in this window.')
    return
  }

  const settings = getConfig().projectSettings
  const current  = settings[folder.uri.fsPath]
  const field    = await pickField(current)

  if (field === undefined) {
    return
  }

  const override: ProjectOverride = { ...current }

  switch (field) {
    case 'name': {
      const name = await vscode.window.showInputBox({
        value:  current?.name ?? folder.name,
        prompt: 'Display name (empty uses the folder name)',
      })

      if (name === undefined) {
        return
      }

      if (name.trim().length > 0) {
        override.name = name.trim()
      } else {
        delete override.name
      }

      break
    }

    case 'color': {
      const color = await vscode.window.showInputBox({
        value:  current?.color ?? '',
        prompt: 'Color: hex (#FFD700) or theme color id (empty uses the global color)',
      })

      if (color === undefined) {
        return
      }

      if (color.trim().length > 0) {
        override.color = color.trim()
      } else {
        delete override.color
      }

      break
    }

    case 'icon': {
      const icon = await pickIcon(current?.icon ?? DEFAULT_ICON)

      if (icon === undefined) {
        return
      }

      override.icon = icon

      break
    }

    case 'order': {
      const orderText = await vscode.window.showInputBox({
        value:  current?.order === undefined ? '' : String(current.order),
        prompt: 'Order among pinned projects (empty keeps it alphabetical)',
      })

      if (orderText === undefined) {
        return
      }

      const order = Number.parseInt(orderText.trim(), 10)

      if (Number.isNaN(order)) {
        delete override.order
      } else {
        override.order = order
      }

      break
    }
  }

  const next = { ...settings }
  next[folder.uri.fsPath] = override

  await saveProjectSettings(next)
}

// Opens the file where every project override lives, cursor inside the block
// when the running version honours `revealSetting` — and at the top of the
// file when it doesn't.
async function openSettingsFile(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettingsJson', {
    revealSetting: { key: 'switchProjects.projectSettings', edit: true },
  })
}

// Two steps: the click action first, saved on its own, then what a click on an
// unfocused window does. Cancelling the second step keeps the first.
async function quickConfig(): Promise<void> {
  const { clickAction, coldClickAction } = getConfig()

  const clickItems = [
    {
      label:       '$(arrow-right)  Last',
      description: clickAction === 'last' ? '✓ current' : 'go straight to the last project',
      action:      'last' as ClickAction,
    },
    {
      label:       '$(list-flat)  Picker',
      description: clickAction === 'picker' ? '✓ current' : 'open the project list',
      action:      'picker' as ClickAction,
    },
  ]

  const clickPick = await vscode.window.showQuickPick(clickItems, {
    placeHolder: 'Status bar click action',
  })

  if (!clickPick) {
    return
  }

  if (clickPick.action !== clickAction) {
    await saveClickAction(clickPick.action)
  }

  const coldItems = [
    {
      label:       '$(arrow-right)  Same',
      description: coldClickAction === 'same' ? '✓ current' : 'no difference, the click always acts',
      action:      'same' as ColdClickAction,
    },
    {
      label:       '$(list-flat)  Picker',
      description: coldClickAction === 'picker' ? '✓ current' : 'open the project list instead',
      action:      'picker' as ColdClickAction,
    },
    {
      label:       '$(circle-slash)  None',
      description: coldClickAction === 'none' ? '✓ current' : 'do nothing and let the hover open',
      action:      'none' as ColdClickAction,
    },
  ]

  const coldPick = await vscode.window.showQuickPick(coldItems, {
    placeHolder: 'Click on an unfocused window — only used when the click action is Last',
  })

  if (!coldPick || coldPick.action === coldClickAction) {
    return
  }

  await saveColdClickAction(coldPick.action)
}

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0]

  if (folder) {
    registerSelf(folder.uri.fsPath, folder.name)
    context.subscriptions.push(
      new vscode.Disposable(() => unregisterSelf(folder.uri.fsPath))
    )
  }

  const statusItem = vscode.window.createStatusBarItem(
    'projectSwitcher.status',
    vscode.StatusBarAlignment.Left,
    STATUS_PRIORITY,
  )

  statusItem.name = 'Switch Projects'
  context.subscriptions.push(statusItem)

  refreshStatusBar(statusItem)

  // Gaining focus stamps this window's own `ts` and reorders recency — the
  // other windows stay frozen at the moment focus left them. With no recent
  // list nobody consumes that order, so the stamp is skipped. The cold click
  // timestamp is kept either way: it costs nothing and doesn't touch the disk.
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(state => {
      if (!state.focused) {
        return
      }

      stampFocus()

      const { recentCount } = getConfig()

      if (folder && recentCount > 0) {
        registerSelf(folder.uri.fsPath, folder.name)
      }

      refreshStatusBar(statusItem)
    })
  )

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('switchProjects')) {
        refreshStatusBar(statusItem)
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('projectSwitcher.goto', (wsPath: string): void => {
      focusWindow(wsPath)
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('projectSwitcher.pin', (wsPath: string): Thenable<void> => {
      return setPinned(wsPath, true)
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('projectSwitcher.unpin', (wsPath: string): Thenable<void> => {
      return setPinned(wsPath, false)
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('projectSwitcher.configureProject', configureProject)
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('projectSwitcher.openSettings', openSettingsFile)
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('projectSwitcher.quickConfig', quickConfig)
  )

  // Only the status bar item goes through here, so the cold click rule never
  // reaches the keybindings: pressing the shortcut always does what it says.
  context.subscriptions.push(
    vscode.commands.registerCommand('projectSwitcher.statusClick', async (): Promise<void> => {
      const { clickAction, coldClickAction } = getConfig()

      if (clickAction === 'last' && coldClickAction !== 'same' && isColdClick()) {
        if (coldClickAction === 'none') {
          return
        }

        await vscode.commands.executeCommand('projectSwitcher.switch')
        return
      }

      if (clickAction === 'last') {
        await vscode.commands.executeCommand('projectSwitcher.gotoLast')
        return
      }

      await vscode.commands.executeCommand('projectSwitcher.switch')
    })
  )

  // With no other window registered there is no destination, so the click falls
  // back to the picker.
  context.subscriptions.push(
    vscode.commands.registerCommand('projectSwitcher.gotoLast', async (): Promise<void> => {
      const currentPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
      const last        = lastView(otherViews(describeAll(currentPath, getConfig().projectSettings)))

      if (!last) {
        await vscode.commands.executeCommand('projectSwitcher.switch')
        return
      }

      focusWindow(last.path)
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('projectSwitcher.switch', async () => {
      const { palette, currentIcon, pinCurrent, projectSettings } = getConfig()
      const currentPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''

      const entries = Object.values(readRegistry())
        .map(entry => describe(entry, projectSettings, currentPath))
        .sort(compareByName)

      if (!entries.length) {
        vscode.window.showInformationMessage('No projects registered yet.')
        return
      }

      const allItems = entries.map(entry => {
        const isCurrent = entry.current
        return {
          label:       `${isCurrent ? currentIcon : paletteMark(entry.path, palette)}  ${entry.label}`,
          description: isCurrent ? '← current' : undefined,
          detail:      entry.path,
          isCurrent,
          wsPath:      entry.path,
        }
      })

      const sorted = pinCurrent
        ? [...allItems.filter(x => x.isCurrent), ...allItems.filter(x => !x.isCurrent)]
        : allItems

      const pick = await vscode.window.showQuickPick(sorted, {
        title:       '  Switch Projects',
        placeHolder: 'Filter by project…',
      })

      if (!pick || pick.isCurrent) return

      focusWindow(pick.wsPath)
    })
  )
}

export function deactivate(): void {}