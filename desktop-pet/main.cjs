// Electron-Hauptprozess: durchsichtiges, rahmenloses Fenster, das immer im Vordergrund liegt
// und vom Renderer über den Bildschirm bewegt wird. Durchsichtige Bereiche lassen Klicks durch.
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

const WINDOW_SIZE = 220;          // Fenstergröße in DIP (das Haustier sitzt unten in der Mitte)
const CURSOR_INTERVAL = 33;       // so oft (ms) bekommt der Renderer die Mausposition

let win, tray, cursorTimer;

// Ohne Hardware-Vsync-Pause im Hintergrund würde das Haustier einfrieren, sobald es verdeckt ist
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-unsafe-webgpu');

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
    const { workArea } = screen.getPrimaryDisplay();
    win = new BrowserWindow({
        width: WINDOW_SIZE,
        height: WINDOW_SIZE,
        x: Math.round(workArea.x + workArea.width * 0.7),
        y: workArea.y + workArea.height - WINDOW_SIZE,
        transparent: true,
        backgroundColor: '#00000000',
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        hasShadow: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            backgroundThrottling: false
        }
    });
    // 'screen-saver' liegt auch über der Taskleiste und Vollbild-Fenstern
    win.setAlwaysOnTop(true, 'screen-saver');
    // Standard: Klicks gehen durch, Mausbewegungen werden trotzdem gemeldet (Hover-Test im Renderer)
    win.setIgnoreMouseEvents(true, { forward: true });
    win.loadFile('index.html', process.env.GLIBBER_WEBGL ? { query: { webgl: '1' } } : undefined);

    cursorTimer = setInterval(() => {
        if (win.isDestroyed()) return;
        win.webContents.send('cursor', screen.getCursorScreenPoint());
    }, CURSOR_INTERVAL);

    win.on('closed', () => { clearInterval(cursorTimer); win = null; });
}

function createTray() {
    // Kleines grünes Schleim-Symbol direkt als Bitmap (BGRA), damit keine Bilddatei nötig ist
    const size = 16, buf = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = (x - 7.5) / 7, dy = (y - 9) / 6.5;
            const inside = dx * dx + dy * dy <= 1 || (y > 9 && Math.abs(dx) < 1);
            const eye = (x === 5 || x === 10) && (y === 7 || y === 8);
            const i = (y * size + x) * 4;
            if (!inside) continue;
            buf[i] = eye ? 30 : 120; buf[i + 1] = eye ? 20 : 230; buf[i + 2] = eye ? 20 : 60; buf[i + 3] = 255;
        }
    }
    tray = new Tray(nativeImage.createFromBitmap(buf, { width: size, height: size }));
    tray.setToolTip('Glibber');
    tray.setContextMenu(buildMenu());
}

function buildMenu() {
    return Menu.buildFromTemplate([
        { label: 'Hüpfen', click: () => send('command', 'jump') },
        { label: 'Schlafen', click: () => send('command', 'sleep') },
        { label: 'Aufwecken', click: () => send('command', 'wake') },
        { label: 'Hierher holen', click: () => send('command', 'home') },
        { type: 'separator' },
        {
            label: 'Mit Windows starten', type: 'checkbox',
            checked: app.getLoginItemSettings().openAtLogin,
            click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
        },
        { label: 'Entwicklertools', click: () => win?.webContents.openDevTools({ mode: 'detach' }) },
        { type: 'separator' },
        { label: 'Beenden', click: () => app.quit() }
    ]);
}

function send(channel, value) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, value);
}

// --- Schnittstelle zum Renderer ---------------------------------------------
ipcMain.on('move', (_e, x, y) => {
    if (!win) return;
    // setBounds statt setPosition: verhindert unter Windows das Wachsen des Fensters bei Skalierung ≠ 100 %
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: WINDOW_SIZE, height: WINDOW_SIZE });
});

ipcMain.on('ignore-mouse', (_e, ignore) => {
    win?.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('context-menu', () => {
    buildMenu().popup({ window: win });
});

ipcMain.handle('info', () => {
    const [x, y] = win.getPosition();
    return { x, y, size: WINDOW_SIZE };
});

// Arbeitsbereich (ohne Taskleiste) des Bildschirms, auf dem der Punkt liegt
ipcMain.handle('work-area', (_e, x, y) => {
    return screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
});

// Gesamtfläche aller Bildschirme, damit man das Haustier auf einen anderen Monitor ziehen kann
ipcMain.handle('displays', () => screen.getAllDisplays().map((d) => d.workArea));

app.on('second-instance', () => send('command', 'home'));
app.whenReady().then(() => {
    createWindow();
    createTray();
    screen.on('display-metrics-changed', () => send('command', 'displays'));
    screen.on('display-added', () => send('command', 'displays'));
    screen.on('display-removed', () => send('command', 'displays'));
});
app.on('window-all-closed', () => app.quit());
