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

type ConfigField = 'name' | 'color' | 'icon' | 'order'

// A registry entry already resolved against its override, ready to render.
// `label` is what shows up; `sort` is what orders — without the folder suffix,
// otherwise the display name would lose its effect on ordering.
interface ProjectView {
  path:   string
  label:  string
  sort:   string
  icon:   string
  order?: number
  pinned: boolean
  ts:     number
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
    projectSettings: cfg.get<ProjectSettings>('projectSettings', {}),
  }
}

function resolveClickAction(value: string): ClickAction {
  return value === 'last' ? 'last' : 'picker'
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

const DEFAULT_ICON = 'folder-opened'

const DEFAULT_PALETTE = [
  '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫', '⚪',
  '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '🟫', '⬛', '⬜',
]

// ─── Views ────────────────────────────────────────────────────────────────────

// With a display name set, the folder name becomes a suffix so the project
// stays recognizable by its real directory.
function describe(entry: WorkspaceEntry, settings: ProjectSettings): ProjectView {
  const override = settings[entry.path]
  const alias    = override?.name?.trim()
  const icon     = override?.icon?.trim()

  return {
    path:   entry.path,
    label:  alias ? `${alias} (${entry.name})` : entry.name,
    sort:   alias ? alias : entry.name,
    icon:   icon ? icon : DEFAULT_ICON,
    order:  override?.order,
    pinned: override?.pinned === true,
    ts:     entry.ts,
  }
}

function describeAll(currentPath: string, settings: ProjectSettings): ProjectView[] {
  return Object.values(readRegistry())
    .filter(entry => entry.path !== currentPath)
    .map(entry => describe(entry, settings))
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
function recentViews(views: ProjectView[], limit: number): ProjectView[] {
  return views
    .filter(view => !view.pinned)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)
    .sort(compareByName)
}

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
    'projectSwitcher.quickConfig',
  ],
}

const GEAR_LINK = '[$(gear)](command:projectSwitcher.quickConfig)  '

const PICKER_LINK = '[$(list-flat)  Open picker](command:projectSwitcher.switch)'

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

function projectLink(view: ProjectView): string {
  const args = encodeURIComponent(JSON.stringify([view.path]))
  return `[$(${view.icon})  ${view.label}](command:projectSwitcher.goto?${args})`
}

// The action icon opens each line so the click targets stack in the same
// column — without CSS there is no right alignment available in a tooltip.
function appendItem(md: vscode.MarkdownString, view: ProjectView): void {
  const args   = encodeURIComponent(JSON.stringify([view.path]))
  const toggle = view.pinned ? 'projectSwitcher.unpin' : 'projectSwitcher.pin'
  const badge  = view.pinned ? 'pinned' : 'pin'

  md.appendMarkdown(`[$(${badge})](command:${toggle}?${args})  ${projectLink(view)}\n\n`)
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
  const last = clickAction === 'picker' ? lastView(views) : undefined

  if (!last) {
    md.appendMarkdown(`${GEAR_LINK}${PICKER_LINK}`)
    return
  }

  md.appendMarkdown('**Last active**\n\n')
  md.appendMarkdown(`${GEAR_LINK}${projectLink(last)}`)
}

// The picker shows up once: at the top when the click already opens it, in the
// footer when the click goes to the last project.
function buildTooltip(
  currentLabel: string,
  views:        ProjectView[],
  recentCount:  number,
  clickAction:  ClickAction,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString('', true)
  md.isTrusted = TRUSTED_COMMANDS

  md.appendMarkdown(`**${currentLabel}**  [$(gear)](command:projectSwitcher.configureProject)\n\n`)

  if (clickAction === 'picker') {
    md.appendMarkdown(`${PICKER_LINK}\n\n`)
  }

  md.appendMarkdown('---\n\n')

  if (views.length === 0) {
    md.appendMarkdown('_No other window open_\n\n')
    md.appendMarkdown('---\n\n')
  } else {
    appendSection(md, `Last ${recentCount} opened`, recentViews(views, recentCount))
    appendSection(md, 'Pinned', pinnedViews(views))
  }

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

  item.tooltip = buildTooltip(currentLabel, views, recentCount, clickAction)
  item.command = clickAction === 'last' ? 'projectSwitcher.gotoLast' : 'projectSwitcher.switch'
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

// Direct choice of the click action, with the current one marked.
async function quickConfig(): Promise<void> {
  const { clickAction } = getConfig()

  const items = [
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

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Status bar click action',
  })

  if (!pick || pick.action === clickAction) {
    return
  }

  await saveClickAction(pick.action)
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
  // list nobody consumes that order, so the stamp is skipped.
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(state => {
      if (!state.focused) {
        return
      }

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
    vscode.commands.registerCommand('projectSwitcher.quickConfig', quickConfig)
  )

  // With no other window registered there is no destination, so the click falls
  // back to the picker.
  context.subscriptions.push(
    vscode.commands.registerCommand('projectSwitcher.gotoLast', async (): Promise<void> => {
      const currentPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
      const last        = lastView(describeAll(currentPath, getConfig().projectSettings))

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
        .map(entry => describe(entry, projectSettings))
        .sort(compareByName)

      if (!entries.length) {
        vscode.window.showInformationMessage('No projects registered yet.')
        return
      }

      const allItems = entries.map((entry, i) => {
        const isCurrent = entry.path === currentPath
        return {
          label:       `${isCurrent ? currentIcon : palette[i % palette.length]}  ${entry.label}`,
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