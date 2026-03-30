# Architecture (game.js)

English overview of where logic lives. The authoritative map is the banner at the top of `game.js` and the `// --- Section ---` comments inside the file.

## Boot

1. `loadTrackData()` fetches `data/track.json` or `data/<name>.json` from `?track=`.
2. `buildRoad(trackData)` fills `segments` (curve, height, sprites, colors) and `cars` (10 opponents).
3. `requestAnimationFrame(update)` starts the loop.

## One frame (`update` → `render`)

1. **Timing**: `dtRaw` / `dt60` clamped delta for frame-rate–independent physics.
2. **Early exits**: If `raceOver`, only engine sound + `render`. If `isCrashed`, spin/fall until grounded, then reset state and invulnerability timestamp.
3. **Lap wrap**: When `position` exceeds track length, increment lap; player wins race at `RACE_LAPS`.
4. **Collisions**: `checkStaticObstacleCollision(trackState)` then `updateNPCsAndCheckCollision(trackState, dt60)` (unless crashed).
5. **“In air”**: Computed with `getTrackState(position + speed*dt)` so speed/slope use the *next* road sample; hysteresis avoids flicker.
6. **Player physics** (ground vs air): handbrake, shoulders, gear/redline, throttle/brake/coast, drag, slope, ramp launch, vertical gravity/landing, curve force, steering inertia.
7. **`render()`**: Clear, parallax sky, project ~300 segments forward, collect sprites, draw road back-to-front, draw sprites, rear mirror, player car, HUD.

## Data model

- **`segments[i]`**: World `z = i * segmentLength`, `y` elevation, `curve`, `sprites[]`, `cars[]` (populated each frame for drawing), `color`, `rampTakeoff`.
- **Player**: `position`, `playerX`, `playerY`, `playerVelY`, `speed`, `currentGear`, etc.
- **Opponent `cars[i]`**: `z`, `offset`, `speed`, `lap`, AI tuning fields, crash/air fields.

## Key functions

| Function | Role |
|----------|------|
| `getTrackState(pos)` | Segment index, interpolation, road height at `pos`. |
| `curveForceMagnitude` | Shared lateral push from curve × speed² (player + NPC). |
| `project` / `projectRear*` | Perspective to screen (forward view vs mirror). |
| `drawQuad` | Road/rumble trapezoids between projected segments. |
| `drawProceduralSprite` | Canvas-drawn props and NPC cars. |
| `render` | Full scene + HUD. |
| `update` | Main loop entry. |

## Files

| File | Role |
|------|------|
| `run.html` | Canvas, touch controls, loads `game.js`. |
| `style.css` | Layout and touch UI. |
| `data/*.json` | Track definitions (see `data/README.md`). |
