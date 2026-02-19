const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen } = require('electron');

const RELEASE_NOTES_URL = 'https://github.com/mainulhossain/keynotter/releases';
const STATE_FILENAME = 'state.json';

const DEFAULT_STATE = {
  settings: {
    mode: 'top_strip',
    fontSizePx: 46,
    speedPxPerSec: 60,
    opacity: 0.97,
    topOffsetPx: 16,
    floatingBounds: {
      x: 80,
      y: 80,
      width: 980,
      height: 360
    },
    hideFromCapture: true
  },
  script: {
    text:
      'Welcome to KeyNotter.\n\n' +
      'Keep your eyes close to your camera while speaking.\n' +
      'Use Ctrl+Alt+Space to play/pause.\n\n' +
      'Load your script file with the Open button.',
    cursorPx: 0,
    lastFilePath: null,
    updatedAt: new Date().toISOString()
  },
  promptStatus: 'stopped'
};

const HOTKEYS = [
  { accelerator: 'CommandOrControl+Alt+Space', command: 'toggle_play' },
  { accelerator: 'CommandOrControl+Alt+R', command: 'reset' },
  { accelerator: 'CommandOrControl+Alt+Up', command: 'speed_up' },
  { accelerator: 'CommandOrControl+Alt+Down', command: 'speed_down' },
  { accelerator: 'CommandOrControl+Alt+Right', command: 'font_up' },
  { accelerator: 'CommandOrControl+Alt+Left', command: 'font_down' },
  { accelerator: 'CommandOrControl+Alt+M', command: 'mode_toggle' }
];

const RESIZE_EDGES = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);

const CLAMP = {
  speedMin: 0,
  speedMax: 500,
  fontMin: 16,
  fontMax: 120,
  opacityMin: 0.2,
  opacityMax: 1,
  topOffsetMin: 0,
  topOffsetMax: 300,
  floatingMinWidth: 720,
  floatingMinHeight: 190,
  floatingMaxWidth: 4000,
  floatingMaxHeight: 2000
};

let state = structuredClone(DEFAULT_STATE);
let overlayWindow = null;
let persistTimer = null;
let floatingBoundsTimer = null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const asNumber = (value, fallback) => {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
};

const asInt = (value, fallback, min, max) => {
  const next = asNumber(value, fallback);
  return Math.round(clamp(next, min, max));
};

const asStepInt = (value, fallback, min, max, step) => {
  const next = asNumber(value, fallback);
  const normalizedStep = Math.max(1, Math.round(asNumber(step, 1)));
  const stepped = Math.round(next / normalizedStep) * normalizedStep;
  return Math.round(clamp(stepped, min, max));
};

const asString = (value, fallback) => (typeof value === 'string' ? value : fallback);

const asDelta = (value) => {
  const next = asNumber(value, 0);
  return Number.isFinite(next) ? next : 0;
};

const normalizeEdge = (value) => {
  const edge = asString(value, 'se').toLowerCase();
  return RESIZE_EDGES.has(edge) ? edge : 'se';
};

const nowIso = () => new Date().toISOString();
const stateFilePath = () => path.join(app.getPath('userData'), STATE_FILENAME);

const sanitizeSettings = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {};
  const floatingInput =
    input.floatingBounds && typeof input.floatingBounds === 'object' ? input.floatingBounds : {};

  return {
    mode: input.mode === 'floating' ? 'floating' : 'top_strip',
    fontSizePx: asInt(input.fontSizePx, DEFAULT_STATE.settings.fontSizePx, CLAMP.fontMin, CLAMP.fontMax),
    speedPxPerSec: asStepInt(
      input.speedPxPerSec,
      DEFAULT_STATE.settings.speedPxPerSec,
      CLAMP.speedMin,
      CLAMP.speedMax,
      10
    ),
    opacity: clamp(
      asNumber(input.opacity, DEFAULT_STATE.settings.opacity),
      CLAMP.opacityMin,
      CLAMP.opacityMax
    ),
    topOffsetPx: asInt(
      input.topOffsetPx,
      DEFAULT_STATE.settings.topOffsetPx,
      CLAMP.topOffsetMin,
      CLAMP.topOffsetMax
    ),
    floatingBounds: {
      x: asInt(floatingInput.x, DEFAULT_STATE.settings.floatingBounds.x, -10000, 10000),
      y: asInt(floatingInput.y, DEFAULT_STATE.settings.floatingBounds.y, -10000, 10000),
      width: asInt(
        floatingInput.width,
        DEFAULT_STATE.settings.floatingBounds.width,
        CLAMP.floatingMinWidth,
        CLAMP.floatingMaxWidth
      ),
      height: asInt(
        floatingInput.height,
        DEFAULT_STATE.settings.floatingBounds.height,
        CLAMP.floatingMinHeight,
        CLAMP.floatingMaxHeight
      )
    },
    hideFromCapture:
      typeof input.hideFromCapture === 'boolean'
        ? input.hideFromCapture
        : DEFAULT_STATE.settings.hideFromCapture
  };
};

const sanitizeScript = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {};
  const parsedDate = typeof input.updatedAt === 'string' ? Date.parse(input.updatedAt) : NaN;

  return {
    text: asString(input.text, DEFAULT_STATE.script.text),
    cursorPx: clamp(asNumber(input.cursorPx, 0), 0, Number.MAX_SAFE_INTEGER),
    lastFilePath:
      typeof input.lastFilePath === 'string' || input.lastFilePath === null
        ? input.lastFilePath
        : null,
    updatedAt: Number.isNaN(parsedDate) ? nowIso() : new Date(parsedDate).toISOString()
  };
};

const sanitizeState = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {};

  return {
    settings: sanitizeSettings(input.settings),
    script: sanitizeScript(input.script),
    promptStatus:
      input.promptStatus === 'playing' || input.promptStatus === 'paused'
        ? input.promptStatus
        : 'stopped'
  };
};

const snapshot = () => ({
  settings: {
    ...state.settings,
    floatingBounds: { ...state.settings.floatingBounds }
  },
  script: { ...state.script },
  promptStatus: state.promptStatus
});

const queuePersist = () => {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    try {
      const target = stateFilePath();
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, JSON.stringify(state, null, 2), 'utf8');
    } catch (error) {
      console.error('Failed to persist state', error);
    }
  }, 80);
};

const loadState = () => {
  try {
    const raw = fs.readFileSync(stateFilePath(), 'utf8');
    state = sanitizeState(JSON.parse(raw));
  } catch {
    state = sanitizeState(DEFAULT_STATE);
  }
};

const sendToOverlay = (channel, payload) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send(channel, payload);
  }
};

const broadcastState = () => {
  sendToOverlay('state:changed', snapshot());
};

const topStripBounds = () => {
  const pointer = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(pointer);
  const area = display.workArea;

  const width = clamp(Math.round(area.width * 0.74), 720, Math.min(1800, area.width));
  const promptHeight = clamp(Math.round(state.settings.fontSizePx * 2.25), 110, 300);
  const controlsHeight = 122;
  const totalHeight = clamp(promptHeight + controlsHeight, 210, 540);

  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + state.settings.topOffsetPx),
    width,
    height: totalHeight
  };
};

const constrainFloatingBounds = (bounds) => {
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;

  const width = clamp(bounds.width, Math.min(CLAMP.floatingMinWidth, area.width), area.width);
  const height = clamp(bounds.height, Math.min(CLAMP.floatingMinHeight, area.height), area.height);

  return {
    x: clamp(bounds.x, area.x, area.x + area.width - width),
    y: clamp(bounds.y, area.y, area.y + area.height - height),
    width,
    height
  };
};

const applyOverlayLayout = () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  overlayWindow.setContentProtection(Boolean(state.settings.hideFromCapture));

  if (state.settings.mode === 'top_strip') {
    overlayWindow.setResizable(false);
    overlayWindow.setBounds(topStripBounds(), true);
    return;
  }

  overlayWindow.setResizable(true);
  overlayWindow.setBounds(constrainFloatingBounds(state.settings.floatingBounds), true);
};

const persistFloatingBoundsFromWindow = () => {
  if (!overlayWindow || overlayWindow.isDestroyed() || state.settings.mode !== 'floating') {
    return;
  }

  clearTimeout(floatingBoundsTimer);
  floatingBoundsTimer = setTimeout(() => {
    if (!overlayWindow || overlayWindow.isDestroyed() || state.settings.mode !== 'floating') {
      return;
    }

    const nextBounds = overlayWindow.getBounds();
    state.settings.floatingBounds = {
      x: nextBounds.x,
      y: nextBounds.y,
      width: nextBounds.width,
      height: nextBounds.height
    };

    queuePersist();
    broadcastState();
  }, 100);
};

const createOverlayWindow = async () => {
  overlayWindow = new BrowserWindow({
    width: 980,
    height: 360,
    minWidth: CLAMP.floatingMinWidth,
    minHeight: CLAMP.floatingMinHeight,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    movable: true,
    skipTaskbar: true,
    hasShadow: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    title: 'KeyNotter',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true);
  overlayWindow.setFullScreenable(false);

  await overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));

  overlayWindow.on('moved', persistFloatingBoundsFromWindow);
  overlayWindow.on('resized', persistFloatingBoundsFromWindow);
  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  applyOverlayLayout();
};

const updateSettings = (partial) => {
  const merged = {
    ...state.settings,
    ...(partial || {}),
    floatingBounds: {
      ...state.settings.floatingBounds,
      ...((partial && partial.floatingBounds) || {})
    }
  };

  state.settings = sanitizeSettings(merged);
  applyOverlayLayout();
  queuePersist();

  return state.settings;
};

const updateCursor = (cursorPx) => {
  state.script.cursorPx = clamp(asNumber(cursorPx, state.script.cursorPx), 0, Number.MAX_SAFE_INTEGER);
  state.script.updatedAt = nowIso();
  queuePersist();
};

const resizeOverlay = (payload) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return false;
  }

  const edge = normalizeEdge(payload && payload.edge);
  const deltaX = asDelta(payload && payload.deltaX);
  const deltaY = asDelta(payload && payload.deltaY);

  const currentBounds = overlayWindow.getBounds();
  const display = screen.getDisplayMatching(currentBounds);
  const area = display.workArea;

  const minWidth = Math.min(CLAMP.floatingMinWidth, area.width);
  const minHeight = Math.min(CLAMP.floatingMinHeight, area.height);
  const maxWidth = Math.min(CLAMP.floatingMaxWidth, area.width);
  const maxHeight = Math.min(CLAMP.floatingMaxHeight, area.height);

  let x = currentBounds.x;
  let y = currentBounds.y;
  let width = currentBounds.width;
  let height = currentBounds.height;

  if (edge.includes('e')) {
    width = clamp(width + deltaX, minWidth, maxWidth);
  }

  if (edge.includes('s')) {
    height = clamp(height + deltaY, minHeight, maxHeight);
  }

  if (edge.includes('w')) {
    const nextWidth = clamp(width - deltaX, minWidth, maxWidth);
    x += width - nextWidth;
    width = nextWidth;
  }

  if (edge.includes('n')) {
    const nextHeight = clamp(height - deltaY, minHeight, maxHeight);
    y += height - nextHeight;
    height = nextHeight;
  }

  x = clamp(x, area.x, area.x + area.width - width);
  y = clamp(y, area.y, area.y + area.height - height);

  const nextBounds = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };

  state.settings = sanitizeSettings({
    ...state.settings,
    mode: 'floating',
    floatingBounds: {
      ...nextBounds
    }
  });

  overlayWindow.setResizable(true);
  overlayWindow.setBounds(nextBounds, true);
  queuePersist();

  return true;
};

const moveOverlay = (payload) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return false;
  }

  const deltaX = asDelta(payload && payload.deltaX);
  const deltaY = asDelta(payload && payload.deltaY);

  if (deltaX === 0 && deltaY === 0) {
    return false;
  }

  const currentBounds = overlayWindow.getBounds();
  const display = screen.getDisplayMatching(currentBounds);
  const area = display.workArea;

  const width = currentBounds.width;
  const height = currentBounds.height;

  const nextBounds = {
    x: Math.round(clamp(currentBounds.x + deltaX, area.x, area.x + area.width - width)),
    y: Math.round(clamp(currentBounds.y + deltaY, area.y, area.y + area.height - height)),
    width,
    height
  };

  state.settings = sanitizeSettings({
    ...state.settings,
    mode: 'floating',
    floatingBounds: {
      ...nextBounds
    }
  });

  overlayWindow.setResizable(true);
  overlayWindow.setBounds(nextBounds, true);
  queuePersist();

  return true;
};

const applyPromptCommand = (command) => {
  switch (command) {
    case 'toggle_play':
      state.promptStatus = state.promptStatus === 'playing' ? 'paused' : 'playing';
      break;
    case 'reset':
      state.promptStatus = 'stopped';
      state.script.cursorPx = 0;
      state.script.updatedAt = nowIso();
      break;
    case 'speed_up': {
      const normalizedSpeed = asStepInt(
        state.settings.speedPxPerSec,
        DEFAULT_STATE.settings.speedPxPerSec,
        CLAMP.speedMin,
        CLAMP.speedMax,
        10
      );
      state.settings.speedPxPerSec = clamp(normalizedSpeed + 10, CLAMP.speedMin, CLAMP.speedMax);
      break;
    }
    case 'speed_down': {
      const normalizedSpeed = asStepInt(
        state.settings.speedPxPerSec,
        DEFAULT_STATE.settings.speedPxPerSec,
        CLAMP.speedMin,
        CLAMP.speedMax,
        10
      );
      state.settings.speedPxPerSec = clamp(normalizedSpeed - 10, CLAMP.speedMin, CLAMP.speedMax);
      break;
    }
    case 'font_up':
      state.settings.fontSizePx = clamp(state.settings.fontSizePx + 2, CLAMP.fontMin, CLAMP.fontMax);
      break;
    case 'font_down':
      state.settings.fontSizePx = clamp(state.settings.fontSizePx - 2, CLAMP.fontMin, CLAMP.fontMax);
      break;
    case 'mode_toggle':
      state.settings.mode = state.settings.mode === 'top_strip' ? 'floating' : 'top_strip';
      break;
    default:
      break;
  }

  state.settings = sanitizeSettings(state.settings);
  applyOverlayLayout();
  queuePersist();
};

const registerIpc = () => {
  ipcMain.handle('bootstrap:get', () => snapshot());

  ipcMain.handle('settings:update', (_event, partial) => {
    const settings = updateSettings(partial);
    broadcastState();
    return settings;
  });

  ipcMain.handle('script:set-text', (_event, payload) => {
    state.script.text = asString(payload && payload.text, state.script.text);
    state.script.updatedAt = nowIso();
    queuePersist();
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('script:cursor-update', (_event, payload) => {
    updateCursor(payload && payload.cursorPx);
    return { ok: true };
  });

  ipcMain.handle('script:file-open', async () => {
    const options = {
      title: 'Open Script',
      properties: ['openFile'],
      filters: [
        { name: 'Text or Markdown', extensions: ['txt', 'md'] },
        { name: 'All files', extensions: ['*'] }
      ]
    };

    const result = overlayWindow
      ? await dialog.showOpenDialog(overlayWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return state.script;
    }

    const targetPath = result.filePaths[0];
    const text = await fsp.readFile(targetPath, 'utf8');

    state.script = sanitizeScript({
      ...state.script,
      text,
      cursorPx: 0,
      lastFilePath: targetPath,
      updatedAt: nowIso()
    });

    queuePersist();
    broadcastState();
    return state.script;
  });

  ipcMain.handle('script:file-save', async (_event, payload) => {
    const forceDialog = Boolean(payload && payload.forceDialog);
    let targetPath = forceDialog ? null : state.script.lastFilePath;

    if (!targetPath) {
      const options = {
        title: 'Save Script',
        defaultPath: state.script.lastFilePath || 'script.txt',
        filters: [
          { name: 'Text', extensions: ['txt'] },
          { name: 'Markdown', extensions: ['md'] }
        ]
      };

      const result = overlayWindow
        ? await dialog.showSaveDialog(overlayWindow, options)
        : await dialog.showSaveDialog(options);

      if (result.canceled || !result.filePath) {
        return { savedPath: null };
      }

      targetPath = result.filePath;
    }

    await fsp.writeFile(targetPath, state.script.text, 'utf8');

    state.script = sanitizeScript({
      ...state.script,
      lastFilePath: targetPath,
      updatedAt: nowIso()
    });

    queuePersist();
    broadcastState();

    return { savedPath: targetPath };
  });

  ipcMain.handle('prompt:command', (_event, payload) => {
    applyPromptCommand(payload && payload.command);
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('overlay:resize', (_event, payload) => {
    const resized = resizeOverlay(payload);
    if (resized) {
      broadcastState();
    }
    return { ok: resized };
  });

  ipcMain.handle('overlay:move', (_event, payload) => {
    const moved = moveOverlay(payload);
    return { ok: moved };
  });
};

const registerHotkeys = () => {
  for (const binding of HOTKEYS) {
    const ok = globalShortcut.register(binding.accelerator, () => {
      applyPromptCommand(binding.command);

      sendToOverlay('hotkey:event', {
        command: binding.command,
        triggeredAt: nowIso()
      });

      broadcastState();
    });

    if (!ok) {
      console.warn(`Could not register hotkey: ${binding.accelerator}`);
    }
  }
};

const bootstrap = async () => {
  loadState();
  registerIpc();
  await createOverlayWindow();
  registerHotkeys();
  broadcastState();
};

app.setAppUserModelId('xyz.keynotter.simple');

app.whenReady().then(bootstrap).catch((error) => {
  console.error('Failed to start app', error);
  app.quit();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createOverlayWindow();
    broadcastState();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

process.env.KEYNOTTER_RELEASE_NOTES_URL = RELEASE_NOTES_URL;
