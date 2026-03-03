const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const width = canvas.width;
const height = canvas.height;

// --- Spielvariablen ---
let position = 0;
let playerX = 0;
let speed = 0;
let playerY = 0;
let playerVelY = 0;
let skyOffset = 0;

// Crash-Variablen
let isCrashed = false;
let crashRot = 0;
let crashSpinSpeed = 0;

const maxSpeed = 250;
const segmentLength = 200;
const cameraDepth = 0.84;
const cameraHeight = 1200;
const roadWidth = 3000;

// Kollision & Crash-Konstanten
const CRASH_RESET_GROUND_OFFSET = 100;
const CRASH_SPEED_THRESHOLD = 50;
const COLLISION_Z_RANGE = 250;
const COLLISION_Z_OFFSET = 300;
const COLLISION_PLAYER_CAR_X = 0.3;
/** Z-Reichweite für Kollision mit statischen Sprites (Bäume, Gebäude, …) */
const COLLISION_STATIC_Z_RANGE = 280;

// Seitenstreifen (ab |playerX| > ROAD_EDGE)
const ROAD_EDGE = 1.1;
const SHOULDER_MAX_SPEED = 80;
const SHOULDER_ACCEL = 0.2;

// Lenkung & Kurven
const CURVE_FORCE_DIVISOR = 24000;
const STEERING_FACTOR = 0.032;
// Fliehkraft erst ab dieser Geschwindigkeit voll (darunter linear abgeschwächt), damit man aus dem Grünstreifen rauskommt
const CURVE_FORCE_SPEED_THRESHOLD = 60;
// Mindest-Lenkwirkung (Anteil), damit bei niedriger Geschwindigkeit noch gelenkt werden kann
const STEERING_MIN_FACTOR = 0.25;

// Schubabschaltung (kein Gas): Verzögerung pro Frame
const COAST_DECEL = 0.4;

// --- Getriebe (manuell) ---
const NUM_GEARS = 6;
/** Maximalgeschwindigkeit pro Gang (nur im höchsten Gang wird maxSpeed erreicht) */
const GEAR_MAX_SPEEDS = [45, 90, 135, 180, 215, 250];
/** Unterhalb dieser Geschwindigkeit (km/h) im jeweiligen Gang nur stark reduzierte Beschleunigung („nicht anfahren“) */
const GEAR_MIN_SPEEDS = [0, 18, 38, 58, 85, 115];
const RPM_REDLINE = 7000;
const RPM_IDLE = 800;

let currentGear = 1;

let segments = [];
let cars = [];

// --- HUD & UI Variablen ---
let currentLap = 1;
let currentLapTime = 0;
let lastLapTime = 0;
let lapStartTime = Date.now();

let keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };

// --- Motorsound (Web Audio API, prozedural) ---
let engineSoundReady = false;
let engineGainNode = null;
let engineOsc1 = null;
let engineOsc2 = null;
let engineFilter = null;

function startEngineSound() {
    if (engineSoundReady) return;
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        if (ctx.state === 'suspended') ctx.resume();

        engineGainNode = ctx.createGain();
        engineGainNode.gain.value = 0;
        engineGainNode.connect(ctx.destination);

        engineOsc1 = ctx.createOscillator();
        engineOsc1.type = 'sawtooth';
        engineOsc1.frequency.value = 40;
        engineOsc1.connect(engineGainNode);
        engineOsc1.start(0);

        engineOsc2 = ctx.createOscillator();
        engineOsc2.type = 'square';
        engineOsc2.frequency.value = 60;
        const osc2Gain = ctx.createGain();
        osc2Gain.gain.value = 0.25;
        engineOsc2.connect(osc2Gain);
        osc2Gain.connect(engineGainNode);
        engineOsc2.start(0);

        engineFilter = ctx.createBiquadFilter();
        engineFilter.type = 'lowpass';
        engineFilter.frequency.value = 400;
        engineFilter.Q.value = 0.7;
        engineGainNode.disconnect();
        engineGainNode.connect(engineFilter);
        engineFilter.connect(ctx.destination);

        engineSoundReady = true;
    } catch (_) { engineSoundReady = false; }
}

function updateEngineSound(rpm, throttle) {
    if (!engineSoundReady || !engineGainNode || !engineOsc1 || !engineOsc2) return;
    const baseFreq = 0.012 * rpm + 25;
    engineOsc1.frequency.setTargetAtTime(baseFreq, 0, 0.02);
    engineOsc2.frequency.setTargetAtTime(baseFreq * 1.5, 0, 0.02);
    if (engineFilter) engineFilter.frequency.setTargetAtTime(200 + 0.04 * rpm, 0, 0.02);
    const vol = isCrashed ? 0 : (0.08 + 0.12 * throttle + 0.002 * (rpm / 1000));
    engineGainNode.gain.setTargetAtTime(Math.min(0.35, vol), 0, 0.03);
}

window.addEventListener('keydown', e => {
    startEngineSound();
    if (e.code === 'KeyQ') {
        if (currentGear < NUM_GEARS) currentGear++;
        e.preventDefault();
        return;
    }
    if (e.code === 'KeyA') {
        if (currentGear > 1) {
            currentGear--;
            speed = Math.min(speed, GEAR_MAX_SPEEDS[currentGear - 1]);
        }
        e.preventDefault();
        return;
    }
    if (e.code in keys) {
        keys[e.code] = true;
        e.preventDefault();
    }
});
window.addEventListener('keyup', e => keys[e.code] = false);

const COLORS = {
    DARK: { road: '#5b5b5b', grass: '#10AA10', rumble: '#555' },
    LIGHT: { road: '#696969', grass: '#009A00', rumble: '#FFF' },
    START: { road: '#FFF', grass: '#FFF', rumble: '#111' },
    SKY_TOP: '#1E90FF', SKY_BOTTOM: '#72D7EE',
    MOUNTAIN_1: '#3E4E6E', MOUNTAIN_2: '#2E3E5E',
    CLOUD: 'rgba(255, 255, 255, 0.3)'
};

// --- Strecke generieren ---
function buildRoad() {
    segments = [];
    for (let n = 0; n < 2000; n++) {
        let curve = 0;
        let y = 0;
        let color = Math.floor(n / 3) % 2 ? COLORS.DARK : COLORS.LIGHT;

        if (n < 6) color = COLORS.START;

        if (n > 100 && n < 300) curve = 1.5;
        if (n > 400 && n < 600) curve = -3.5;
        if (n > 700 && n < 900) curve = 3.0;
        if (n > 1200 && n < 1400) curve = -2.5;

        if (n > 150 && n < 400) y = Math.sin((n - 150) / 250 * Math.PI) * 15000;
        if (n > 450 && n < 700) y = -Math.sin((n - 450) / 250 * Math.PI) * 12000;
        if (n > 800 && n < 1300) y = Math.sin((n - 800) / 500 * Math.PI) * 35000;

        let segmentSprites = [];

        let zone = Math.floor(n / 500) % 2; // 0 = Natur, 1 = Stadt

        if (zone === 0) {
            if (n % 5 === 0) {
                let side = Math.random() > 0.5 ? 1 : -1;
                let treeType = Math.random() > 0.5 ? 'TREE_PINE' : 'TREE_LEAFY';
                segmentSprites.push({ type: treeType, offset: side * (1.6 + Math.random() * 1.2) });
            }
        } else {
            if (n % 3 === 0) {
                for (let side of [-1, 1]) {
                    let heightScale = 0.7 + Math.random() * 0.8;
                    let bColor = `hsl(${Math.floor(Math.random() * 50)}, ${Math.floor(Math.random() * 30)}%, ${25 + Math.floor(Math.random() * 35)}%)`;
                    let winStyle = Math.random() > 0.5 ? 0 : 1;
                    segmentSprites.push({
                        type: 'BUILDING',
                        offset: side * (1.8 + Math.random() * 0.3),
                        data: { hScale: heightScale, color: bColor, winStyle: winStyle, seed: n * 10 + (side === 1 ? 5 : 0) }
                    });
                }
            }
            if (n % 4 === 0) {
                segmentSprites.push({ type: 'STREETLIGHT', offset: -1.3 });
                segmentSprites.push({ type: 'STREETLIGHT', offset: 1.3 });
            }
        }

        if (n % (zone === 0 ? 40 : 80) === 0 && Math.abs(curve) > 1) {
            segmentSprites.push({ type: 'SIGN', offset: curve > 0 ? -2.0 : 2.0 });
        }

        segments.push({
            z: n * segmentLength,
            y: y,
            curve: curve,
            sprites: segmentSprites,
            cars: [],
            color: color,
            p1: { x: 0, y: 0, w: 0 }
        });
    }

    cars = [];
    for (let i = 0; i < 100; i++) {
        let isOpposite = Math.random() > 0.8;
        cars.push({
            z: Math.random() * (2000 * segmentLength),
            offset: isOpposite ? (-0.85 + Math.random() * 0.6) : (0.25 + Math.random() * 0.6),
            speed: 40 + Math.random() * 60,
            dir: isOpposite ? -1 : 1,
            color: `hsl(${Math.floor(Math.random() * 360)}, 80%, 50%)`
        });
    }
}

function project(p, worldX, worldY, worldZ, camX, camY, camZ) {
    let z = Math.max(1, worldZ - camZ);
    let scale = cameraDepth / z;
    p.x = Math.round(width / 2 + (scale * (worldX - camX) * width / 2));
    p.y = Math.round(height / 2 - (scale * (worldY - camY) * height / 2));
    p.w = Math.round(scale * roadWidth * width / 2);
}

function drawQuad(color, x1, y1, w1, x2, y2, w2) {
    ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(x1 - w1, y1); ctx.lineTo(x2 - w2, y2);
    ctx.lineTo(x2 + w2, y2); ctx.lineTo(x1 + w1, y1);
    ctx.fill();
}

function drawParallaxLayers(horizonY) {
    let gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, COLORS.SKY_TOP); gradient.addColorStop(1, COLORS.SKY_BOTTOM);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);

    let cloudBaseY = horizonY - 250;
    let cloudScrollX = skyOffset * 0.2;
    ctx.fillStyle = COLORS.CLOUD;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 20) {
        let cloudHeight = Math.sin((x + cloudScrollX) * 0.005) * 30 + Math.sin((x + cloudScrollX * 1.5) * 0.01) * 15;
        let y = cloudBaseY - cloudHeight;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineTo(width, horizonY - 50); ctx.lineTo(0, horizonY - 50); ctx.fill();

    let mountainScrollX = skyOffset * 0.6;
    ctx.fillStyle = COLORS.MOUNTAIN_2;
    ctx.beginPath(); ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 25) {
        let mHeight = Math.sin((x + mountainScrollX * 0.8) * 0.004) * 80 + Math.sin((x + mountainScrollX * 1.2) * 0.009) * 40;
        ctx.lineTo(x, horizonY - 50 - mHeight);
    }
    ctx.lineTo(width, height); ctx.fill();

    ctx.fillStyle = COLORS.MOUNTAIN_1;
    ctx.beginPath(); ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 15) {
        let mHeight = Math.sin((x + mountainScrollX) * 0.005) * 60 + Math.sin((x + mountainScrollX * 1.7) * 0.015) * 25;
        mHeight += Math.sin((x + mountainScrollX) * 0.1) * 5;
        ctx.lineTo(x, horizonY - 20 - mHeight);
    }
    ctx.lineTo(width, height); ctx.fill();
}

function drawProceduralSprite(spriteObj, destX, destY, destW, clipY) {
    let s = destW * 0.001;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, clipY); ctx.clip();

    if (spriteObj.type === 'TREE_PINE') {
        let treeW = 200 * s, treeH = 400 * s;
        ctx.fillStyle = '#6B4226'; ctx.fillRect(destX - treeW / 6, destY - treeH / 4, treeW / 3, treeH / 4);
        ctx.fillStyle = '#1E691E'; ctx.beginPath(); ctx.moveTo(destX, destY - treeH); ctx.lineTo(destX - treeW / 2, destY - treeH / 4); ctx.lineTo(destX + treeW / 2, destY - treeH / 4); ctx.fill();
    } else if (spriteObj.type === 'TREE_LEAFY') {
        let treeW = 250 * s; let treeH = 350 * s;
        ctx.fillStyle = '#8B5A2B'; ctx.fillRect(destX - treeW / 8, destY - treeH / 3, treeW / 4, treeH / 3);
        ctx.fillStyle = '#228B22'; ctx.beginPath();
        ctx.arc(destX, destY - treeH * 0.8, treeW * 0.35, 0, Math.PI * 2);
        ctx.arc(destX - treeW * 0.25, destY - treeH * 0.5, treeW * 0.3, 0, Math.PI * 2);
        ctx.arc(destX + treeW * 0.25, destY - treeH * 0.5, treeW * 0.3, 0, Math.PI * 2); ctx.fill();
    } else if (spriteObj.type === 'BUILDING') {
        let bData = spriteObj.data;
        let bW = 350 * s;
        let bH = 600 * s * bData.hScale;
        let baseX = destX - bW / 2;
        let baseY = destY - bH;
        ctx.fillStyle = bData.color; ctx.fillRect(baseX, baseY, bW, bH);
        ctx.fillStyle = '#FDFDA4';
        let winSize = 25 * s; let winGap = 20 * s;
        if (bData.winStyle === 0) {
            let gridY = 0;
            for (let wy = baseY + winGap; wy < destY - winGap * 2; wy += winSize + winGap, gridY++) {
                let gridX = 0;
                for (let wx = baseX + winGap; wx < baseX + bW - winGap; wx += winSize + winGap, gridX++) {
                    if ((((bData.seed || 0) + gridX * 31 + gridY * 17) % 10) < 2) ctx.fillRect(wx, wy, winSize, winSize);
                }
            }
        } else {
            for (let wx = baseX + winGap; wx < baseX + bW - winGap; wx += winSize + winGap * 1.5) {
                ctx.fillRect(wx, baseY + winGap, winSize, bH - winGap * 3);
            }
        }
        ctx.fillStyle = '#222'; ctx.fillRect(baseX - 5 * s, baseY, bW + 10 * s, 15 * s);
    } else if (spriteObj.type === 'STREETLIGHT') {
        let poleH = 450 * s; let poleW = 15 * s; let lampW = 60 * s;
        ctx.fillStyle = '#888'; ctx.fillRect(destX - poleW / 2, destY - poleH, poleW, poleH);
        ctx.fillStyle = '#DDD'; ctx.fillRect(destX - lampW / 2, destY - poleH, lampW, 15 * s);
        ctx.fillStyle = '#FFFFAA'; ctx.beginPath(); ctx.ellipse(destX, destY - poleH + 10 * s, lampW / 2, 10 * s, 0, 0, Math.PI * 2); ctx.fill();
    } else if (spriteObj.type === 'SIGN') {
        let signW = 120 * s, signH = 80 * s, poleH = 200 * s, poleW = 10 * s;
        ctx.fillStyle = '#555'; ctx.fillRect(destX - poleW / 2, destY - poleH, poleW, poleH);
        ctx.fillStyle = '#EEE'; ctx.fillRect(destX - signW / 2, destY - poleH - signH, signW, signH);
        ctx.fillStyle = '#D00'; ctx.fillRect(destX - signW / 2 + 5 * s, destY - poleH - signH + 5 * s, signW - 10 * s, signH - 10 * s);
        ctx.fillStyle = '#EEE'; ctx.fillRect(destX - signW / 2 + 15 * s, destY - poleH - signH + 15 * s, signW - 30 * s, signH - 30 * s);
    } else if (spriteObj.type === 'NPC_CAR') {
        let car = spriteObj.data; let carW = 140 * s; let carH = 70 * s;
        ctx.fillStyle = '#111'; ctx.fillRect(destX - carW / 2.2, destY - carH / 4, carW / 4, carH / 2); ctx.fillRect(destX + carW / 2.2 - carW / 4, destY - carH / 4, carW / 4, carH / 2);
        ctx.fillStyle = car.color; ctx.fillRect(destX - carW / 2, destY - carH, carW, carH * 0.8);
        ctx.fillStyle = '#333'; ctx.fillRect(destX - carW / 3, destY - carH + carH * 0.1, carW * 0.66, carH * 0.3);
        if (car.dir === -1) ctx.fillStyle = '#FFFDE7'; else ctx.fillStyle = '#D00';
        ctx.fillRect(destX - carW / 2 + 5 * s, destY - carH * 0.4, 25 * s, 12 * s); ctx.fillRect(destX + carW / 2 - 30 * s, destY - carH * 0.4, 25 * s, 12 * s);
    }
    ctx.restore();
}

function drawHUD() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fillRect(15, 15, 200, 90);

    // RPM aus Geschwindigkeit und Gang
    const gearMaxSpeed = GEAR_MAX_SPEEDS[currentGear - 1];
    const rpm = gearMaxSpeed > 0
        ? Math.min(RPM_REDLINE, RPM_IDLE + (speed / gearMaxSpeed) * (RPM_REDLINE - RPM_IDLE))
        : RPM_IDLE;

    // Analoges Drehzahlmesser (links neben dem Tacho)
    const rpmCenterX = width - 15 - 165 - 10 - 165 / 2;
    const rpmCenterY = 52;
    const rpmRadius = 42;
    const rpmBoxW = 165;
    const rpmBoxH = 78;
    ctx.fillStyle = 'rgba(20, 20, 25, 0.92)';
    ctx.fillRect(width - 15 - rpmBoxW * 2 - 10, 15, rpmBoxW, rpmBoxH);
    ctx.strokeStyle = 'rgba(80, 80, 90, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(width - 15 - rpmBoxW * 2 - 10, 15, rpmBoxW, rpmBoxH);

    ctx.strokeStyle = '#777';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(rpmCenterX, rpmCenterY, rpmRadius, Math.PI, 0, false);
    ctx.stroke();

    ctx.strokeStyle = '#BBB';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = '#E8E8E8';
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let r = 0; r <= RPM_REDLINE; r += 1000) {
        const t = r / RPM_REDLINE;
        const angle = Math.PI - t * Math.PI;
        const innerR = rpmRadius - 10;
        const outerR = rpmRadius;
        ctx.beginPath();
        ctx.moveTo(rpmCenterX + Math.cos(angle) * innerR, rpmCenterY - Math.sin(angle) * innerR);
        ctx.lineTo(rpmCenterX + Math.cos(angle) * outerR, rpmCenterY - Math.sin(angle) * outerR);
        ctx.stroke();
        const labelR = rpmRadius - 20;
        if (r % 2000 === 0 || r === RPM_REDLINE) {
            ctx.fillText(String(r / 1000) + 'k', rpmCenterX + Math.cos(angle) * labelR, rpmCenterY - Math.sin(angle) * labelR);
        }
    }

    // Roter Bereich (Redline)
    ctx.strokeStyle = 'rgba(255, 60, 60, 0.95)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(rpmCenterX, rpmCenterY, rpmRadius, Math.PI * (1 - 6000 / RPM_REDLINE), 0, false);
    ctx.stroke();

    const rpmClamped = Math.min(rpm, RPM_REDLINE);
    const rpmNeedleAngle = Math.PI - (rpmClamped / RPM_REDLINE) * Math.PI;
    const rpmNeedleLen = rpmRadius - 10;
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(rpmCenterX, rpmCenterY);
    ctx.lineTo(
        rpmCenterX + Math.cos(rpmNeedleAngle) * rpmNeedleLen,
        rpmCenterY - Math.sin(rpmNeedleAngle) * rpmNeedleLen
    );
    ctx.stroke();
    ctx.strokeStyle = rpm >= RPM_REDLINE * 0.9 ? '#FF4444' : '#FFF';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(rpmCenterX, rpmCenterY);
    ctx.lineTo(
        rpmCenterX + Math.cos(rpmNeedleAngle) * rpmNeedleLen,
        rpmCenterY - Math.sin(rpmNeedleAngle) * rpmNeedleLen
    );
    ctx.stroke();

    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(rpmCenterX, rpmCenterY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Digitale RPM-Anzeige
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(Math.round(rpm) + ' rpm', rpmCenterX, rpmCenterY + rpmRadius - 2);

    // Gang-Anzeige im RPM-Kreis
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(currentGear), rpmCenterX, rpmCenterY - 10);

    // Analoges Tacho (rechts oben)
    const tachoCenterX = width - 92;
    const tachoCenterY = 52;
    const tachoRadius = 42;
    const tachoBoxW = 165;
    const tachoBoxH = 78;
    ctx.fillStyle = 'rgba(20, 20, 25, 0.92)';
    ctx.fillRect(width - 15 - tachoBoxW, 15, tachoBoxW, tachoBoxH);
    ctx.strokeStyle = 'rgba(80, 80, 90, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(width - 15 - tachoBoxW, 15, tachoBoxW, tachoBoxH);

    ctx.strokeStyle = '#777';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(tachoCenterX, tachoCenterY, tachoRadius, Math.PI, 0, false);
    ctx.stroke();

    ctx.strokeStyle = '#BBB';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = '#E8E8E8';
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= maxSpeed; v += 50) {
        const t = v / maxSpeed;
        const angle = Math.PI - t * Math.PI;
        const innerR = tachoRadius - 10;
        const outerR = tachoRadius;
        const x1 = tachoCenterX + Math.cos(angle) * innerR;
        const y1 = tachoCenterY - Math.sin(angle) * innerR;
        const x2 = tachoCenterX + Math.cos(angle) * outerR;
        const y2 = tachoCenterY - Math.sin(angle) * outerR;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        const labelR = tachoRadius - 20;
        if (v % 100 === 0 || v === maxSpeed) {
            ctx.fillText(String(v), tachoCenterX + Math.cos(angle) * labelR, tachoCenterY - Math.sin(angle) * labelR);
        }
    }

    const speedClamped = Math.min(speed, maxSpeed);
    const needleAngle = Math.PI - (speedClamped / maxSpeed) * Math.PI;
    const needleLen = tachoRadius - 10;
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tachoCenterX, tachoCenterY);
    ctx.lineTo(
        tachoCenterX + Math.cos(needleAngle) * needleLen,
        tachoCenterY - Math.sin(needleAngle) * needleLen
    );
    ctx.stroke();
    ctx.strokeStyle = speed > 280 ? '#FF4444' : '#FFF';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(tachoCenterX, tachoCenterY);
    ctx.lineTo(
        tachoCenterX + Math.cos(needleAngle) * needleLen,
        tachoCenterY - Math.sin(needleAngle) * needleLen
    );
    ctx.stroke();

    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(tachoCenterX, tachoCenterY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Digitale Tacho-Anzeige
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(Math.round(speed) + ' km/h', tachoCenterX, tachoCenterY + tachoRadius - 2);

    // Linkes HUD (Lap, Zeit)
    ctx.fillStyle = '#FFF'; ctx.font = 'bold 20px "Courier New"'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`LAP:  ${currentLap}`, 25, 40); ctx.fillText(`TIME: ${currentLapTime.toFixed(2)}s`, 25, 65);
    if (lastLapTime > 0) { ctx.fillStyle = '#AAA'; ctx.fillText(`LAST: ${lastLapTime.toFixed(2)}s`, 25, 90); }

    if (isCrashed) {
        ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
        ctx.fillRect(0, height / 2 - 50, width, 100);
        ctx.fillStyle = '#FFF';
        ctx.textAlign = 'center';
        ctx.font = 'bold 40px "Courier New"';
        ctx.fillText("CRASHED!", width / 2, height / 2 + 15);
    }
}

function render() {
    ctx.clearRect(0, 0, width, height);

    let startPos = position / segmentLength;
    let startSegIndex = Math.floor(startPos);
    let offset = position % segmentLength;

    let camX = playerX * roadWidth;
    let camY = cameraHeight + playerY;
    let camZ = position;

    let horizonY = height / 2 + playerY * 0.05;
    drawParallaxLayers(horizonY);

    let x = 0, dx = 0, maxY = height;
    let spritesToDraw = [];

    for (let n = 0; n < 300; n++) {
        let seg = segments[(startSegIndex + n) % segments.length];
        seg.z = (startSegIndex + n) * segmentLength;

        project(seg.p1, x, seg.y, seg.z, camX, camY, camZ - (n === 0 ? offset : 0));
        let currentCurveX = x;
        x += dx; dx += seg.curve;

        for (let i = 0; i < seg.sprites.length; i++) {
            let spriteP = { x: 0, y: 0, w: 0 };
            project(spriteP, currentCurveX + seg.sprites[i].offset * roadWidth, seg.y, seg.z, camX, camY, camZ - (n === 0 ? offset : 0));
            if (spriteP.x > -1000 && spriteP.x < width + 1000) {
                spritesToDraw.push({ type: seg.sprites[i].type, data: seg.sprites[i].data, x: spriteP.x, y: spriteP.y, w: spriteP.w, clipY: maxY });
            }
        }

        for (let i = 0; i < seg.cars.length; i++) {
            let car = seg.cars[i];
            let carP = { x: 0, y: 0, w: 0 };
            let carVisualZ = seg.z + (car.z % segmentLength);
            project(carP, currentCurveX + car.offset * roadWidth, seg.y, carVisualZ, camX, camY, camZ - (n === 0 ? offset : 0));

            if (carP.x > -1000 && carP.x < width + 1000) {
                spritesToDraw.push({ type: 'NPC_CAR', data: car, x: carP.x, y: carP.y, w: carP.w, clipY: maxY });
            }
        }

        if (seg.p1.y >= maxY) continue;
        if (n > 0) {
            let prev = segments[(startSegIndex + n - 1) % segments.length];
            ctx.fillStyle = seg.color.grass; ctx.fillRect(0, seg.p1.y, width, prev.p1.y - seg.p1.y);
            drawQuad(seg.color.rumble, prev.p1.x, prev.p1.y, prev.p1.w * 1.1, seg.p1.x, seg.p1.y, seg.p1.w * 1.1);
            drawQuad(seg.color.road, prev.p1.x, prev.p1.y, prev.p1.w, seg.p1.x, seg.p1.y, seg.p1.w);
        }
        maxY = seg.p1.y;
    }

    for (let i = spritesToDraw.length - 1; i >= 0; i--) {
        drawProceduralSprite(spritesToDraw[i], spritesToDraw[i].x, spritesToDraw[i].y, spritesToDraw[i].w, spritesToDraw[i].clipY);
    }

    const carW = 130; const carH = 55;
    let carX = width / 2 - carW / 2;

    let baseSeg = segments[startSegIndex % segments.length];
    let nextSeg = segments[(startSegIndex + 1) % segments.length];
    let trackElevation = baseSeg.y + (nextSeg.y - baseSeg.y) * (offset / segmentLength);

    let jumpHeight = Math.max(0, playerY - trackElevation);

    const onShoulder = Math.abs(playerX) > ROAD_EDGE && !isCrashed;

    ctx.save();
    if (onShoulder && speed > 0 && jumpHeight === 0) {
        const jitterX = (Math.random() - 0.5) * 6;
        const jitterY = (Math.random() - 0.5) * 3;
        ctx.translate(jitterX, jitterY);
    }
    if (isCrashed) {
        let cx = carX + carW / 2;
        let cy = (height - carH - 20) + carH / 2;
        ctx.translate(cx, cy - jumpHeight * 0.015);
        ctx.rotate(crashRot);
        ctx.translate(-cx, -(cy - jumpHeight * 0.015));
    }

    const bounce = (speed > 0 && jumpHeight === 0 && !isCrashed) ? Math.random() * 2 : 0;
    const carY = height - carH - 20 + bounce - (jumpHeight * 0.015);

    if (jumpHeight > 0 && !isCrashed) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(carX + carW / 2, height - 20, Math.max(10, carW / 2 - jumpHeight * 0.01), 10, 0, 0, Math.PI * 2); ctx.fill();
    }

    ctx.fillStyle = '#111'; ctx.fillRect(carX - 8, carY + 15, 25, 30); ctx.fillRect(carX + carW - 17, carY + 15, 25, 30);
    ctx.fillStyle = '#e62222'; ctx.fillRect(carX, carY + 25, carW, 30); ctx.fillRect(carX + 25, carY, carW - 50, 25);
    ctx.fillStyle = '#444'; ctx.fillRect(carX + 30, carY + 5, carW - 60, 20);
    ctx.fillStyle = keys.ArrowDown ? '#ff0000' : '#ff8800'; ctx.fillRect(carX + 8, carY + 30, 15, 8); ctx.fillRect(carX + carW - 23, carY + 30, 15, 8);

    ctx.restore();

    drawHUD();
}

// --- Game Loop ---
function update() {
    if (isCrashed) {
        crashRot += crashSpinSpeed;
        playerVelY -= 15;
        playerY += playerVelY;
        position += speed;

        let currentSegIndex = Math.floor(position / segmentLength) % segments.length;
        let groundHeight = segments[currentSegIndex].y;

        if (playerY < groundHeight - CRASH_RESET_GROUND_OFFSET) {
            isCrashed = false;
            playerY = groundHeight;
            playerVelY = 0;
            speed = 0;
            crashRot = 0;
            playerX = 0;
            currentGear = 1;
        }

        updateEngineSound(RPM_IDLE, 0);

        render();
        requestAnimationFrame(update);
        return;
    }

    let trackLength = segments.length * segmentLength;
    if (position > currentLap * trackLength) { lastLapTime = currentLapTime; currentLap++; lapStartTime = Date.now(); }
    currentLapTime = (Date.now() - lapStartTime) / 1000;

    const maxZ = 2000 * segmentLength;
    for (let i = 0; i < segments.length; i++) segments[i].cars = [];

    let startSegIndex = Math.floor(position / segmentLength) % segments.length;
    let offset = position % segmentLength;
    let baseSeg = segments[startSegIndex];
    let nextSeg = segments[(startSegIndex + 1) % segments.length];
    let trackElevation = baseSeg.y + (nextSeg.y - baseSeg.y) * (offset / segmentLength);

    // --- Statische Hindernisse Kollision (nur am Boden, nicht in der Luft) ---
    const inAir = playerY > trackElevation + 80;
    if (!inAir) {
        const segmentsToCheck = [
            { seg: baseSeg, segZ: startSegIndex * segmentLength },
            { seg: nextSeg, segZ: (startSegIndex + 1) * segmentLength }
        ];
        for (let s = 0; s < segmentsToCheck.length; s++) {
            const { seg, segZ } = segmentsToCheck[s];
            const distZ = Math.abs(position - segZ);
            if (distZ > COLLISION_STATIC_Z_RANGE) continue;

            let playerSegSprites = seg.sprites;
            for (let i = 0; i < playerSegSprites.length; i++) {
                let sprite = playerSegSprites[i];
                let spriteW = 0.5;
                if (sprite.type === 'TREE_PINE' || sprite.type === 'TREE_LEAFY') spriteW = 0.45;
                if (sprite.type === 'BUILDING') spriteW = 0.9;
                if (sprite.type === 'STREETLIGHT') spriteW = 0.2;

                if (Math.abs(playerX - sprite.offset) < spriteW) {
                    if (speed > CRASH_SPEED_THRESHOLD) {
                        isCrashed = true;
                        playerVelY = speed * 4;
                        crashSpinSpeed = 0.1 + (speed / maxSpeed) * 0.4;
                    } else {
                        speed = 0;
                    }
                    break;
                }
            }
            if (isCrashed) break;
        }
    }


    for (let i = 0; i < cars.length; i++) {
        let car = cars[i];
        car.z += car.dir * car.speed;
        if (car.z < 0) car.z += maxZ; if (car.z >= maxZ) car.z -= maxZ;
        let segIndex = Math.floor(car.z / segmentLength) % segments.length;
        segments[segIndex].cars.push(car);

        let distToPlayerZ = Math.abs(car.z - (position % maxZ + COLLISION_Z_OFFSET));

        if (distToPlayerZ < COLLISION_Z_RANGE && playerY <= trackElevation + 1500) {
            if (Math.abs(playerX - car.offset) < COLLISION_PLAYER_CAR_X) {
                if (car.dir === -1) {
                    isCrashed = true;
                    playerVelY = 300 + (speed * 4);
                    crashSpinSpeed = 0.05 + (speed / maxSpeed) * 0.4;

                    car.speed = 0;
                } else {
                    speed = Math.min(speed, car.speed - 10);
                    playerX += (playerX >= car.offset ? 0.15 : -0.15);
                }
            }
        }
    }

    const onShoulder = Math.abs(playerX) > ROAD_EDGE;
    const gearMaxSpeed = GEAR_MAX_SPEEDS[currentGear - 1];
    const effectiveMaxSpeed = onShoulder
        ? Math.min(SHOULDER_MAX_SPEED, gearMaxSpeed)
        : gearMaxSpeed;
    let accelRate = onShoulder ? SHOULDER_ACCEL : 1.2;

    // In hohen Gängen bei niedriger Geschwindigkeit kaum beschleunigen (nicht „anfahren“)
    const gearMinSpeed = GEAR_MIN_SPEEDS[currentGear - 1];
    if (speed < gearMinSpeed && keys.ArrowUp) {
        accelRate *= 0.06;
    }

    if (keys.ArrowUp) speed = Math.min(speed + accelRate, effectiveMaxSpeed);
    else if (keys.ArrowDown) speed = Math.max(speed - 6, 0);
    else speed = Math.max(speed - COAST_DECEL, 0);

    if (onShoulder && speed > SHOULDER_MAX_SPEED) speed = Math.max(SHOULDER_MAX_SPEED, speed - 5);
    speed = Math.min(speed, effectiveMaxSpeed);

    position += speed;

    startSegIndex = Math.floor(position / segmentLength) % segments.length;
    offset = position % segmentLength;
    baseSeg = segments[startSegIndex];
    nextSeg = segments[(startSegIndex + 1) % segments.length];
    trackElevation = baseSeg.y + (nextSeg.y - baseSeg.y) * (offset / segmentLength);

    playerVelY -= 120;
    playerY += playerVelY;
    if (playerY < trackElevation) { playerY = trackElevation; playerVelY = 0; }

    let currentSeg = segments[startSegIndex];
    if (speed > 0) skyOffset += currentSeg.curve * (speed / maxSpeed) * 4;

    if (speed > 0) {
        let curveForce = (currentSeg.curve * speed) / CURVE_FORCE_DIVISOR;
        if (speed < CURVE_FORCE_SPEED_THRESHOLD) {
            curveForce *= speed / CURVE_FORCE_SPEED_THRESHOLD;
        }
        playerX -= curveForce;
    }
    const steeringMul = Math.max(STEERING_MIN_FACTOR, speed / maxSpeed);
    if (keys.ArrowLeft) playerX -= STEERING_FACTOR * steeringMul;
    if (keys.ArrowRight) playerX += STEERING_FACTOR * steeringMul;

    playerX = Math.max(-2.5, Math.min(2.5, playerX));

    const gearMaxSpeedForRpm = GEAR_MAX_SPEEDS[currentGear - 1];
    const rpm = gearMaxSpeedForRpm > 0
        ? Math.min(RPM_REDLINE, RPM_IDLE + (speed / gearMaxSpeedForRpm) * (RPM_REDLINE - RPM_IDLE))
        : RPM_IDLE;
    updateEngineSound(rpm, keys.ArrowUp ? 1 : 0);

    render();
    requestAnimationFrame(update);
}

buildRoad();
update();
