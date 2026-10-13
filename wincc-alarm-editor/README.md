# WinCC Unified Meldungseditor

Windows-Programm zum komfortablen Erfassen von **Bitmeldungen** (Discrete Alarms) und
**Analogmeldungen** (Analog Alarms) für **SIMATIC WinCC Unified** (TIA Portal V21).
Die Meldungen werden als Excel-Datei gespeichert, die das TIA Portal im Editor
**HMI-Meldungen** direkt importieren kann.

## Download

Die fertige `WinCCAlarmEditor.exe` wird bei jedem Push automatisch von GitHub Actions gebaut:
*Actions → „WinCC Meldungseditor“ → letzter Lauf → Artefakt `WinCCAlarmEditor-win-x64`.*
Die EXE läuft ohne Installation und ohne vorinstalliertes .NET (Windows 10/11, 64 Bit).

## Arbeitsablauf mit dem TIA Portal

1. **Vorlage exportieren** – im TIA Portal das HMI-Gerät öffnen → *HMI-Meldungen* →
   Schaltfläche *Exportieren*. Am besten vorher eine Bit- und eine Analogmeldung von Hand
   anlegen, damit beide Blätter mit allen Spalten in der Datei stehen.
2. **Im Meldungseditor öffnen** (*Öffnen…* oder Datei aufs Fenster ziehen).
   Der Editor übernimmt die Spaltenüberschriften, Sprachen und alle Spalten, die er selbst
   nicht kennt (z. B. Begleitwerte, Quittiereinstellungen) – sie werden unverändert zurückgeschrieben.
   Neue Meldungen erhalten bei solchen Spalten automatisch den Wert, den alle vorhandenen Meldungen haben.
3. **Meldungen erfassen** – direkt in der Tabelle, per Kopieren/Einfügen aus Excel oder mit *Serie erzeugen…*.
4. **Speichern** – vor dem Speichern wird automatisch geprüft (doppelte IDs/Namen,
   fehlende Trigger-Variablen, doppelt belegte Bits …).
5. **Im TIA Portal importieren** – *HMI-Meldungen* → *Importieren* → gespeicherte Datei wählen.

> Ohne Vorlage (Schaltfläche *Neu*) schreibt der Editor Standardüberschriften
> (`ID`, `Name`, `Alarm text [de-DE], Alarm text`, `Alarm class`, `Trigger tag`, `Trigger bit` …).
> Da sich die genauen Überschriften je nach TIA-Version unterscheiden können, ist der Weg
> über eine eigene Exportdatei der sicherste.

## Funktionen

| Funktion | Bedienung |
|---|---|
| Neue Meldung (übernimmt Variable, nächstes Bit, Meldeklasse der Auswahl) | *+ Meldung* / Strg+Einfg |
| Meldungen kopieren | *Duplizieren* / Strg+D |
| Löschen | *Löschen* / Entf |
| Tabelle aus Excel einfügen (ab aktueller Zelle, fehlende Zeilen werden angelegt) | Strg+V |
| Tabelle nach Excel kopieren | Strg+C |
| IDs in angezeigter Reihenfolge neu vergeben | *IDs neu nummerieren* |
| Mehrsprachige Meldetexte | *+ Sprache* (z. B. `en-US`) |
| Prüfung, Doppelklick springt zur Meldung | *Prüfen* / F5 |

### Serie erzeugen

Erzeugt viele Bitmeldungen auf einmal, z. B. 64 Meldungen aus vier Alarmwörtern:

| Feld | Beispiel |
|---|---|
| Anzahl | `64` |
| Trigger-Variable | `"DB_HMI".Alarme[{w}]` |
| Bits pro Variable | `16` |
| Name-Muster | `Stoerung_{n:000}` |
| Text-Muster | `Störung {n}` |

Platzhalter: `{n}` laufende Nummer, `{id}` Meldungs-ID, `{w}` Variablen-Index, `{bit}` Bitnummer;
Formatangaben wie `{n:000}` sind möglich. Optional kann eine Liste mit Meldetexten (eine Zeile pro
Meldung, z. B. aus Excel kopiert) eingefügt werden – die Anzahl passt sich dann automatisch an.

## Selbst bauen

Voraussetzung: .NET 8 SDK unter Windows (oder Visual Studio 2022).

```powershell
cd wincc-alarm-editor
dotnet test WinCCAlarmEditor.sln
dotnet run --project src/WinCCAlarmEditor
# einzelne EXE:
dotnet publish src/WinCCAlarmEditor -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -o publish
```

## Aufbau

- `src/WinCCAlarmEditor.Core` – Datenmodell, Excel-Import/-Export (ClosedXML), Prüfung, Seriengenerator
- `src/WinCCAlarmEditor` – WPF-Oberfläche
- `tests/WinCCAlarmEditor.Tests` – xUnit-Tests für die Core-Bibliothek
