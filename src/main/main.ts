// Electron main process: a floating, transparent, always-on-top office window plus a menu-bar tray.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp, type App } from '../core/app.js';
import { loadOrCreateConfig } from '../shared/config.js';
import { loadWindowState, saveWindowState, type WindowState } from './windowState.js';

const here = fileURLToPath(new URL('.', import.meta.url)); // dist/main/
const root = join(here, '..', '..');
const dataDir = process.env.AGENT_OFFICE_DIR || join(homedir(), '.agent-office');
const stateFile = join(dataDir, 'window.json');
const COMPACT = { width: 720, height: 90 };

let office: App | undefined;
let token = '';
let win: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let state: WindowState = loadWindowState(stateFile);
/** the expanded size, restored when leaving compact mode */
let fullSize = { width: state.width, height: state.height };
if (state.compact) fullSize = { width: 720, height: 420 };

const log = (...a: unknown[]) => {
  if (process.env.AGENT_OFFICE_DEBUG) console.log('[agent-office]', ...a);
};

function persist(): void {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  state = { ...state, x: b.x, y: b.y, width: state.compact ? fullSize.width : b.width, height: state.compact ? fullSize.height : b.height };
  try {
    saveWindowState(stateFile, state);
  } catch (e) {
    log('could not save window state', e);
  }
}

function sceneUrl(zoom?: string): string {
  const q = new URLSearchParams({ token, shell: 'electron' });
  if (state.compact) q.set('compact', '1');
  if (zoom) q.set('zoom', zoom);
  return `${office!.url.replace(/\/+$/, '')}/?${q}`;
}

function visibleOnSomeDisplay(x: number, y: number, w: number, h: number): boolean {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return x + w > a.x + 40 && x < a.x + a.width - 40 && y >= a.y - 10 && y < a.y + a.height - 40 && h > 0;
  });
}

function createWindow(): void {
  const size = state.compact ? COMPACT : { width: state.width, height: state.height };
  const placed = state.x !== undefined && state.y !== undefined && visibleOnSomeDisplay(state.x, state.y, size.width, size.height);
  win = new BrowserWindow({
    ...size,
    ...(placed ? { x: state.x, y: state.y } : {}),
    minWidth: 360,
    minHeight: 90,
    frame: false,
    transparent: true,
    alwaysOnTop: state.alwaysOnTop,
    resizable: true,
    hasShadow: false,
    show: false,
    skipTaskbar: true,
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setOpacity(state.opacity);
  if (state.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');
  win.webContents.on('did-finish-load', () => log('did-finish-load', win?.webContents.getURL().replace(token, '<token>')));
  win.webContents.on('did-fail-load', (_e, code, desc) => log('did-fail-load', code, desc));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(office!.url)) e.preventDefault();
  });
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
    refreshMenu();
  });
  win.on('moved', () => (log('moved', win?.getBounds()), persist()));
  win.on('resized', () => (log('resized', win?.getBounds()), persist()));
  win.on('show', refreshMenu);
  win.on('hide', refreshMenu);
  win.once('ready-to-show', () => (log('ready', win?.getBounds()), win?.show()));
  void win.loadURL(sceneUrl());
  // debug aid: AGENT_OFFICE_SHOT=<file.png> saves a screenshot of the page 6 s after load
  if (process.env.AGENT_OFFICE_SHOT) {
    const file = process.env.AGENT_OFFICE_SHOT;
    win.webContents.once('did-finish-load', () => setTimeout(() => void win?.webContents.capturePage().then((img) => writeFileSync(file, img.toPNG())), 6000));
  }
}

function showWindow(): void {
  if (!win || win.isDestroyed()) return createWindow();
  win.show();
  win.focus();
}

function setCompact(on: boolean, zoom?: string): void {
  if (!win || win.isDestroyed()) return;
  if (on === state.compact && !zoom) return;
  if (on && !state.compact) {
    const b = win.getBounds();
    fullSize = { width: b.width, height: b.height };
  }
  state.compact = on;
  const b = win.getBounds();
  const size = on ? COMPACT : fullSize;
  win.setMinimumSize(360, on ? 90 : 200);
  win.setBounds({ x: b.x, y: b.y, ...size });
  void win.loadURL(sceneUrl(zoom));
  persist();
  refreshMenu();
}

function setOpacity(o: number): void {
  state.opacity = o;
  win?.setOpacity(o);
  persist();
  refreshMenu();
}

function setOnTop(on: boolean): void {
  state.alwaysOnTop = on;
  win?.setAlwaysOnTop(on, on ? 'floating' : 'normal');
  persist();
  refreshMenu();
}

function agentsWorking(): number {
  if (!office) return 0;
  let n = 0;
  for (const s of Object.values(office.store.snapshot().sessions)) {
    if (s.status === 'ended') continue;
    if (s.boss.status === 'working' || s.boss.status === 'delegating') n++;
    for (const a of Object.values(s.agents)) if (a.status === 'working' || a.status === 'spawning' || a.status === 'handing_off') n++;
  }
  return n;
}

function refreshMenu(): void {
  if (!tray) return;
  const visible = !!win && !win.isDestroyed() && win.isVisible();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: visible ? 'Hide' : 'Show', click: () => (visible ? win?.hide() : showWindow()) },
      {
        label: 'Opacity',
        submenu: [0.3, 0.5, 0.75, 1].map((o) => ({ label: `${Math.round(o * 100)}%`, type: 'radio' as const, checked: Math.abs(state.opacity - o) < 0.01, click: () => setOpacity(o) })),
      },
      { label: 'Compact strip', type: 'checkbox', checked: state.compact, click: (m) => setCompact(m.checked) },
      { label: 'Always on top', type: 'checkbox', checked: state.alwaysOnTop, click: (m) => setOnTop(m.checked) },
      { label: 'Launch at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (m) => app.setLoginItemSettings({ openAtLogin: m.checked }) },
      { type: 'separator' },
      { label: 'Quit Agent Office', click: () => app.quit() },
    ]),
  );
}

function updateTooltip(): void {
  const n = agentsWorking();
  tray?.setToolTip(`Agent Office — ${n} agent${n === 1 ? '' : 's'} working`);
}

function createTray(): void {
  const img = nativeImage.createFromPath(join(root, 'assets', 'trayTemplate.png'));
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setTitle('');
  tray.on('click', () => (win?.isVisible() ? win.hide() : showWindow()));
  refreshMenu();
  updateTooltip();
  setInterval(updateTooltip, 2000).unref();
  log('tray created');
}

function showError(message: string): void {
  const w = new BrowserWindow({ width: 440, height: 170, resizable: false, title: 'Agent Office', webPreferences: { sandbox: true, contextIsolation: true } });
  const esc = message.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  const page = `<body style="font:14px system-ui;padding:20px"><h3 style="margin-top:0">Agent Office could not start</h3><p>${esc}</p><p style="color:#666">Another copy may already be running, or another program is using this port. Change the port in ${dataDir}/config.json if needed.</p></body>`;
  void w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  w.on('closed', () => app.quit());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => app.quit());
  app.on('second-instance', () => showWindow());
  ipcMain.on('ao:expand-room', (e, id: unknown) => {
    if (e.sender === win?.webContents && typeof id === 'string') setCompact(false, id);
  });
  ipcMain.on('ao:hide', (e) => {
    if (e.sender === win?.webContents) win?.hide();
  });
  app.on('window-all-closed', () => {
    // stay alive in the tray (the error window quits itself)
  });
  app.on('before-quit', () => {
    persist();
    quitting = true;
  });
  let closing = false;
  app.on('will-quit', (e) => {
    if (closing || !office) return;
    e.preventDefault();
    closing = true;
    office.close().catch(() => {}).finally(() => app.exit(0));
  });

  void app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock?.hide();
    try {
      office = await startApp({ configDir: dataDir, staticDir: join(root, 'dist', 'scene') });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log('startApp failed', msg);
      showError(/EADDRINUSE|in use/i.test(msg) ? `The office port is already in use. ${msg}` : msg);
      return;
    }
    token = loadOrCreateConfig(dataDir).token;
    log('server up', office.url);
    createWindow();
    createTray();
  });
}
