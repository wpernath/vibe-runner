# Running Out

A classic **OutRun-style 2.5D arcade racer** in the browser. One HTML file, one script, no frameworks—just canvas, keyboard, and the Web Audio API.

---

## The Game

You drive a red sports car on a closed track with curves, hills, ramps, and zones (e.g. **countryside**, **city**, **desert**). Race **10 AI opponents**—first to complete **3 laps** wins. Opponents start with you (staggered), use the same arcade physics, and stay on the road.

### Features

- **Race mode**: 10 opponents, first to 3 laps wins. Live position (e.g. POS: 2/11) and lap counter (LAP: 1/3).
- **Manual gearbox**: 6 gears; shift up **Q**, down **A**. Top speed 250 km/h in 6th gear.
- **Analog gauges**: RPM (redline) and speedometer, plus digital readouts and current gear.
- **Handbrake**: **Left Shift** to slide through corners (reduced grip, extra centrifugal force).
- **Jumps**: Ramps launch you into the air; speed is preserved in the air, pitch (up/down keys) slightly affects the arc.
- **Rear-view mirror**: Top-center mirror shows the track and cars behind you.
- **Procedural engine sound**: Pitch and volume follow RPM and throttle (no audio files).
- **Crash**: Hit obstacles or opponents at high speed to crash; you reset after falling, with brief invulnerability.
- **Track data**: Default track from `data/track.json`; use `?track=desert` or `?track=iceland` to load other JSON tracks (see [data/README.md](data/README.md)).

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

- **Single-file game loop**: `game.js` holds constants, state, audio, track loading/generation, 3D projection, drawing, collision, AI opponents, and the main `update()` loop. No build step, no dependencies.
- **Fake 3D**: The track is a list of segments (curve, height, sprites). Each segment is projected from 3D to 2D with a simple perspective formula; grass, rumble, and road are drawn as trapezoids. Sprites (trees, buildings, signs) and opponent cars are drawn procedurally with the Canvas 2D API.
- **Audio**: Engine and crash sounds are generated with the Web Audio API. Audio starts after the first key press (browser autoplay rules).
- **Track**: Loaded from JSON in `data/` (e.g. `track.json`). Segments define curves, hills, ramps, and zones; opponents and the player share the same arcade physics (curve force, slope, aero, shoulder). Rear-view mirror uses a backward projection over the same segment list.
- **Code map**: See the file header and section comments in [`game.js`](game.js), and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a frame-by-frame overview.

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

### Option 3: On the network (phone/tablet)

To test on a phone or tablet on the same Wi‑Fi:

1. From the project root, run `./serve.sh` (optionally with a port: `./serve.sh 3000`).
2. Open the printed URL (e.g. `http://192.168.1.42:8080/run.html`) in the device’s browser.
3. Stop the server with Ctrl+C.

### Option 4: Docker

Build and run as a container (e.g. for deployment):

```bash
docker build -t runningout:latest .
docker run -p 8080:8080 runningout:latest
```

Open `http://localhost:8080/run.html`. The image runs as non-root and listens on port 8080 for easy deployment on **OpenShift**; see [openshift/README.md](openshift/README.md).

### Requirements

- A browser with JavaScript enabled and support for Canvas 2D and the Web Audio API (all current desktop and mobile browsers).
- Keyboard or touch controls (on mobile devices).

---

## Build pipeline

- **GitHub Actions**: On push to `main`/`master`, the [Docker build workflow](.github/workflows/docker-build.yml) builds the image and pushes it to GitHub Container Registry (`ghcr.io/<owner>/<repo>`).
- **OpenShift**: Use the manifests in `openshift/` to deploy (Deployment, Service, Route). The image is OpenShift-friendly (non-root, port 8080, `/health` for probes).

---

## Project Structure

```
runningout/
├── run.html       # Entry page; canvas + script tag
├── game.js        # Game logic, rendering, audio, AI opponents
├── style.css      # Layout and canvas styling
├── data/          # Track JSON (track.json, desert.json, etc.; see data/README.md)
├── Dockerfile     # Container image (nginx, port 8080)
├── nginx.conf     # Nginx config for container
├── serve.sh       # Local server for network access (phone/tablet)
├── .github/       # CI: Docker build on push
├── openshift/     # Deployment manifests for OpenShift
├── README.md      # This file
└── LICENSE        # License terms
```

---

## License

See [LICENSE](LICENSE) in this repository.
