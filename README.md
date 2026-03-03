# Running Out

A classic **OutRun-style 2.5D arcade racer** in the browser. One HTML file, one script, no frameworks—just canvas, keyboard, and the Web Audio API.

---

## The Game

You drive a red sports car along an endless track with curves, hills, and two alternating zones: **countryside** (trees, curves) and **city** (buildings, streetlights). Traffic moves in your direction; avoid crashing to keep your lap time running.

### Features

- **Manual gearbox**: 6 gears; shift up with **Q**, down with **A**. Top speed (250 km/h) only in 6th gear.
- **Analog gauges**: RPM (with redline) and speedometer, plus digital readouts and current gear.
- **Handbrake**: Hold **Left Shift** to slide through corners (reduced grip, extra centrifugal force).
- **Procedural engine sound**: Pitch and volume follow RPM and throttle (no audio files).
- **Crash**: Hit obstacles or traffic at high speed to trigger a crash with sound; you reset after falling. Short invulnerability after reset to avoid crash loops.
- **Lap timing**: Lap counter and lap time; crossing the finish line starts a new lap and wraps the track.

### Controls

| Input        | Action           |
|-------------|------------------|
| **Arrow Up**   | Accelerate       |
| **Arrow Down** | Brake            |
| **Arrow Left / Right** | Steer    |
| **Q**          | Shift up         |
| **A**          | Shift down       |
| **Left Shift** | Handbrake (slide)|

---

## What This Code Is

- **Single-file game loop**: `game.js` (~870 lines) holds constants, state, audio, track generation, 3D projection, drawing, collision, and the main `update()` loop. No build step, no dependencies.
- **Fake 3D**: The track is a list of segments (curve, height, sprites). Each segment is projected from 3D world space to 2D screen space with a simple perspective formula; then grass, rumble, and road are drawn as trapezoids. Sprites (trees, buildings, signs, NPC cars) are drawn procedurally with the Canvas 2D API.
- **Audio**: Engine and crash sounds are generated with the Web Audio API (oscillators, gain, noise buffers). Audio starts after the first key press (browser autoplay rules).
- **Track**: 2000 segments generated once in `buildRoad()` with fixed curve/hill patterns and alternating nature/city zones. NPC cars are placed randomly and drive along the same road.

---

## Install and Play

### Option 1: Open the HTML file

1. Clone or download this repository.
2. Open `run.html` in a modern browser (Chrome, Firefox, Safari, Edge).
3. Click or focus the page and press any key to start engine sound (optional).
4. Use the controls above to drive.

No server or install step required. Everything runs from the local files.

### Option 2: Local web server (if needed)

Some browsers restrict file access when opening `file://` directly. If the game does not load or assets are blocked:

1. From the project root, start a simple HTTP server, for example:
   - **Python 3**: `python3 -m http.server 8000`
   - **Node (npx)**: `npx serve -p 8000`
2. Open `http://localhost:8000/run.html` in your browser.

### Requirements

- A browser with JavaScript enabled and support for Canvas 2D and the Web Audio API (all current desktop and mobile browsers).
- Keyboard (no touch/mobile controls are implemented).

---

## Project Structure

```
runningout/
├── run.html    # Entry page; canvas + script tag
├── game.js     # Full game logic, rendering, audio
├── style.css   # Layout and canvas styling
├── README.md   # This file
└── LICENSE     # License terms
```

---

## License

See [LICENSE](LICENSE) in this repository.
