const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { createController, EFFORTS } = require('./codex');

// ── Win32 FFI (Windows only) ────────────────────────────────────────────────
let keybd_event, VkKeyScanA;
if (process.platform === 'win32') {
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    keybd_event = user32.func('void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)');
    VkKeyScanA = user32.func('int16_t __stdcall VkKeyScanA(int ch)');
  } catch (e) {
    console.warn('koffi not available – macro sending disabled', e.message);
  }
}

// ── Globals ─────────────────────────────────────────────────────────────────
let tray, overlay;
let overlayReady = false;
let spawnQueued = false;
let codex;
let targetApp = null; // last agent app: Claude, ChatGPT (Codex), Orca, Terminal…

if (process.platform === 'darwin') {
  app.setActivationPolicy('accessory');
}

const VK_RETURN = 0x0D;
const KEYUP = 0x0002;

// Desktop + terminal hosts we can whip.
// Claude.app → /effort + /fast. ChatGPT / Codex apps → Shift+↑↓ + /fast (CLI same).
const AGENT_APPS = {
  Claude: 'claude',
  ChatGPT: 'codex',
  Codex: 'codex',
  Orca: 'codex',
  Terminal: 'codex',
  iTerm2: 'codex',
  Ghostty: 'codex',
  Warp: 'codex',
  Alacritty: 'codex',
  kitty: 'codex',
};

function flavorFor(appName) {
  return AGENT_APPS[appName] || 'codex';
}

function setTargetApp(name) {
  if (!name || !AGENT_APPS[name]) return;
  targetApp = name;
  if (tray) tray.setToolTip(`OpenWhip · ${name} (${flavorFor(name)})`);
}

function rememberFrontApp() {
  if (process.platform !== 'darwin') return;
  if (overlay && overlay.isVisible()) return;
  const script = [
    'tell application "System Events"',
    '  set p to first application process whose frontmost is true',
    '  return name of p',
    'end tell',
  ].join('\n');
  execFile('osascript', ['-e', script], (err, stdout) => {
    if (err) return;
    setTargetApp(String(stdout || '').trim());
  });
}

function listRunningAgentApps() {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') {
      resolve([]);
      return;
    }
    const names = Object.keys(AGENT_APPS)
      .map((n) => `"${n}"`)
      .join(', ');
    const script = [
      'tell application "System Events"',
      `  set wanted to {${names}}`,
      '  set found to {}',
      '  repeat with p in (application processes whose background only is false)',
      '    set n to name of p as text',
      '    if n is in wanted then',
      '      try',
      '        if (count of windows of p) > 0 then set end of found to n',
      '      end try',
      '    end if',
      '  end repeat',
      '  set AppleScript\'s text item delimiters to linefeed',
      '  return found as text',
      'end tell',
    ].join('\n');
    execFile('osascript', ['-e', script], (err, stdout) => {
      if (err) {
        resolve([]);
        return;
      }
      const list = String(stdout || '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      resolve(list);
    });
  });
}

async function resolveTargetApp() {
  const running = await listRunningAgentApps();
  if (targetApp && running.includes(targetApp)) return targetApp;
  // Prefer Claude / ChatGPT / Codex desktop over bare terminals.
  const preferred = [
    'Claude', 'ChatGPT', 'Codex',
    'Orca', 'Terminal', 'iTerm2', 'Ghostty', 'Warp', 'Alacritty', 'kitty',
  ];
  for (const name of preferred) {
    if (running.includes(name)) {
      setTargetApp(name);
      return name;
    }
  }
  return targetApp;
}

function activateScript(appName) {
  const name = (appName || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  if (!name) return '';
  // Activate by app name, then force the process frontmost (more reliable for Electron apps).
  return [
    `try`,
    `  tell application "${name}" to activate`,
    `end try`,
    `tell application "System Events"`,
    `  set frontmost of process "${name}" to true`,
    `  delay 0.18`,
    `end tell`,
  ].join('\n');
}

function pasteLineScript(appName) {
  // text already on clipboard; Cmd+A + delete clears the composer first
  const name = (appName || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [
    activateScript(name),
    'tell application "System Events"',
    '  keystroke "a" using command down',
    '  delay 0.05',
    '  key code 51',
    '  delay 0.05',
    '  keystroke "v" using command down',
    '  delay 0.08',
    '  key code 36',
    'end tell',
  ].filter(Boolean).join('\n');
}

function keyScript(appName, bodyLines) {
  return [
    activateScript(appName),
    'tell application "System Events"',
    ...bodyLines.map((l) => (l.startsWith(' ') ? l : `  ${l}`)),
    'end tell',
  ].filter(Boolean).join('\n');
}

/** Send to Claude.app, ChatGPT/Codex desktop, or a Codex CLI terminal. */
function sendAgentCommand(command) {
  return new Promise(async (resolve, reject) => {
    if (process.platform !== 'darwin') {
      resolve();
      return;
    }
    const appName = await resolveTargetApp();
    if (!appName) {
      reject(new Error('no agent app'));
      return;
    }
    const flavor = flavorFor(appName);

    // Codex desktop/CLI: Shift+arrows. Claude.app: absolute /effort.
    if (typeof command === 'string' && command.startsWith('effort:')) {
      const level = command.slice('effort:'.length);
      if (flavor === 'claude') {
        const previous = clipboard.readText();
        clipboard.writeText('/effort ' + level);
        execFile('osascript', ['-e', pasteLineScript(appName)], (err) => {
          setTimeout(() => clipboard.writeText(previous), 450);
          if (err) reject(err);
          else resolve();
        });
        return;
      }
      const dir = decideEffortKey(level);
      const code = dir === 'up' ? 126 : 125;
      const script = keyScript(appName, [`key code ${code} using shift down`]);
      execFile('osascript', ['-e', script], (err) => (err ? reject(err) : resolve()));
      return;
    }

    let text = null;
    if (command === 'fast-on') text = '/fast on';
    else if (command === 'fast-off') text = '/fast off';
    else if (typeof command === 'string' && command.startsWith('prompt:')) {
      text = command.slice('prompt:'.length);
    }
    if (!text) {
      resolve();
      return;
    }
    const previous = clipboard.readText();
    clipboard.writeText(text);
    execFile('osascript', ['-e', pasteLineScript(appName)], (err) => {
      setTimeout(() => clipboard.writeText(previous), 450);
      if (err) reject(err);
      else resolve();
    });
  });
}

let lastEffortIndex = EFFORTS.indexOf('medium');
function decideEffortKey(level) {
  const idx = EFFORTS.indexOf(level);
  const dir = idx >= lastEffortIndex ? 'up' : 'down';
  if (idx >= 0) lastEffortIndex = idx;
  return dir;
}

function createTrayIconFallback() {
  const p = path.join(__dirname, 'icon', 'Template.png');
  if (fs.existsSync(p)) {
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) {
      if (process.platform === 'darwin') img.setTemplateImage(true);
      return img;
    }
  }
  console.warn('openwhip: icon/Template.png missing or invalid');
  return nativeImage.createEmpty();
}

async function getTrayIcon() {
  if (process.platform === 'win32') {
    const file = path.join(__dirname, 'icon', 'icon.ico');
    if (fs.existsSync(file)) {
      const img = nativeImage.createFromPath(file);
      if (!img.isEmpty()) return img;
    }
  }
  // macOS menu bar uses the transparent template. The old icns was an opaque
  // tile, so the whip disappeared into a white blob.
  return createTrayIconFallback();
}

// ── Overlay window ──────────────────────────────────────────────────────────
function createOverlay() {
  const { bounds } = screen.getPrimaryDisplay();
  overlay = new BrowserWindow({
    x: bounds.x, y: bounds.y,
    width: bounds.width, height: bounds.height,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayReady = false;
  overlay.loadFile('overlay.html');
  overlay.webContents.on('did-finish-load', () => {
    overlayReady = true;
    if (spawnQueued && overlay && overlay.isVisible()) {
      spawnQueued = false;
      overlay.webContents.send('spawn-whip');
    }
  });
  overlay.on('closed', () => {
    overlay = null;
    overlayReady = false;
    spawnQueued = false;
  });
}

function toggleOverlay() {
  if (overlay && overlay.isVisible()) {
    overlay.webContents.send('drop-whip');
    return;
  }
  if (!overlay) createOverlay();
  overlay.show();
  if (overlayReady) {
    overlay.webContents.send('spawn-whip');
  } else {
    spawnQueued = true;
  }
}

// ── IPC ─────────────────────────────────────────────────────────────────────
function publishCodex(result) {
  const status = {
    label: result.label,
    mood: result.mood,
    effort: result.effort,
    fast: !!result.fast,
  };
  if (overlay && !overlay.isDestroyed()) {
    overlay.webContents.send('codex-status', status);
  }
  if (tray) {
    const where = targetApp ? ` → ${targetApp}` : '';
    const suffix = status.fast ? 'FAST' : status.effort;
    tray.setToolTip(`OpenWhip · ${suffix}${where}`);
  }
}

function runGesture(result) {
  publishCodex(result);
  if (!result.done) return;
  result.done.catch(err => {
    const msg = err.message || '';
    const denied = /not allowed|assistive|1002|-1719|-25211/i.test(msg);
    const missing = /no agent app/i.test(msg);
    publishCodex({
      ...result,
      label: denied
        ? 'activa Accesibilidad'
        : missing
          ? 'abre Claude o ChatGPT'
          : 'no entró el texto',
    });
    console.warn('agent keystroke failed:', msg);
  });
}

ipcMain.on('whip-crack', () => {
  try {
    runGesture(codex.whip());
  } catch (err) {
    console.warn('codex whip failed:', err?.message || err);
  }
});
ipcMain.on('pet', () => {
  try {
    runGesture(codex.pet());
  } catch (err) {
    console.warn('codex pet failed:', err?.message || err);
  }
});
ipcMain.on('hide-overlay', () => { if (overlay) overlay.hide(); });

// ── Windows: Shift+arrows for effort, typed /fast for Fast mode ────────────
function sendMacroWindows(command) {
  if (!keybd_event || !VkKeyScanA) return;
  const tapKey = vk => {
    keybd_event(vk, 0, 0, 0);
    keybd_event(vk, 0, KEYUP, 0);
  };
  const tapChar = ch => {
    const packed = VkKeyScanA(ch.charCodeAt(0));
    if (packed === -1) return;
    const vk = packed & 0xff;
    const shiftState = (packed >> 8) & 0xff;
    if (shiftState & 1) keybd_event(0x10, 0, 0, 0);
    tapKey(vk);
    if (shiftState & 1) keybd_event(0x10, 0, KEYUP, 0);
  };
  const shiftArrow = vk => {
    keybd_event(0x10, 0, 0, 0);
    keybd_event(vk, 0, 0, 0);
    keybd_event(vk, 0, KEYUP, 0);
    keybd_event(0x10, 0, KEYUP, 0);
  };
  if (typeof command === 'string' && command.startsWith('effort:')) {
    const level = command.slice('effort:'.length);
    shiftArrow(decideEffortKey(level) === 'up' ? 0x26 : 0x28);
    return;
  }
  let text = null;
  if (command === 'fast-on') text = '/fast on';
  else if (command === 'fast-off') text = '/fast off';
  else if (typeof command === 'string' && command.startsWith('prompt:')) {
    text = command.slice('prompt:'.length);
  }
  if (!text) return;
  for (const ch of text) tapChar(ch);
  keybd_event(VK_RETURN, 0, 0, 0);
  keybd_event(VK_RETURN, 0, KEYUP, 0);
}


// ── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  codex = createController({
    send: process.platform === 'win32'
      ? (cmd) => Promise.resolve(sendMacroWindows(cmd))
      : sendAgentCommand,
  });
  rememberFrontApp();
  setInterval(rememberFrontApp, 700);
  tray = new Tray(await getTrayIcon());
  tray.setToolTip('OpenWhip · clic · Claude / ChatGPT / Codex');
  // On macOS a context menu steals the left click, so Quit is right-click only.
  const quitMenu = Menu.buildFromTemplate([
    { label: 'Salir de OpenWhip', click: () => app.quit() },
  ]);
  tray.on('right-click', () => tray.popUpContextMenu(quitMenu));
  tray.on('click', async () => {
    rememberFrontApp();
    await resolveTargetApp();
    toggleOverlay();
  });
});

app.on('window-all-closed', e => e.preventDefault()); // keep alive in tray
