# Streckendaten (JSON)

Strecken werden als JSON-Dateien im Ordner `data/` abgelegt. Beim Start lädt das Spiel `data/track.json`.  
Mit `?track=dateiname` kann eine andere Datei geladen werden: `data/dateiname.json`.

## Format

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `name` | string | Optionaler Streckenname |
| `segmentCount` | number | Anzahl Segmente (z. B. 2000) |
| `startSegmentCount` | number | Erste N Segmente als Startbereich (helle Fahrbahn), z. B. 6 |
| `curves` | array | Kurven: `{ "start": 100, "end": 300, "strength": 1.5 }` (strength &lt; 0 = rechts) |
| `hills` | array | Hügel/Täler: `{ "start": 150, "end": 400, "amplitude": 15000 }` (amplitude &lt; 0 = Tal) |
| `ramps` | array | Rampen (Sprungschanzen), siehe `track.json` |
| `zones` | array | Optional: `type` = `"nature"`, `"city"`, `"desert"`, `"snow"`, `"ice"`, `"iceland_green"` (Schnee/Eis/Grün wie in Island) |

Alle `start`/`end`-Werte beziehen sich auf Segment-Indizes (0 bis segmentCount−1).  
Beispiele: `data/track.json` = Standard (2000). `data/desert.json` = Wüste (2800). `data/iceland.json` = Island (5000, Schnee/Eis/Grün, viele Kurven und Hügel). Mit `?track=iceland` die Island-Strecke laden.
