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
| `zones` | array | Optional: `{ "start": 0, "end": 500, "type": "nature" }` oder `"city"` (Bäume vs. Häuser/Laternen) |

Alle `start`/`end`-Werte beziehen sich auf Segment-Indizes (0 bis segmentCount−1).  
Beispiel: `data/track.json` entspricht der eingebauten Standardstrecke.
