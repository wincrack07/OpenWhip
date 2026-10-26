const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { createController } = require('./codex');

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
let targetApp = null;

if (process.platform === 'darwin') {
  app.setActivationPolicy('accessory');
}

const VK_RETURN = 0x0D;
const KEYUP = 0x0002;

function rememberFrontApp() {
  if (process.platform !== 'darwin') return;
  if (overlay && overlay.isVisible()) return;
  const script = [
    'tell application "System Events"',
    '  set p to first application process whose frontmost is true',
    '  set n to name of p',
    '  return n',
    'end tell',
  ].join('\n');
  execFile('osascript', ['-e', script], (err, stdout) => {
    if (err) return;
    const name = String(stdout || '').trim();
    if (!name || /electron|openwhip/i.test(name)) return;
    targetApp = name;
    if (tray) tray.setToolTip(`OpenWhip · ${name}`);
  });
}

function focusScript() {
  const name = (targetApp || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  if (!name) return '';
  return `set frontmost of process "${name}" to true\n  delay 0.12`;
}

/** Codex effort: Shift+Up / Shift+Down. Fast: paste `/fast on|off` + Enter. */
function sendCodexCommand(command) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'darwin') {
      resolve();
      return;
    }
    const focus = focusScript();
    if (command === 'increase' || command === 'decrease') {
      const code = command === 'increase' ? 126 : 125; // Up / Down
      const script = [
        'tell application "System Events"',
        focus,
        `  key code ${code} using shift down`,
        'end tell',
      ].filter(Boolean).join('\n');
      execFile('osascript', ['-e', script], err => (err ? reject(err) : resolve()));
      return;
    }
    const text = command === 'fast-on' ? '/fast on' : command === 'fast-off' ? '/fast off' : null;
    if (!text) {
      resolve();
      return;
    }
    const previous = clipboard.readText();
    clipboard.writeText(text);
    const script = [
      'tell application "System Events"',
      focus,
      // Clear whatever is already in the Codex composer.
      '  keystroke "a" using command down',
      '  delay 0.04',
      '  key code 51',
      '  delay 0.04',
      '  keystroke "v" using command down',
      '  delay 0.06',
      '  key code 36',
      'end tell',
    ].filter(Boolean).join('\n');
    execFile('osascript', ['-e', script], err => {
      setTimeout(() => clipboard.writeText(previous), 400);
      if (err) reject(err);
      else resolve();
    });
  });
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
    const denied = /not allowed|assistive|1002|-1719|-25211/i.test(err.message || '');
    publishCodex({
      ...result,
      label: denied ? 'activa Accesibilidad' : 'no entró el texto',
    });
    console.warn('codex keystroke failed:', err.message || err);
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
  if (command === 'increase') {
    shiftArrow(0x26);
    return;
  }
  if (command === 'decrease') {
    shiftArrow(0x28);
    return;
  }
  const text = command === 'fast-on' ? '/fast on' : '/fast off';
  for (const ch of text) tapChar(ch);
  keybd_event(VK_RETURN, 0, 0, 0);
  keybd_event(VK_RETURN, 0, KEYUP, 0);
}


// ── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  codex = createController({
    send: process.platform === 'win32' ? (cmd) => Promise.resolve(sendMacroWindows(cmd)) : sendCodexCommand,
  });
  rememberFrontApp();
  setInterval(rememberFrontApp, 700);
  tray = new Tray(await getTrayIcon());
  tray.setToolTip('OpenWhip · clic para el latigo');
  // On macOS a context menu steals the left click, so Quit is right-click only.
  const quitMenu = Menu.buildFromTemplate([
    { label: 'Salir de OpenWhip', click: () => app.quit() },
  ]);
  tray.on('right-click', () => tray.popUpContextMenu(quitMenu));
  tray.on('click', () => {
    rememberFrontApp();
    toggleOverlay();
  });
});

app.on('window-all-closed', e => e.preventDefault()); // keep alive in tray
