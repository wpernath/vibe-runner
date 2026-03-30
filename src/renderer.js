import { player, race, world, keys } from './state.js';
import {
    DESKTOP_CANVAS_WIDTH, DESKTOP_CANVAS_HEIGHT,
    PLAYER_CAR_W, PLAYER_CAR_H, PLAYER_CAR_BOTTOM_MARGIN,
    JUMP_HEIGHT_SCALE, ROLL_GROUND_THRESHOLD,
    PITCH_UP_ANGLE, PITCH_DOWN_ANGLE, AIR_ROAD_ROLL_SCALE,
    LANE_MARK_WIDTH_RATIO, LANE_MARK_INTERVAL,
    IN_AIR_THRESHOLD, segmentLength, cameraDepth, cameraHeight, roadWidth,
    ROAD_EDGE, CURVE_ROLL_MAX, CURVE_ROLL_SCALE, HANDBRAKE_CURVE_MUL,
    maxSpeed, RPM_REDLINE, REDLINE_DROPOFF_START, RPM_IN_AIR,
    RACE_LAPS,
    COLORS, MIRROR_W, MIRROR_H, MIRROR_Y, MIRROR_SEGMENTS,
} from './constants.js';
import { getTrackState, computeRpm, curveForceMagnitude } from './track.js';
import { drawProceduralSprite } from './sprites.js';

let canvas, ctx, width, height;

export function initRenderer(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    width = canvas.width;
    height = canvas.height;
}

export function resizeCanvas() {
    const gameContainer = document.getElementById('gameContainer');
    const isMobile = window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;

    if (isMobile && gameContainer) {
        const w = gameContainer.clientWidth || window.innerWidth || DESKTOP_CANVAS_WIDTH;
        const h = gameContainer.clientHeight || window.innerHeight || DESKTOP_CANVAS_HEIGHT;
        canvas.width = Math.max(1, w);
        canvas.height = Math.max(1, h);
    } else {
        canvas.width = DESKTOP_CANVAS_WIDTH;
        canvas.height = DESKTOP_CANVAS_HEIGHT;
    }
    width = canvas.width;
    height = canvas.height;
}

// --- 3D → 2D projection ---

function project(p, worldX, worldY, worldZ, camX, camY, camZ) {
    let z = Math.max(1, worldZ - camZ);
    let scale = cameraDepth / z;
    p.x = Math.round(width / 2 + (scale * (worldX - camX) * width / 2));
    p.y = Math.round(height / 2 - (scale * (worldY - camY) * height / 2));
    p.w = Math.round(scale * roadWidth * width / 2);
}

function projectRear(p, worldX, worldY, worldZ, camX, camY, camZ, centerX, centerY, viewW, viewH) {
    let z = Math.max(1, camZ - worldZ);
    let scale = cameraDepth / z;
    p.x = Math.round(centerX + (scale * (worldX - camX) * viewW / 2));
    p.y = Math.round(centerY - (scale * (worldY - camY) * viewH / 2));
    p.w = Math.max(1, Math.round(scale * roadWidth * viewW / 2));
}

function projectRearByDistance(p, worldX, worldY, zBehind, camX, camY, centerX, centerY, viewW, viewH) {
    let z = Math.max(1, zBehind);
    let scale = cameraDepth / z;
    p.x = Math.round(centerX + (scale * (worldX - camX) * viewW / 2));
    p.y = Math.round(centerY - (scale * (worldY - camY) * viewH / 2));
    p.w = Math.max(1, Math.round(scale * roadWidth * viewW / 2));
}

function drawQuad(color, x1, y1, w1, x2, y2, w2) {
    ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(x1 - w1, y1); ctx.lineTo(x2 - w2, y2);
    ctx.lineTo(x2 + w2, y2); ctx.lineTo(x1 + w1, y1);
    ctx.fill();
}

// --- Rear-view mirror ---

function drawRearViewMirror(startSegIndex, camX, camY, camZ) {
    if (!world.segments.length) return;
    const mirrorX = Math.floor(width / 2 - MIRROR_W / 2);
    const L = world.segments.length;
    const centerX = mirrorX + MIRROR_W / 2;
    const centerY = MIRROR_Y + MIRROR_H / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(mirrorX, MIRROR_Y, MIRROR_W, MIRROR_H);
    ctx.clip();

    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(mirrorX, MIRROR_Y, MIRROR_W, MIRROR_H);

    const _pNear = { x: 0, y: 0, w: 0 };
    const _pFar = { x: 0, y: 0, w: 0 };
    let xBack = 0;
    let maxY = MIRROR_Y + MIRROR_H;

    for (let n = 1; n <= MIRROR_SEGMENTS; n++) {
        const s = (startSegIndex - n + L * 100) % L;
        const sNext = (s + 1) % L;
        const seg = world.segments[s];
        const nextSeg = world.segments[sNext];
        const nearZ = (s + 1) * segmentLength;
        const farZ = s * segmentLength;

        xBack -= seg.curve;
        const xNear = xBack + seg.curve;
        const xFar = xBack;

        projectRear(_pNear, xNear, nextSeg.y, nearZ, camX, camY, camZ, centerX, centerY, MIRROR_W, MIRROR_H);
        projectRear(_pFar, xFar, seg.y, farZ, camX, camY, camZ, centerX, centerY, MIRROR_W, MIRROR_H);

        if (_pNear.y >= maxY && _pFar.y >= maxY) continue;

        ctx.fillStyle = seg.color.grass;
        const topY = Math.min(_pNear.y, _pFar.y);
        if (maxY > topY) ctx.fillRect(mirrorX, topY, MIRROR_W, maxY - topY);
        maxY = topY;

        drawQuad(seg.color.rumble, _pNear.x, _pNear.y, _pNear.w * 1.1, _pFar.x, _pFar.y, _pFar.w * 1.1);
        drawQuad(seg.color.road, _pNear.x, _pNear.y, _pNear.w, _pFar.x, _pFar.y, _pFar.w);
    }

    const trackLength = L * segmentLength;
    const mirrorClipY = MIRROR_Y + MIRROR_H;
    const _pSprite = { x: 0, y: 0, w: 0 };
    const mirrorSprites = [];
    let xBackAcc = 0;
    const xFarByN = [];
    const xNearByN = [];
    for (let n = 1; n <= MIRROR_SEGMENTS; n++) {
        const s = (startSegIndex - n + L * 100) % L;
        const seg = world.segments[s];
        xBackAcc -= seg.curve;
        xFarByN[n] = xBackAcc;
        xNearByN[n] = xBackAcc + seg.curve;
    }

    for (let n = 1; n <= MIRROR_SEGMENTS; n++) {
        const s = (startSegIndex - n + L * 100) % L;
        const seg = world.segments[s];
        const farZ = s * segmentLength;
        const xNear = xNearByN[n];
        const xFar = xFarByN[n];

        for (let i = 0; i < seg.sprites.length; i++) {
            const sprite = seg.sprites[i];
            const worldX = xFar + sprite.offset * roadWidth;
            projectRear(_pSprite, worldX, seg.y, farZ, camX, camY, camZ, centerX, centerY, MIRROR_W, MIRROR_H);
            if (_pSprite.x >= mirrorX - 50 && _pSprite.x <= mirrorX + MIRROR_W + 50 && _pSprite.y >= MIRROR_Y - 20 && _pSprite.y <= mirrorClipY + 20) {
                mirrorSprites.push({ type: sprite.type, data: sprite.data, x: _pSprite.x, y: _pSprite.y, w: _pSprite.w });
            }
        }

        for (let i = 0; i < seg.cars.length; i++) {
            const car = seg.cars[i];
            const zBehind = (camZ - car.z + trackLength) % trackLength;
            if (zBehind <= 0 || zBehind > MIRROR_SEGMENTS * segmentLength) continue;
            const t = (car.z - s * segmentLength) / segmentLength;
            const roadX = xFar + t * (xNear - xFar) + car.offset * roadWidth;
            const segY = seg.y;
            projectRearByDistance(_pSprite, roadX, segY, zBehind, camX, camY, centerX, centerY, MIRROR_W, MIRROR_H);
            if (_pSprite.x >= mirrorX - 50 && _pSprite.x <= mirrorX + MIRROR_W + 50 && _pSprite.y >= MIRROR_Y - 20 && _pSprite.y <= mirrorClipY + 20) {
                mirrorSprites.push({ type: 'NPC_CAR', data: car, x: _pSprite.x, y: _pSprite.y, w: _pSprite.w });
            }
        }
    }

    mirrorSprites.sort((a, b) => b.y - a.y);
    for (let i = 0; i < mirrorSprites.length; i++) {
        const o = mirrorSprites[i];
        drawProceduralSprite(ctx, width, { type: o.type, data: o.data }, o.x, o.y, o.w, mirrorClipY);
    }

    ctx.restore();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(mirrorX, MIRROR_Y, MIRROR_W, MIRROR_H);
}

// --- Parallax sky ---

let _cachedSkyGradient = null;
let _cachedSkyH = 0;

function drawParallaxLayers(horizonY) {
    if (!_cachedSkyGradient || _cachedSkyH !== height) {
        _cachedSkyGradient = ctx.createLinearGradient(0, 0, 0, height);
        _cachedSkyGradient.addColorStop(0, COLORS.SKY_TOP);
        _cachedSkyGradient.addColorStop(1, COLORS.SKY_BOTTOM);
        _cachedSkyH = height;
    }
    ctx.fillStyle = _cachedSkyGradient; ctx.fillRect(0, 0, width, height);

    let cloudBaseY = horizonY - 250;
    let cloudScrollX = player.skyOffset * 0.2;
    ctx.fillStyle = COLORS.CLOUD;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 20) {
        let cloudHeight = Math.sin((x + cloudScrollX) * 0.005) * 30 + Math.sin((x + cloudScrollX * 1.5) * 0.01) * 15;
        let y = cloudBaseY - cloudHeight;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineTo(width, horizonY - 50); ctx.lineTo(0, horizonY - 50); ctx.fill();

    let mountainScrollX = player.skyOffset * 0.6;
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

// --- HUD gauges & minimap ---

function drawRPMGauge(rpm) {
    const cx = width - 15 - 165 - 10 - 165 / 2, cy = 52, r = 42, boxW = 165, left = width - 15 - boxW * 2 - 10;
    ctx.fillStyle = 'rgba(20, 20, 25, 0.92)'; ctx.fillRect(left, 15, boxW, 78);
    ctx.strokeStyle = 'rgba(80, 80, 90, 0.9)'; ctx.lineWidth = 1.5; ctx.strokeRect(left, 15, boxW, 78);
    ctx.strokeStyle = '#777'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0, false); ctx.stroke();
    ctx.strokeStyle = '#BBB'; ctx.lineWidth = 1.5; ctx.fillStyle = '#E8E8E8'; ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= RPM_REDLINE; i += 1000) {
        const angle = Math.PI - (i / RPM_REDLINE) * Math.PI;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(angle) * (r - 10), cy - Math.sin(angle) * (r - 10));
        ctx.lineTo(cx + Math.cos(angle) * r, cy - Math.sin(angle) * r); ctx.stroke();
        if (i % 2000 === 0 || i === RPM_REDLINE) ctx.fillText(String(i / 1000) + 'k', cx + Math.cos(angle) * (r - 20), cy - Math.sin(angle) * (r - 20));
    }
    ctx.strokeStyle = 'rgba(255, 60, 60, 0.95)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * (1 - REDLINE_DROPOFF_START / RPM_REDLINE), 0, false); ctx.stroke();
    const needleAngle = Math.PI - (Math.min(rpm, RPM_REDLINE) / RPM_REDLINE) * Math.PI, len = r - 10;
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(needleAngle) * len, cy - Math.sin(needleAngle) * len); ctx.stroke();
    ctx.strokeStyle = rpm >= RPM_REDLINE * 0.9 ? '#FF4444' : '#FFF'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(needleAngle) * len, cy - Math.sin(needleAngle) * len); ctx.stroke();
    ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#FFF'; ctx.font = 'bold 14px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(Math.round(rpm) + ' rpm', cx, cy + r - 2);
    ctx.font = 'bold 20px "Courier New"'; ctx.textBaseline = 'middle'; ctx.fillText(String(player.gear), cx, cy - 10);
}

function drawSpeedGauge(speedKmh) {
    const cx = width - 92, cy = 52, r = 42, boxW = 165, left = width - 15 - boxW;
    ctx.fillStyle = 'rgba(20, 20, 25, 0.92)'; ctx.fillRect(left, 15, boxW, 78);
    ctx.strokeStyle = 'rgba(80, 80, 90, 0.9)'; ctx.lineWidth = 1.5; ctx.strokeRect(left, 15, boxW, 78);
    ctx.strokeStyle = '#777'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0, false); ctx.stroke();
    ctx.strokeStyle = '#BBB'; ctx.lineWidth = 1.5; ctx.fillStyle = '#E8E8E8'; ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let v = 0; v <= maxSpeed; v += 50) {
        const angle = Math.PI - (v / maxSpeed) * Math.PI;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(angle) * (r - 10), cy - Math.sin(angle) * (r - 10));
        ctx.lineTo(cx + Math.cos(angle) * r, cy - Math.sin(angle) * r); ctx.stroke();
        if (v % 100 === 0 || v === maxSpeed) ctx.fillText(String(v), cx + Math.cos(angle) * (r - 20), cy - Math.sin(angle) * (r - 20));
    }
    const speedClamped = Math.min(speedKmh, maxSpeed), needleAngle = Math.PI - (speedClamped / maxSpeed) * Math.PI, len = r - 10;
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(needleAngle) * len, cy - Math.sin(needleAngle) * len); ctx.stroke();
    ctx.strokeStyle = speedKmh > maxSpeed * 0.92 ? '#FF4444' : '#FFF'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(needleAngle) * len, cy - Math.sin(needleAngle) * len); ctx.stroke();
    ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#FFF'; ctx.font = 'bold 14px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(Math.round(speedKmh) + ' km/h', cx, cy + r - 2);
}

function drawTrackOverview() {
    if (!world.segments.length) return;
    const trackLength = world.segments.length * segmentLength;
    const progress = trackLength > 0 ? (player.position % trackLength) / trackLength : 0;

    const barW = 130;
    const barH = 10;
    const x = 15;
    const y = height - 28;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(x, y, barW, barH);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, barW, barH);

    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('S/Z', x + 4, y + barH / 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillRect(x + 22, y + 2, 2, barH - 4);

    const px = x + 26 + (barW - 34) * progress;
    ctx.fillStyle = '#e62222';
    ctx.beginPath();
    ctx.arc(px, y + barH / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFF';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
}

function drawTrackMap() {
    if (!world.segments.length) return;
    const trackLength = world.segments.length * segmentLength;
    const step = Math.max(1, Math.floor(world.segments.length / 150));
    let pathX = 0;
    const points = [{ x: 0, z: 0 }];
    for (let i = 0; i < world.segments.length; i += step) {
        for (let j = i; j < Math.min(i + step, world.segments.length); j++) pathX += world.segments[j].curve;
        points.push({ x: pathX, z: Math.min(i + step, world.segments.length) * segmentLength });
    }
    if (points.length < 2) return;

    let minX = points[0].x, maxX = points[0].x, minZ = 0, maxZ = trackLength;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
    }
    const rangeX = maxX - minX || 1;

    const mapW = 120;
    const mapH = 100;
    const pad = 8;
    const left = width - 15 - mapW;
    const top = height - 15 - mapH;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(left, top, mapW, mapH);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, mapW, mapH);

    const toScreenX = (x) => left + pad + ((x - minX) / rangeX) * (mapW - 2 * pad);
    const toScreenZ = (z) => top + mapH - pad - (z / maxZ) * (mapH - 2 * pad);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(toScreenX(points[0].x), toScreenZ(points[0].z));
    for (let i = 1; i < points.length; i++) ctx.lineTo(toScreenX(points[i].x), toScreenZ(points[i].z));
    ctx.lineTo(toScreenX(points[0].x), toScreenZ(points[0].z));
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 0, 0.9)';
    ctx.beginPath();
    ctx.arc(toScreenX(points[0].x), toScreenZ(0), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFF';
    ctx.lineWidth = 1;
    ctx.stroke();

    const posInLap = player.position % trackLength;
    let playerPathX = 0;
    const segIndex = Math.floor(posInLap / segmentLength) % world.segments.length;
    const offsetInSeg = posInLap % segmentLength;
    for (let i = 0; i < segIndex; i++) playerPathX += world.segments[i].curve;
    playerPathX += (offsetInSeg / segmentLength) * world.segments[segIndex].curve;
    const playerScreenX = toScreenX(playerPathX);
    const playerScreenZ = toScreenZ(posInLap);

    ctx.fillStyle = '#e62222';
    ctx.beginPath();
    ctx.arc(playerScreenX, playerScreenZ, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFF';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
}

function drawHUD(displayRpm) {
    const rpm = displayRpm != null ? displayRpm : computeRpm(player.speed, player.gear);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fillRect(15, 15, 200, 112);
    drawRPMGauge(rpm);
    drawSpeedGauge(player.speed);

    let playerPosition = 1;
    if (world.segments.length && world.cars.length) {
        const trackLen = world.segments.length * segmentLength;
        const playerZ = player.position % trackLen;
        const entries = [{ lap: race.currentLap - 1, z: playerZ, isPlayer: true }];
        for (let i = 0; i < world.cars.length; i++) {
            entries.push({ lap: world.cars[i].lap, z: world.cars[i].z, isPlayer: false });
        }
        entries.sort((a, b) => { if (a.lap !== b.lap) return b.lap - a.lap; return b.z - a.z; });
        const idx = entries.findIndex(e => e.isPlayer);
        if (idx >= 0) playerPosition = idx + 1;
    }
    const totalRacers = 1 + (world.cars.length || 0);
    ctx.fillStyle = '#FFF'; ctx.font = 'bold 20px "Courier New"'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`LAP:  ${race.currentLap}/${RACE_LAPS}`, 25, 40);
    ctx.fillText(`POS:  ${playerPosition}/${totalRacers}`, 25, 58);
    ctx.fillText(`TIME: ${race.currentLapTime.toFixed(2)}s`, 25, 78);
    if (race.lastLapTime > 0) { ctx.fillStyle = '#AAA'; ctx.fillText(`LAST: ${race.lastLapTime.toFixed(2)}s`, 25, 103); }
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = 'bold 12px "Courier New"'; ctx.fillText('First to 3 laps wins', 25, 121);

    drawTrackOverview();
    drawTrackMap();

    if (race.over) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#FFF';
        ctx.textAlign = 'center';
        ctx.font = 'bold 48px "Courier New"';
        if (race.winner === 'player') {
            ctx.fillStyle = '#4a4';
            ctx.fillText('YOU WIN!', width / 2, height / 2 - 20);
            ctx.fillStyle = '#FFF'; ctx.font = 'bold 24px "Courier New"';
            ctx.fillText('First to 3 laps', width / 2, height / 2 + 30);
        } else {
            ctx.fillStyle = '#c44';
            ctx.fillText(`OPPONENT ${race.winnerName} WINS!`, width / 2, height / 2 - 20);
            ctx.fillStyle = '#FFF'; ctx.font = 'bold 24px "Courier New"';
            ctx.fillText('First to 3 laps', width / 2, height / 2 + 30);
        }
    }

    if (race.countdownActive) {
        const remaining = (race.countdownEnd - Date.now()) / 1000;
        const displayNum = Math.ceil(Math.max(0, remaining));
        const label = displayNum > 0 ? String(displayNum) : 'GO!';
        const pulse = 1 + Math.sin(remaining * Math.PI * 2) * 0.15;
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(0, 0, width, height);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${Math.round(96 * pulse)}px "Courier New"`;
        ctx.fillStyle = displayNum > 0 ? '#FFF' : '#4f4';
        ctx.fillText(label, width / 2, height / 2);
        ctx.restore();
    }

    if (player.crashed) {
        ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
        ctx.fillRect(0, height / 2 - 50, width, 100);
        ctx.fillStyle = '#FFF';
        ctx.textAlign = 'center';
        ctx.font = 'bold 40px "Courier New"';
        ctx.fillText("CRASHED!", width / 2, height / 2 + 15);
    }
}

// --- Sprite draw pool ---

const _spritePool = [];
let _spriteCount = 0;

function _pushSprite(type, data, x, y, w, clipY) {
    if (_spriteCount < _spritePool.length) {
        const s = _spritePool[_spriteCount];
        s.type = type; s.data = data; s.x = x; s.y = y; s.w = w; s.clipY = clipY;
    } else {
        _spritePool.push({ type, data, x, y, w, clipY });
    }
    _spriteCount++;
}

// --- Main frame render ---

export function render() {
    ctx.clearRect(0, 0, width, height);

    const { startSegIndex, offset, baseSeg, nextSeg, trackElevation } = getTrackState(player.position);
    let camX = player.x * roadWidth;
    let camY = cameraHeight + player.y;
    let camZ = player.position;

    let horizonY = height / 2 + player.y * 0.05;
    drawParallaxLayers(horizonY);

    let x = 0, dx = 0, maxY = height;
    _spriteCount = 0;

    const _projTmp = { x: 0, y: 0, w: 0 };

    for (let n = 0; n < 300; n++) {
        let seg = world.segments[(startSegIndex + n) % world.segments.length];
        const segZ = (startSegIndex + n) * segmentLength;

        project(seg.p1, x, seg.y, segZ, camX, camY, camZ - (n === 0 ? offset : 0));
        let currentCurveX = x;
        x += dx; dx += seg.curve;

        for (let i = 0; i < seg.sprites.length; i++) {
            project(_projTmp, currentCurveX + seg.sprites[i].offset * roadWidth, seg.y, segZ, camX, camY, camZ - (n === 0 ? offset : 0));
            if (_projTmp.x > -1000 && _projTmp.x < width + 1000) {
                _pushSprite(seg.sprites[i].type, seg.sprites[i].data, _projTmp.x, _projTmp.y, _projTmp.w, maxY);
            }
        }

        for (let i = 0; i < seg.cars.length; i++) {
            let car = seg.cars[i];
            let carVisualZ = segZ + (car.z % segmentLength);
            project(_projTmp, currentCurveX + car.offset * roadWidth, seg.y, carVisualZ, camX, camY, camZ - (n === 0 ? offset : 0));
            if (_projTmp.x > -1000 && _projTmp.x < width + 1000) {
                _pushSprite('NPC_CAR', car, _projTmp.x, _projTmp.y, _projTmp.w, maxY);
            }
        }

        if (seg.p1.y >= maxY) continue;
        if (n > 0) {
            let prev = world.segments[(startSegIndex + n - 1) % world.segments.length];
            ctx.fillStyle = seg.color.grass; ctx.fillRect(0, seg.p1.y, width, prev.p1.y - seg.p1.y);
            drawQuad(seg.color.rumble, prev.p1.x, prev.p1.y, prev.p1.w * 1.1, seg.p1.x, seg.p1.y, seg.p1.w * 1.1);
            drawQuad(seg.color.road, prev.p1.x, prev.p1.y, prev.p1.w, seg.p1.x, seg.p1.y, seg.p1.w);

            const segIdx = (startSegIndex + n) % world.segments.length;
            if (Math.floor(segIdx / LANE_MARK_INTERVAL) % 2 === 0) {
                const laneW1 = prev.p1.w * LANE_MARK_WIDTH_RATIO;
                const laneW2 = seg.p1.w * LANE_MARK_WIDTH_RATIO;
                drawQuad('#ddd', prev.p1.x, prev.p1.y, laneW1, seg.p1.x, seg.p1.y, laneW2);
                drawQuad('#ddd', prev.p1.x - prev.p1.w * 0.5, prev.p1.y, laneW1, seg.p1.x - seg.p1.w * 0.5, seg.p1.y, laneW2);
                drawQuad('#ddd', prev.p1.x + prev.p1.w * 0.5, prev.p1.y, laneW1, seg.p1.x + seg.p1.w * 0.5, seg.p1.y, laneW2);
            }
        }
        maxY = seg.p1.y;
    }

    for (let i = _spriteCount - 1; i >= 0; i--) {
        const s = _spritePool[i];
        drawProceduralSprite(ctx, width, s, s.x, s.y, s.w, s.clipY);
    }

    drawRearViewMirror(startSegIndex, camX, camY, camZ);

    const carW = PLAYER_CAR_W;
    const carH = PLAYER_CAR_H;
    const carMargin = PLAYER_CAR_BOTTOM_MARGIN;
    const carBaseY = height - carH - carMargin;
    let carX = width / 2 - carW / 2;

    let jumpHeight = Math.max(0, player.y - trackElevation);
    const jumpOffset = jumpHeight * JUMP_HEIGHT_SCALE;

    const onShoulder = Math.abs(player.x) > ROAD_EDGE && !player.crashed;

    const _now = performance.now();
    const bounce = (player.speed > 0 && jumpHeight === 0 && !player.crashed)
        ? Math.sin(_now * 0.012) * 1.2 + Math.sin(_now * 0.029) * 0.6
        : 0;

    ctx.save();
    if (onShoulder && player.speed > 0 && jumpHeight === 0) {
        const jitterX = Math.sin(_now * 0.047) * 3 + Math.sin(_now * 0.113) * 2;
        const jitterY = Math.sin(_now * 0.073) * 1.5 + Math.sin(_now * 0.157) * 1;
        ctx.translate(jitterX, jitterY);
    }
    if (!player.crashed && jumpHeight < ROLL_GROUND_THRESHOLD && player.speed > 0) {
        const handbrakeMul = 1 + player.handbrakeAmount * (HANDBRAKE_CURVE_MUL - 1);
        const rollAngle = Math.max(-CURVE_ROLL_MAX, Math.min(CURVE_ROLL_MAX, curveForceMagnitude(baseSeg.curve, player.speed, handbrakeMul) * CURVE_ROLL_SCALE));
        if (Math.abs(rollAngle) > 0.008) {
            const cx = carX + carW / 2;
            const cy = carBaseY + bounce - jumpOffset + carH / 2;
            ctx.translate(cx, cy);
            ctx.rotate(rollAngle);
            ctx.translate(-cx, -cy);
        }
    }
    if (player.crashed) {
        const cx = carX + carW / 2;
        const cy = carBaseY + carH / 2;
        ctx.translate(cx, cy - jumpOffset);
        ctx.rotate(player.crashRot);
        ctx.translate(-cx, -(cy - jumpOffset));
    } else if (jumpHeight > 0) {
        let pitchAngle = 0;
        if (keys.ArrowUp) pitchAngle = PITCH_UP_ANGLE;
        else if (keys.ArrowDown) pitchAngle = PITCH_DOWN_ANGLE;
        const roadRollInAir = baseSeg.curve * AIR_ROAD_ROLL_SCALE;
        const cx = carX + carW / 2;
        const cy = carBaseY - jumpOffset + carH / 2;
        ctx.translate(cx, cy);
        if (pitchAngle !== 0) ctx.rotate(pitchAngle);
        ctx.rotate(roadRollInAir);
        ctx.translate(-cx, -cy);
    }
    const carY = carBaseY + bounce - jumpOffset;

    if (jumpHeight > 0 && !player.crashed) {
        const shadowY = height - carMargin;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(carX + carW / 2, shadowY, Math.max(10, carW / 2 - jumpHeight * 0.01), 10, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.fillStyle = '#111'; ctx.fillRect(carX - 8, carY + 15, 25, 30); ctx.fillRect(carX + carW - 17, carY + 15, 25, 30);
    ctx.fillStyle = '#e62222'; ctx.fillRect(carX, carY + 25, carW, 30); ctx.fillRect(carX + 25, carY, carW - 50, 25);
    ctx.fillStyle = '#444'; ctx.fillRect(carX + 30, carY + 5, carW - 60, 20);
    ctx.fillStyle = keys.ArrowDown ? '#ff0000' : '#ff8800'; ctx.fillRect(carX + 8, carY + 30, 15, 8); ctx.fillRect(carX + carW - 23, carY + 30, 15, 8);

    ctx.restore();

    const inAirForHUD = !player.crashed && (player.y - trackElevation > IN_AIR_THRESHOLD);
    drawHUD(inAirForHUD ? RPM_IN_AIR : undefined);
}
