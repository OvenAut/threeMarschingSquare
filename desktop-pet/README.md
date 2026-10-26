# Glibber – Desktop-Haustier für Windows

Ein kleiner Glibber-Schleim, der auf der Taskleiste herumhüpft. Gerendert mit **three.js (WebGPURenderer)**,
alle Materialien sind **TSL**-Shader: Körperverformung (Quetschen, Neigen, Wackeln), Toon-Licht,
Gesicht mit Augen/Mund/Bäckchen direkt auf der Oberfläche sowie Herzen und Zzz als SDF-Sprites.

## Starten

```bash
cd desktop-pet
npm install
npm start
```

Ohne Electron zum Ausprobieren im Browser: `npx http-server -c-1 .` im Ordner `desktop-pet` und
`index.html` öffnen (Tasten **J** hüpfen, **S** schlafen, **W** wecken, **H** holen).

## Bedienung

| Aktion | Wirkung |
| --- | --- |
| Klick auf Glibber | freut sich, hüpft, Herzen |
| Ziehen | hochheben; loslassen = werfen (prallt an den Bildschirmrändern ab) |
| Rechtsklick / Tray-Symbol | Menü: Hüpfen, Schlafen, Aufwecken, Hierher holen, Mit Windows starten, Beenden |
| 60 s keine Beachtung | schläft ein (wird bläulich, Zzz) – Klick weckt |

Die durchsichtigen Teile des Fensters lassen Mausklicks durch; nur der Körper selbst ist anklickbar.

## Windows-Build

```bash
npm run dist
```

Erzeugt in `dist/` eine portable `.exe` und einen Installer (electron-builder).

## Hinweise

- Fällt WebGPU aus (z. B. ältere Treiber), mit `set GLIBBER_WEBGL=1` vor `npm start` WebGL 2 erzwingen;
  im Browser `index.html?webgl`.
- Aufbau: `main.cjs` (Fenster, Tray, Mausdurchlass), `preload.cjs` (IPC-Brücke),
  `src/pet.js` (Szene + TSL-Shader), `src/app.js` (Verhalten/Physik).
