# Track data (JSON)

Track definitions are stored as JSON files in the `data/` folder. On startup the game loads `data/track.json`.  
Use `?track=filename` to load a different file: `data/filename.json`.

## Format

| Field | Type | Description |
|-------|------|--------------|
| `name` | string | Optional track name |
| `segmentCount` | number | Number of segments (e.g. 2000) |
| `startSegmentCount` | number | First N segments as start strip (bright road), e.g. 6 |
| `curves` | array | Curves: `{ "start": 100, "end": 300, "strength": 1.5 }` (strength &lt; 0 = right) |
| `hills` | array | Hills/valleys: `{ "start": 150, "end": 400, "amplitude": 15000 }` (amplitude &lt; 0 = valley) |
| `ramps` | array | Ramps (jump sections), see `track.json` |
| `zones` | array | Optional: `type` = `"nature"`, `"city"`, `"desert"`, `"snow"`, `"ice"`, `"iceland_green"` (snow/ice/green as in Iceland) |

All `start`/`end` values are segment indices (0 to segmentCount−1).  
Examples: `data/track.json` = default (2000). `data/desert.json` = desert (2800). `data/iceland.json` = Iceland (5000, snow/ice/green, many curves and hills). Load the Iceland track with `?track=iceland`.
