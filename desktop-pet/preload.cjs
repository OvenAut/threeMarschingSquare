// Schmale, sichere Brücke zwischen Renderer und Hauptprozess
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petHost', {
    move: (x, y) => ipcRenderer.send('move', x, y),
    ignoreMouse: (ignore) => ipcRenderer.send('ignore-mouse', ignore),
    contextMenu: () => ipcRenderer.send('context-menu'),
    info: () => ipcRenderer.invoke('info'),
    workArea: (x, y) => ipcRenderer.invoke('work-area', x, y),
    displays: () => ipcRenderer.invoke('displays'),
    onCursor: (fn) => ipcRenderer.on('cursor', (_e, p) => fn(p)),
    onCommand: (fn) => ipcRenderer.on('command', (_e, c) => fn(c))
});
