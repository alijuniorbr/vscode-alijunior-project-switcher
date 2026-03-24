import * as vscode from 'vscode'
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceEntry {
  name: string
  path: string
  ts:   number
}

type Registry = Record<string, WorkspaceEntry>

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('switchProjects')
  return {
    palette:        cfg.get<string[]>('palette', DEFAULT_PALETTE),
    currentIcon:    cfg.get<string>('currentIcon', DEFAULT_CURRENT),
    pinCurrent:     cfg.get<boolean>('pinCurrentFirst', true),
  }
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

const DEFAULT_PALETTE = [
  '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫', '⚪',
  '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '🟫', '⬛', '⬜',
]

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

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0]

  if (folder) {
    registerSelf(folder.uri.fsPath, folder.name)
    context.subscriptions.push(
      new vscode.Disposable(() => unregisterSelf(folder.uri.fsPath))
    )
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('projectSwitcher.switch', async () => {
      const { palette, currentIcon, pinCurrent } = getConfig()
      const currentPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''

      const entries = Object.values(readRegistry())
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

      if (!entries.length) {
        vscode.window.showInformationMessage('Nenhum projeto registrado ainda.')
        return
      }

      const allItems = entries.map((entry, i) => {
        const isCurrent = entry.path === currentPath
        return {
          label:       `${isCurrent ? currentIcon : palette[i % palette.length]}  ${entry.name}`,
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