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

// Override por projeto, tudo opcional: o que não estiver definido cai no
// comportamento derivado (nome da pasta, cor global, ícone padrão).
interface ProjectOverride {
  name?:   string
  color?:  string
  icon?:   string
  order?:  number
  pinned?: boolean
}

type ProjectSettings = Record<string, ProjectOverride>

type ClickAction = 'picker' | 'last'

// Entrada do registro já resolvida contra o override, pronta para exibição.
// `label` é o que aparece; `sort` é o que ordena — sem o sufixo da pasta real,
// senão o apelido perderia o efeito na ordenação.
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

// Com apelido definido o nome da pasta vira sufixo, para o projeto continuar
// reconhecível pelo diretório real.
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

// Ordem alfabética é a exibida por padrão: posição estável é o que permite
// decorar o lugar de cada projeto.
function compareByName(a: ProjectView, b: ProjectView): number {
  return a.sort.localeCompare(b.sort, undefined, { sensitivity: 'base' })
}

// Entre os pinados manda a ordem declarada; quem não declarou cai atrás, em
// ordem alfabética.
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

// `ts` é reescrito toda vez que a janela ganha foco, então a ordem decrescente
// é a ordem de uso real. O MRU só escolhe QUAIS projetos entram na lista; quem
// define a posição de cada um é o `compareByName`.
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

// O último ativo ignora o pin: ele aparece na própria seção mesmo já estando
// listado acima.
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

// Prioridade alta o bastante para o item ficar à esquerda do indicador de
// branch do git, que é o vizinho mais disputado desse canto da barra.
const STATUS_PRIORITY = 100000

const TRUSTED_COMMANDS = {
  enabledCommands: [
    'projectSwitcher.goto',
    'projectSwitcher.switch',
    'projectSwitcher.configureProject',
  ],
}

// Hex entra como cor literal; qualquer outro texto é tratado como id de cor do
// tema, o que deixa o item acompanhar a paleta em vez de fixar um tom.
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

function appendSection(md: vscode.MarkdownString, title: string, views: ProjectView[]): void {
  if (views.length === 0) {
    return
  }

  md.appendMarkdown(`**${title}**\n\n`)

  for (const view of views) {
    const args = encodeURIComponent(JSON.stringify([view.path]))
    md.appendMarkdown(`[$(${view.icon})  ${view.label}](command:projectSwitcher.goto?${args})\n\n`)
  }

  md.appendMarkdown('---\n\n')
}

// O rodapé é sempre o complemento do clique: se o clique abre o picker, aqui
// fica o último ativo; se o clique vai para o último, aqui fica o picker.
function buildTooltip(
  currentLabel: string,
  views:        ProjectView[],
  recentCount:  number,
  clickAction:  ClickAction,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString('', true)
  md.isTrusted = TRUSTED_COMMANDS

  md.appendMarkdown(`**${currentLabel}**  [$(gear)](command:projectSwitcher.configureProject)\n\n`)
  md.appendMarkdown('---\n\n')

  if (views.length === 0) {
    md.appendMarkdown('_Nenhuma outra janela aberta_')
    return md
  }

  appendSection(md, `Last ${recentCount} opened`, recentViews(views, recentCount))
  appendSection(md, 'Pinned', pinnedViews(views))

  if (clickAction === 'picker') {
    const last = lastView(views)

    if (last) {
      appendSection(md, 'Last Active', [last])
    }
  }

  md.appendMarkdown('[$(list-flat)  Todos os projetos…](command:projectSwitcher.switch)')

  return md
}

// Com `recentCount` em zero o item vira só o rótulo do projeto atual: sem
// tooltip e com o clique caindo no picker.
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

// Cada passo cancelado aborta a configuração inteira — nada é gravado pela
// metade.
async function configureProject(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]

  if (!folder) {
    vscode.window.showInformationMessage('Nenhum projeto aberto nesta janela.')
    return
  }

  const settings = getConfig().projectSettings
  const current  = settings[folder.uri.fsPath]

  const name = await vscode.window.showInputBox({
    value:  current?.name ?? folder.name,
    prompt: 'Nome exibido (vazio usa o nome da pasta)',
  })

  if (name === undefined) {
    return
  }

  const color = await vscode.window.showInputBox({
    value:  current?.color ?? '',
    prompt: 'Cor: hex (#FFD700) ou id de cor do tema (vazio usa a cor global)',
  })

  if (color === undefined) {
    return
  }

  const icon = await pickIcon(current?.icon ?? DEFAULT_ICON)

  if (icon === undefined) {
    return
  }

  const orderText = await vscode.window.showInputBox({
    value:  current?.order === undefined ? '' : String(current.order),
    prompt: 'Ordem entre os fixados (vazio deixa em ordem alfabética)',
  })

  if (orderText === undefined) {
    return
  }

  const pinnedPick = await vscode.window.showQuickPick(['Não', 'Sim'], {
    placeHolder: 'Fixar este projeto na seção Pinned?',
  })

  if (pinnedPick === undefined) {
    return
  }

  const order    = Number.parseInt(orderText.trim(), 10)
  const override: ProjectOverride = {}

  if (name.trim().length > 0) {
    override.name = name.trim()
  }

  if (color.trim().length > 0) {
    override.color = color.trim()
  }

  override.icon = icon

  if (!Number.isNaN(order)) {
    override.order = order
  }

  if (pinnedPick === 'Sim') {
    override.pinned = true
  }

  const next = { ...settings }
  next[folder.uri.fsPath] = override

  await saveProjectSettings(next)
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

  // Ganhar foco carimba o `ts` da própria janela e reordena o MRU — as outras
  // janelas ficam congeladas no momento em que o foco saiu delas. Sem lista de
  // recentes ninguém consome a ordem, então o carimbo é dispensado.
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
    vscode.commands.registerCommand('projectSwitcher.configureProject', configureProject)
  )

  // Sem outra janela registrada não há destino, então o clique cai no picker.
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
        vscode.window.showInformationMessage('Nenhum projeto registrado ainda.')
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