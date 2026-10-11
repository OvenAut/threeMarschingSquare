import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';

export function createCycleChart(width = 512, height = 256, maxTimeSeconds = 600, storageKey = 'ipc_cycle_history') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;

    const material = new MeshBasicNodeMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide
    });

    const geometry = new THREE.PlaneGeometry(3.0, 1.5);
    const mesh = new THREE.Mesh(geometry, material);

    let history = [];
    let lastCounterValue = null; 
    let lastCycleRealTime = Date.now();

    // --- 1. LOCALSTORAGE SAUBER LADEN ---
    try {
        const savedData = localStorage.getItem(storageKey);
        if (savedData) {
            const parsed = JSON.parse(savedData);
            const nowReal = Date.now();
            const nowPerf = performance.now();
            
            if (parsed.history && Array.isArray(parsed.history)) {
                history = parsed.history
                    .filter(item => {
                        // Prüfen, ob der Punkt innerhalb der letzten 10 Minuten liegt
                        const ageSeconds = (nowReal - item.time) / 1000;
                        return ageSeconds >= 0 && ageSeconds <= maxTimeSeconds;
                    })
                    .map(item => {
                        // Mappe den echten Zeitstempel auf das aktuelle performance.now() für die Animation
                        const ageSeconds = (nowReal - item.time) / 1000;
                        return {
                            duration: item.duration,
                            time: nowPerf - (ageSeconds * 1000),
                            realTime: item.time
                        };
                    });
            }
            if (parsed.lastCounterValue !== undefined) {
                lastCounterValue = parsed.lastCounterValue;
            }
        }
    } catch (e) {
        console.warn('Fehler beim Laden aus dem localStorage:', e);
    }

    const saveToLocalStorage = () => {
        try {
            const stateToSave = {
                history: history.map(item => ({
                    duration: item.duration,
                    time: item.realTime || Date.now()
                })),
                lastCounterValue: lastCounterValue
            };
            localStorage.setItem(storageKey, JSON.stringify(stateToSave));
        } catch (e) {
            console.warn('Fehler beim Speichern in den localStorage:', e);
        }
    };

    const updateAndDraw = () => {
        const now = performance.now();

        // Alte Daten (älter als 10 Min) verwerfen
        const cutoff = now - (maxTimeSeconds * 1000);
        let modified = false;
        while (history.length > 0 && history[0].time < cutoff) {
            history.shift();
            modified = true;
        }
        if (modified) saveToLocalStorage();

        ctx.clearRect(0, 0, width, height);

        // Hintergrund (Siemens-Dunkelgrau)
        ctx.fillStyle = 'rgba(38, 39, 41, 0.85)';
        ctx.fillRect(0, 0, width, height);

        // Gitternetz
        ctx.strokeStyle = 'rgba(179, 182, 185, 0.15)';
        ctx.lineWidth = 1;
        const gridStepsY = 4;
        for (let i = 0; i <= gridStepsY; i++) {
            const y = (height / gridStepsY) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        if (history.length > 0) {
            // Y-Achse zentrieren
            const durations = history.map(h => h.duration);
            const minVal = Math.min(...durations);
            const maxVal = Math.max(...durations);
            const avgVal = durations.reduce((a, b) => a + b, 0) / durations.length;

            let minY, maxY;
            const spread = maxVal - minVal;
            if (spread < 4.0) {
                minY = Math.max(0, avgVal - 7.5);
                maxY = avgVal + 7.5;
            } else {
                minY = Math.max(0, minVal - (spread * 0.2));
                maxY = maxVal + (spread * 0.2);
            }

            if (maxY - minY < 5.0) {
                maxY = minY + 5.0;
            }

            const maxAge = maxTimeSeconds;
            const logBaseFactor = 15.0;

            const getLogX = (itemTime) => {
                const ageSeconds = Math.max(0, (now - itemTime) / 1000);
                const normalizedAge = Math.min(1.0, ageSeconds / maxAge);
                const skewedX = Math.log(1 + normalizedAge * logBaseFactor) / Math.log(1 + logBaseFactor);
                return width - (skewedX * width);
            };

            // Neon Linie
            if (history.length > 1) {
                ctx.save();
                ctx.shadowColor = 'rgba(0, 164, 228, 0.9)';
                ctx.shadowBlur = 12;
                ctx.strokeStyle = '#00a4e4';
                ctx.lineWidth = 2.5;

                ctx.beginPath();
                history.forEach((item, index) => {
                    const x = getLogX(item.time);
                    const y = height - ((item.duration - minY) / (maxY - minY)) * (height - 30) - 15;

                    if (index === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                });
                ctx.stroke();
                ctx.restore();
            }

            // Datenpunkte
            history.forEach((item) => {
                const x = getLogX(item.time);
                const y = height - ((item.duration - minY) / (maxY - minY)) * (height - 30) - 15;
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(x, y, 4.0, 0, Math.PI * 2);
                ctx.fill();
            });

            // Durchschnitt anzeigen
            const avgText = `⌀ ${avgVal.toFixed(1)}s`;

            ctx.font = 'bold 28px "Segoe UI", sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';

            ctx.lineWidth = 4;
            ctx.strokeStyle = '#000000';
            ctx.strokeText(avgText, width - 20, 15);

            ctx.fillStyle = '#ffffff';
            ctx.fillText(avgText, width - 20, 15);
        }

        texture.needsUpdate = true;
    };

    return {
        mesh: mesh,
        registerCycle: (currentCounter) => {
            const nowPerf = performance.now();
            const nowReal = Date.now();

            // --- RESET-BEHANDLUNG: Wenn Zähler 0 ist oder zurückgesetzt wurde ---
            // Wir behalten die Historie, setzen aber den Zähler und die Startzeit zurück, 
            // ohne einen neuen Takt-Datenpunkt zu erzwingen.
            if (currentCounter === 0 || (lastCounterValue !== null && currentCounter < lastCounterValue)) {
                lastCounterValue = currentCounter;
                lastCycleRealTime = nowReal;
                saveToLocalStorage();
                return;
            }

            if (lastCounterValue === null) {
                lastCounterValue = currentCounter;
                lastCycleRealTime = nowReal;
                saveToLocalStorage();
                return;
            }

            if (currentCounter > lastCounterValue) {
                const cycleDuration = (nowReal - lastCycleRealTime) / 1000;
                lastCycleRealTime = nowReal;
                lastCounterValue = currentCounter;

                // Alles unter 3 Sekunden wird ignoriert
                if (cycleDuration >= 3.0 && cycleDuration < 300) { 
                    history.push({
                        time: nowPerf,
                        duration: cycleDuration,
                        realTime: nowReal
                    });
                    saveToLocalStorage();
                }
            }
        },
        tick: () => {
            updateAndDraw();
        }
    };
}