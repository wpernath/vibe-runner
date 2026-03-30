/**
 * Procedural sprite drawing (trees, buildings, signs, NPC cars).
 * Pure rendering — no game state dependencies. Canvas context and width are passed as parameters.
 */
export function drawProceduralSprite(ctx, width, spriteObj, destX, destY, destW, clipY) {
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
    } else if (spriteObj.type === 'CACTUS') {
        let cactW = 120 * s, cactH = 280 * s;
        ctx.fillStyle = '#4a6741'; ctx.fillRect(destX - cactW / 6, destY - cactH, cactW / 3, cactH);
        ctx.fillStyle = '#5a7a51'; ctx.fillRect(destX - cactW / 4, destY - cactH * 0.6, cactW / 5, cactH * 0.5);
        ctx.fillRect(destX + cactW / 8, destY - cactH * 0.35, cactW / 5, cactH * 0.35);
        ctx.beginPath(); ctx.ellipse(destX, destY - cactH - 15 * s, cactW * 0.2, 25 * s, 0, 0, Math.PI * 2); ctx.fill();
    } else if (spriteObj.type === 'ROCK') {
        let rockW = 180 * s, rockH = 120 * s;
        ctx.fillStyle = '#4a4a4a'; ctx.beginPath();
        ctx.ellipse(destX, destY - rockH / 2, rockW / 2, rockH / 2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3a3a3a'; ctx.beginPath();
        ctx.ellipse(destX - rockW * 0.15, destY - rockH * 0.4, rockW * 0.25, rockH * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    } else if (spriteObj.type === 'SNOWY_PINE') {
        let treeW = 200 * s, treeH = 380 * s;
        ctx.fillStyle = '#5a4a3a'; ctx.fillRect(destX - treeW / 6, destY - treeH / 4, treeW / 3, treeH / 4);
        ctx.fillStyle = '#2d4a2d'; ctx.beginPath(); ctx.moveTo(destX, destY - treeH); ctx.lineTo(destX - treeW / 2, destY - treeH / 4); ctx.lineTo(destX + treeW / 2, destY - treeH / 4); ctx.fill();
        ctx.fillStyle = '#E8EEF2'; ctx.beginPath(); ctx.moveTo(destX, destY - treeH * 0.85); ctx.lineTo(destX - treeW * 0.4, destY - treeH * 0.3); ctx.lineTo(destX + treeW * 0.4, destY - treeH * 0.3); ctx.fill();
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
        const totalLift = (car.crashY || 0) + (car.airY || 0);
        const npcDrawY = destY - totalLift * s * 0.4;

        if (totalLift > 0) {
            const shadowScale = Math.max(0.15, 1 - totalLift * 0.001);
            ctx.fillStyle = `rgba(0,0,0,${0.25 * shadowScale})`;
            ctx.beginPath();
            ctx.ellipse(destX, destY, Math.max(5, carW * 0.4 * shadowScale), 6 * s * shadowScale, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        if (car.crashed && car.crashRot) {
            ctx.save();
            ctx.translate(destX, npcDrawY - carH / 2);
            ctx.rotate(car.crashRot);
            ctx.translate(-destX, -(npcDrawY - carH / 2));
        }

        ctx.fillStyle = '#111';
        ctx.fillRect(destX - carW / 2.2, npcDrawY - carH / 4, carW / 4, carH / 2);
        ctx.fillRect(destX + carW / 2.2 - carW / 4, npcDrawY - carH / 4, carW / 4, carH / 2);
        ctx.fillStyle = car.color;
        ctx.fillRect(destX - carW / 2, npcDrawY - carH, carW, carH * 0.8);
        ctx.fillStyle = '#333';
        ctx.fillRect(destX - carW / 3, npcDrawY - carH + carH * 0.1, carW * 0.66, carH * 0.3);
        if (car.dir === -1) ctx.fillStyle = '#FFFDE7'; else ctx.fillStyle = '#D00';
        ctx.fillRect(destX - carW / 2 + 5 * s, npcDrawY - carH * 0.4, 25 * s, 12 * s);
        ctx.fillRect(destX + carW / 2 - 30 * s, npcDrawY - carH * 0.4, 25 * s, 12 * s);

        if (car.crashed && car.crashRot) ctx.restore();
    }
    ctx.restore();
}
