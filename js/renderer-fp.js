// Renderer First-Person & Manager Raycast Views
// Depends on: constants.js, state.js, simulation.js, renderer-core.js
// Methods are added to the existing CanvasRenderer object.

/** Manager walk: Wolf-style raycast in the hotel floor footprint (perimeter + elevator pillar). */
CanvasRenderer.drawManagerRaycastView = function() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const M = state.managerWalk;
    if (!M) return;

    const px = M.x;
    const pz = M.z;
    const ang = M.yaw;
    const horizon = H * 0.46;
    const fov = Math.PI / 2.15;

    ctx.fillStyle = '#070b18';
    ctx.fillRect(0, 0, W, horizon * 0.55);
    const skyG = ctx.createLinearGradient(0, 0, 0, horizon);
    skyG.addColorStop(0, '#1a2a52');
    skyG.addColorStop(1, '#0c1224');
    ctx.fillStyle = skyG;
    ctx.fillRect(0, 0, W, horizon);

    const flG = ctx.createLinearGradient(0, horizon, 0, H);
    flG.addColorStop(0, '#2a1810');
    flG.addColorStop(1, '#050302');
    ctx.fillStyle = flG;
    ctx.fillRect(0, horizon, W, H - horizon);

    const ebL = ELEVATOR_C + 0.08;
    const ebR = ELEVATOR_C + 0.42;
    const ebT = ELEVATOR_R + 0.08;
    const ebB = ELEVATOR_R + 0.42;

    for (let col = 0; col < W; col++) {
        const rayAng = ang + (col / W - 0.5) * fov;
        const rdx = Math.sin(rayAng);
        const rdz = Math.cos(rayAng);
        let bestT = 1e9;
        let wallKind = 'none';

        const tryHit = (t, kind) => {
            if (t > 0.004 && t < bestT) {
                bestT = t;
                wallKind = kind;
            }
        };

        if (Math.abs(rdx) > 1e-7) {
            const t0 = (0 - px) / rdx;
            const z0 = pz + t0 * rdz;
            if (t0 > 0 && z0 >= 0 && z0 <= GRID_ROWS) tryHit(t0, 'w');
            const t1 = (GRID_COLS - px) / rdx;
            const z1 = pz + t1 * rdz;
            if (t1 > 0 && z1 >= 0 && z1 <= GRID_ROWS) tryHit(t1, 'e');
        }
        if (Math.abs(rdz) > 1e-7) {
            const t0 = (0 - pz) / rdz;
            const x0 = px + t0 * rdx;
            if (t0 > 0 && x0 >= 0 && x0 <= GRID_COLS) tryHit(t0, 'n');
            const t1 = (GRID_ROWS - pz) / rdz;
            const x1 = px + t1 * rdx;
            if (t1 > 0 && x1 >= 0 && x1 <= GRID_COLS) tryHit(t1, 's');
        }

        if (Math.abs(rdx) > 1e-7) {
            for (const vx of [ebL, ebR]) {
                const t = (vx - px) / rdx;
                const zz = pz + t * rdz;
                if (t > 0 && zz >= ebT && zz <= ebB) tryHit(t, 'p');
            }
        }
        if (Math.abs(rdz) > 1e-7) {
            for (const vz of [ebT, ebB]) {
                const t = (vz - pz) / rdz;
                const xx = px + t * rdx;
                if (t > 0 && xx >= ebL && xx <= ebR) tryHit(t, 'p');
            }
        }

        if (bestT >= 1e8) continue;

        const perp = bestT * Math.cos(rayAng - ang);
        const colH = Math.min(H * 2.2, H * 0.78 / Math.max(0.04, perp));
        const top = horizon - colH / 2;
        const bot = horizon + colH / 2;
        const shade = Math.min(1, 1.05 / (1 + bestT * 0.9));

        let r0 = 55;
        let g0 = 62;
        let b0 = 82;
        if (wallKind === 'n' || wallKind === 's') {
            r0 = 72;
            g0 = 80;
            b0 = 108;
        } else if (wallKind === 'e' || wallKind === 'w') {
            r0 = 88;
            g0 = 92;
            b0 = 118;
        } else if (wallKind === 'p') {
            r0 = 38;
            g0 = 42;
            b0 = 52;
        }
        ctx.fillStyle = `rgb(${Math.round(r0 * shade + 10)},${Math.round(g0 * shade + 12)},${Math.round(b0 * shade + 18)})`;
        ctx.fillRect(col, Math.max(0, top), 1, Math.max(0, Math.min(H, bot) - Math.max(0, top)));
    }

    for (let i = 1; i <= 14; i++) {
        const t = i / 14;
        const y = horizon + t * (H - horizon);
        ctx.strokeStyle = `rgba(90,40,20,${0.22 * (1 - t)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
    }

    ctx.save();
    ctx.translate(W / 2, horizon * 0.72);
    ctx.rotate(-ang);
    ctx.strokeStyle = 'rgba(251,191,36,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(0, -22);
    ctx.stroke();
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.lineTo(-5, -14);
    ctx.lineTo(5, -14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = 'rgba(10,14,30,0.82)';
    const bw = Math.min(520, W - 24);
    const bx = (W - bw) / 2;
    const by = H - 56;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, 46, 10);
    else ctx.rect(bx, by, bw, 46);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 12px Inter';
    ctx.textAlign = 'center';
    const flab = M.f === 0 ? 'Lobby' : `Guest floor ${M.f}`;
    ctx.fillText(`${flab}  ·  WASD / arrows move & turn  ·  E enter suite  ·  [ ] floors at lift  ·  Esc exits suite`, W / 2, by + 20);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter';
    const deg = (((M.yaw * 180) / Math.PI % 360) + 360) % 360;
    ctx.fillText(`Position ~ col ${M.x.toFixed(2)}, row ${M.z.toFixed(2)}  ·  Facing ${deg.toFixed(0)}°`, W / 2, by + 38);
};

CanvasRenderer.drawFirstPersonView = function() {
    // If a room is selected, delegate to Three.js renderer
    if (state.fpRoom) {
        const { f, r, c } = state.fpRoom;
        const cell = state.hotel[f]?.[r]?.[c];
        if (cell) { Room3DRenderer.ensureShowing(cell, f, r, c); return; }
        state.fpRoom = null;  // stale reference — fall through to corridor
    }
    Room3DRenderer.hide(); // corridor view — hide 3D overlay

    this.fpDoorHitAreas = [];  // reset hit areas for this frame

    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const lerp = (a, b, t) => a + (b - a) * t;

    const vpX = W / 2, vpY = H * 0.44;
    const endHW = Math.min(W, H) * 0.13;
    const endHH = Math.min(W, H) * 0.20;
    const fL = vpX - endHW, fR = vpX + endHW;
    const fT = vpY - endHH, fB = vpY + endHH;

    // Background
    ctx.fillStyle = '#060a18';
    ctx.fillRect(0, 0, W, H);

    // Ceiling
    const ceilGrad = ctx.createLinearGradient(0, 0, 0, fT);
    ceilGrad.addColorStop(0, '#1a1a3e');
    ceilGrad.addColorStop(1, '#2d2d60');
    ctx.fillStyle = ceilGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(fR, fT); ctx.lineTo(fL, fT);
    ctx.closePath(); ctx.fill();

    // Floor
    const floorGrad = ctx.createLinearGradient(0, fB, 0, H);
    floorGrad.addColorStop(0, '#200a0a');
    floorGrad.addColorStop(1, '#3d1515');
    ctx.fillStyle = floorGrad;
    ctx.beginPath();
    ctx.moveTo(0, H); ctx.lineTo(W, H); ctx.lineTo(fR, fB); ctx.lineTo(fL, fB);
    ctx.closePath(); ctx.fill();

    // Floor carpet perspective stripes
    for (let i = 1; i < 12; i++) {
        const t = i / 12;
        ctx.beginPath();
        ctx.moveTo(lerp(0, fL, t), lerp(H, fB, t));
        ctx.lineTo(lerp(W, fR, t), lerp(H, fB, t));
        ctx.strokeStyle = `rgba(120,30,30,${0.4 * (1 - t)})`;
        ctx.lineWidth = lerp(2, 0.3, t);
        ctx.stroke();
    }

    // Left wall
    const lwGrad = ctx.createLinearGradient(0, 0, fL, 0);
    lwGrad.addColorStop(0, '#1e2850'); lwGrad.addColorStop(1, '#2d3a70');
    ctx.fillStyle = lwGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, H); ctx.lineTo(fL, fB); ctx.lineTo(fL, fT);
    ctx.closePath(); ctx.fill();

    // Right wall
    const rwGrad = ctx.createLinearGradient(W, 0, fR, 0);
    rwGrad.addColorStop(0, '#1e2850'); rwGrad.addColorStop(1, '#2d3a70');
    ctx.fillStyle = rwGrad;
    ctx.beginPath();
    ctx.moveTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(fR, fB); ctx.lineTo(fR, fT);
    ctx.closePath(); ctx.fill();

    // Crown molding
    ctx.strokeStyle = '#b45309'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, H * 0.08); ctx.lineTo(fL, fT + (fB - fT) * 0.05); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W, H * 0.08); ctx.lineTo(fR, fT + (fB - fT) * 0.05); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, H * 0.88); ctx.lineTo(fL, fB - (fB - fT) * 0.06); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W, H * 0.88); ctx.lineTo(fR, fB - (fB - fT) * 0.06); ctx.stroke();

    // Back wall
    ctx.fillStyle = '#2d3a70';
    ctx.fillRect(fL, fT, fR - fL, fB - fT);
    ctx.strokeStyle = '#475569'; ctx.lineWidth = 1;
    ctx.strokeRect(fL, fT, fR - fL, fB - fT);

    // Ceiling light strip
    const lightGrad = ctx.createLinearGradient(W / 2, 0, W / 2, fT);
    lightGrad.addColorStop(0, 'rgba(255,248,200,0.25)');
    lightGrad.addColorStop(1, 'rgba(255,248,200,0)');
    ctx.fillStyle = lightGrad;
    ctx.beginPath();
    ctx.moveTo(W * 0.44, 0); ctx.lineTo(W * 0.56, 0);
    ctx.lineTo(vpX + endHW * 0.15, fT); ctx.lineTo(vpX - endHW * 0.15, fT);
    ctx.closePath(); ctx.fill();

    // Ceiling light fixtures
    for (let i = 0; i < 5; i++) {
        const t = (i + 0.5) / 5;
        const lx = W / 2, ly = lerp(H * 0.04, fT * 0.9, t);
        const gSize = lerp(80, 8, t);
        const grd = ctx.createRadialGradient(lx, ly, 0, lx, ly, gSize);
        grd.addColorStop(0, 'rgba(255,248,200,0.35)'); grd.addColorStop(1, 'rgba(255,248,200,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(lx - gSize, ly - gSize / 2, gSize * 2, gSize);
        ctx.beginPath(); ctx.arc(lx, ly, lerp(5, 1.5, t), 0, Math.PI * 2);
        ctx.fillStyle = '#fef9c3'; ctx.fill();
    }

    // Doors — compute positions dynamically for any GRID_COLS
    const floor = state.hotel[state.fpFloor];
    if (floor) {
        const doorDT = GRID_COLS <= 2 ? 0.22 : 0.17;
        const doorGap = (1 - GRID_COLS * doorDT) / (GRID_COLS + 1);
        const doorTs = Array.from({length: GRID_COLS}, (_, i) => doorGap + i * (doorDT + doorGap));
        for (let c = 0; c < GRID_COLS; c++) {
            const t = doorTs[c];
            if (floor[0] && floor[0][c]) this.drawFPDoor('left',  c, floor[0][c], W, H, fL, fR, fT, fB, t, doorDT);
            if (floor[1] && floor[1][c]) this.drawFPDoor('right', c, floor[1][c], W, H, fL, fR, fT, fB, t, doorDT);
        }
    }

    // Floor indicator
    ctx.fillStyle = 'rgba(10,14,30,0.75)';
    const indW = 240, indH = 38, indX = W / 2 - indW / 2, indY = H - indH - 10;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(indX, indY, indW, indH, 8); else ctx.rect(indX, indY, indW, indH);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 13px Inter'; ctx.textAlign = 'center';
    const floorLabel = state.fpFloor === 0 ? 'Lobby' : `Guest Floor ${state.fpFloor}`;
    ctx.fillText(`Floor ${state.fpFloor}  ·  ${floorLabel}`, W / 2, H - 24);

    // Floor navigation buttons
    const navX = W - 56, navMid = H / 2;
    if (state.fpFloor < state.hotel.length - 1) {
        ctx.fillStyle = 'rgba(99,102,241,0.85)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(navX, navMid - 58, 44, 42, 8); else ctx.rect(navX, navMid - 58, 44, 42);
        ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 22px Inter'; ctx.textAlign = 'center';
        ctx.fillText('↑', navX + 22, navMid - 29);
        ctx.font = '9px Inter'; ctx.fillText('UP', navX + 22, navMid - 16);
    }
    if (state.fpFloor > 1) {
        ctx.fillStyle = 'rgba(99,102,241,0.85)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(navX, navMid + 16, 44, 42, 8); else ctx.rect(navX, navMid + 16, 44, 42);
        ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 22px Inter'; ctx.textAlign = 'center';
        ctx.fillText('↓', navX + 22, navMid + 43);
        ctx.font = '9px Inter'; ctx.fillText('DN', navX + 22, navMid + 56);
    }
};

CanvasRenderer.drawFPDoor = function(side, index, cell, W, H, fL, fR, fT, fB, t, dt) {
    if (dt === undefined) dt = 0.22;
    if (cell.type !== 'guest') return; // only guest rooms get a corridor door
    const ctx = this.ctx;
    const lerp = (a, b, t) => a + (b - a) * t;
    const t2 = t + dt;
    const topFrac = 0.08, botFrac = 0.09;

    // Determine grid coords from side/index
    const row = side === 'left' ? 0 : 1;
    const col = index;

    let x0, x1, yT0, yT1, yB0, yB1;
    if (side === 'left') {
        x0 = lerp(0, fL, t);  x1 = lerp(0, fL, t2);
    } else {
        x0 = lerp(W, fR, t);  x1 = lerp(W, fR, t2);
    }
    yT0 = lerp(H * topFrac, fT + (fB - fT) * topFrac, t);
    yT1 = lerp(H * topFrac, fT + (fB - fT) * topFrac, t2);
    yB0 = lerp(H * (1 - botFrac), fB - (fB - fT) * botFrac, t);
    yB1 = lerp(H * (1 - botFrac), fB - (fB - fT) * botFrac, t2);

    // Register click hit area (bounding box around this door)
    const xMin = Math.min(x0, x1), xMax = Math.max(x0, x1);
    this.fpDoorHitAreas.push({ xMin, xMax, yMin: yT0, yMax: yB0, row, col, f: state.fpFloor });

    let doorColor = '#1a2540', frameColor = '#b45309';
    if (cell.guestId)           { doorColor = '#0f1a10'; frameColor = '#166534'; }
    else if (cell.status === 'dirty')    { doorColor = '#1a0f0f'; frameColor = '#991b1b'; }
    else if (cell.status === 'building') { doorColor = '#1a1500'; frameColor = '#78350f'; }

    ctx.beginPath();
    ctx.moveTo(x0, yT0); ctx.lineTo(x1, yT1); ctx.lineTo(x1, yB1); ctx.lineTo(x0, yB0);
    ctx.closePath();
    ctx.fillStyle = doorColor; ctx.fill();
    ctx.strokeStyle = frameColor; ctx.lineWidth = Math.max(1, lerp(4, 0.5, t)); ctx.stroke();

    // Inner panel inset
    const inset = (x1 - x0) * 0.12, vi = (yB0 - yT0) * 0.06;
    ctx.strokeStyle = 'rgba(180,140,60,0.35)'; ctx.lineWidth = Math.max(0.5, lerp(1.5, 0.3, t));
    ctx.beginPath();
    ctx.moveTo(x0 + inset, yT0 + vi); ctx.lineTo(x1 - inset, yT1 + vi);
    ctx.lineTo(x1 - inset, yB1 - vi); ctx.lineTo(x0 + inset, yB0 - vi);
    ctx.closePath(); ctx.stroke();

    // Handle
    const hX = side === 'left' ? x0 + (x1 - x0) * 0.78 : x0 + (x1 - x0) * 0.22;
    const hY = (yT0 + yB0) / 2, hR = Math.max(1.5, lerp(5, 1.5, t));
    ctx.beginPath(); ctx.arc(hX, hY, hR, 0, Math.PI * 2);
    ctx.fillStyle = '#ca8a04'; ctx.fill();
    const leverDir = side === 'left' ? -1 : 1;
    ctx.beginPath(); ctx.moveTo(hX, hY); ctx.lineTo(hX + leverDir * hR * 2.5, hY + hR * 0.5);
    ctx.strokeStyle = '#ca8a04'; ctx.lineWidth = Math.max(0.8, lerp(2, 0.8, t)); ctx.stroke();

    // Room number above door
    const numFontSize = Math.max(8, lerp(16, 8, t));
    ctx.font = `bold ${numFontSize}px Inter`; ctx.fillStyle = '#cbd5e1'; ctx.textAlign = 'center';
    const roomNum = `${state.fpFloor}0${index + (side === 'right' ? GRID_COLS + 1 : 1)}`;
    ctx.fillText(roomNum, (x0 + x1) / 2, yT0 - Math.max(4, lerp(12, 4, t)));

    // Status icon
    let icon = '🛏️';
    if (cell.status === 'building') icon = '🔨';
    else if (cell.status === 'dirty') icon = '🧹';
    else if (cell.guestId) {
        const walker = state.walkers.find(w => w.id === cell.guestId);
        icon = (walker && walker.type === 'vip') ? '👑' : '🔒';
    }
    const iconSize = Math.max(10, lerp(26, 10, t));
    ctx.font = `${iconSize}px Inter`;
    ctx.fillText(icon, (x0 + x1) / 2, ((yT0 + yB0) / 2) + iconSize * 0.35);

    // Light under door for occupied rooms
    if (cell.guestId) {
        const alpha = 0.12 + Math.sin(Date.now() / 800) * 0.04;
        const slitH = Math.max(2, lerp(8, 2, t));
        ctx.fillStyle = `rgba(255,248,180,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(x0 + inset, yB0 - slitH); ctx.lineTo(x1 - inset, yB1 - slitH);
        ctx.lineTo(x1 - inset, yB1); ctx.lineTo(x0 + inset, yB0);
        ctx.closePath(); ctx.fill();
    }
};

CanvasRenderer.drawFPRoomInterior = function(cell, f, r, c) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;

    // Level palettes: N=window wall, S=door wall, E/W=side walls
    const palettes = [
        { N:'#1e3a5f', S:'#152d4a', E:'#102240', W:'#122440', floor:'#3b1a08', ceil:'#1a1a2e', accent:'#2563eb', name:'Standard Room' },
        { N:'#1a3d28', S:'#122e1e', E:'#0e2418', W:'#102618', floor:'#0d4a38', ceil:'#0f1f1a', accent:'#10b981', name:'Deluxe Suite' },
        { N:'#2a1f3d', S:'#1e1530', E:'#180d28', W:'#180e2a', floor:'#1e1b4b', ceil:'#1a1528', accent:'#d97706', name:'Executive Suite' },
        { N:'#2a1535', S:'#200e28', E:'#16091e', W:'#160a20', floor:'#2d0d3b', ceil:'#1a0d22', accent:'#a855f7', name:'Penthouse Suite' },
    ];
    const pal = palettes[Math.min(cell.level - 1, 3)];

    const hex2rgb = h => {
        const n = parseInt(h.replace('#',''), 16);
        return [(n>>16)&255, (n>>8)&255, n&255];
    };

    const horizon = Math.floor(H * 0.5);
    const FOV_RAD = Math.PI / 2;  // 90°
    const angle = state.fpRoomAngle * Math.PI / 180;

    // --- Background: ceiling + floor ---
    const ceilGrd = ctx.createLinearGradient(0, 0, 0, horizon);
    ceilGrd.addColorStop(0, pal.ceil);
    ceilGrd.addColorStop(1, pal.N + 'cc');
    ctx.fillStyle = ceilGrd;
    ctx.fillRect(0, 0, W, horizon);

    const flrGrd = ctx.createLinearGradient(0, horizon, 0, H);
    flrGrd.addColorStop(0, pal.floor + 'cc');
    flrGrd.addColorStop(1, '#050302');
    ctx.fillStyle = flrGrd;
    ctx.fillRect(0, horizon, W, H - horizon);

    // --- Raycaster: column-by-column wall rendering ---
    // Room is unit square [0,1]×[0,1], camera at center (0.5, 0.5).
    // Angle 0° = facing North (y=0, window wall).
    for (let x = 0; x < W; x++) {
        const rayAngle = angle + (x / W - 0.5) * FOV_RAD;
        const rdx = Math.sin(rayAngle);   // east = +x
        const rdy = -Math.cos(rayAngle);  // north = -y

        let tMin = Infinity, hitWall = null, hitU = 0;

        if (rdy < -1e-9) {
            const t = -0.5 / rdy;
            const hx = 0.5 + t * rdx;
            if (hx >= 0 && hx <= 1 && t < tMin) { tMin = t; hitWall = 'N'; hitU = hx; }
        }
        if (rdy > 1e-9) {
            const t = 0.5 / rdy;
            const hx = 0.5 + t * rdx;
            if (hx >= 0 && hx <= 1 && t < tMin) { tMin = t; hitWall = 'S'; hitU = hx; }
        }
        if (rdx > 1e-9) {
            const t = 0.5 / rdx;
            const hy = 0.5 + t * rdy;
            if (hy >= 0 && hy <= 1 && t < tMin) { tMin = t; hitWall = 'E'; hitU = hy; }
        }
        if (rdx < -1e-9) {
            const t = -0.5 / rdx;
            const hy = 0.5 + t * rdy;
            if (hy >= 0 && hy <= 1 && t < tMin) { tMin = t; hitWall = 'W'; hitU = hy; }
        }

        if (!hitWall) continue;

        // Fish-eye correction: perpendicular distance
        const perpDist = tMin * Math.cos(rayAngle - angle);
        const wallH = Math.min(H * 3, H * 0.5 / Math.max(0.01, perpDist));
        const wallTop = horizon - wallH / 2;
        const wallBot = horizon + wallH / 2;

        // Distance shading + side-wall dimming
        const shade = Math.min(1, Math.max(0.18, 1.0 - perpDist * 1.1));
        const sideMult = (hitWall === 'E' || hitWall === 'W') ? 0.72 : 1.0;
        const s = shade * sideMult;

        const [br, bg, bb] = hex2rgb(pal[hitWall]);
        ctx.fillStyle = `rgb(${Math.round(br*s+12)},${Math.round(bg*s+10)},${Math.round(bb*s+22)})`;
        ctx.fillRect(x, Math.max(0, wallTop), 1, Math.max(0, Math.min(H, wallBot) - Math.max(0, wallTop)));

        // --- North wall (window wall) features ---
        if (hitWall === 'N') {
            const colH = wallBot - wallTop;
            // Curtains: outermost 15% on each side
            if (hitU < 0.15 || hitU > 0.85) {
                const [ar, ag, ab] = hex2rgb(pal.accent);
                ctx.fillStyle = `rgba(${ar},${ag},${ab},${0.55 * shade})`;
                ctx.fillRect(x, Math.max(0, wallTop), 1, Math.max(0, Math.min(H, wallBot) - Math.max(0, wallTop)));
            }
            // Window glass: center 60% of wall, upper 50% of wall height
            if (hitU >= 0.15 && hitU <= 0.85) {
                const winTop = wallTop + colH * 0.06;
                const winBot = wallTop + colH * 0.56;
                if (winBot > winTop && winTop < H && winBot > 0) {
                    const winAlpha = cell.guestId ? 0.42 : 0.14;
                    ctx.fillStyle = `rgba(180,220,255,${winAlpha * shade})`;
                    ctx.fillRect(x, Math.max(0, winTop), 1, Math.max(0, Math.min(H, winBot) - Math.max(0, winTop)));
                }
                // Window frame cross lines at hitU=0.5 (vertical) — draw as thin dark strip
                if (Math.abs(hitU - 0.5) < 0.015) {
                    ctx.fillStyle = `rgba(100,60,10,${0.8*shade})`;
                    ctx.fillRect(x, Math.max(0, wallTop + colH*0.06), 1, Math.max(0, Math.min(H, wallBot) - Math.max(0, wallTop + colH*0.06)));
                }
            }
            // Wainscot trim stripe at 72% wall height
            const stripeY = wallTop + colH * 0.72;
            const stripeH = Math.max(1, colH * 0.04);
            ctx.fillStyle = `rgba(180,83,9,${0.4*shade})`;
            ctx.fillRect(x, Math.max(0, stripeY), 1, Math.max(0, Math.min(H, stripeY+stripeH) - Math.max(0, stripeY)));
        }

        // --- South wall (door wall) features ---
        if (hitWall === 'S') {
            const colH = wallBot - wallTop;
            // Door panel: center 45% of wall U, lower 82% height
            if (hitU >= 0.275 && hitU <= 0.725) {
                const doorTop = wallTop + colH * 0.12;
                const doorBot = wallBot - colH * 0.01;
                if (doorBot > doorTop) {
                    const ds = shade * 0.45;
                    const [dr, dg, db] = hex2rgb(pal.S);
                    ctx.fillStyle = `rgb(${Math.round(dr*ds)},${Math.round(dg*ds)},${Math.round(db*ds)})`;
                    ctx.fillRect(x, Math.max(0, doorTop), 1, Math.max(0, Math.min(H, doorBot) - Math.max(0, doorTop)));
                    // Door knob: small bright spot near U=0.62, V=0.55
                    if (Math.abs(hitU - 0.62) < 0.025) {
                        const knobY = wallTop + colH * 0.55;
                        ctx.fillStyle = `rgba(202,138,4,${shade})`;
                        ctx.fillRect(x, Math.max(0, knobY-2), 1, 4);
                    }
                }
            }
            // Wainscot stripe
            const colH2 = wallBot - wallTop;
            const sy = wallTop + colH2 * 0.72;
            ctx.fillStyle = `rgba(180,83,9,${0.4*shade})`;
            ctx.fillRect(x, Math.max(0, sy), 1, Math.max(0, Math.min(H, sy+Math.max(1,colH2*0.04)) - Math.max(0, sy)));
        }

        // --- East / West walls: accent stripe + wainscot ---
        if (hitWall === 'E' || hitWall === 'W') {
            const colH = wallBot - wallTop;
            const [ar, ag, ab] = hex2rgb(pal.accent);
            // Accent stripe at 68% wall height
            const sy = wallTop + colH * 0.68;
            ctx.fillStyle = `rgba(${ar},${ag},${ab},${0.32*shade})`;
            ctx.fillRect(x, Math.max(0, sy), 1, Math.max(0, Math.min(H, sy+Math.max(1,colH*0.05)) - Math.max(0, sy)));
            // Wainscot
            const wy = wallTop + colH * 0.73;
            ctx.fillStyle = `rgba(180,83,9,${0.3*shade})`;
            ctx.fillRect(x, Math.max(0, wy), 1, Math.max(0, Math.min(H, wy+Math.max(1,colH*0.03)) - Math.max(0, wy)));
        }
    }

    // --- Furniture sprites (depth-sorted, projected into raycaster space) ---
    // World space: x=0 West, x=1 East, y=0 North(window), y=1 South(door)
    // Camera at (0.5, 0.5); angle=0 = looking North.
    const bedColors4 = ['#2563eb','#10b981','#d97706','#a855f7'];
    const bedCol = cell.status === 'dirty' ? '#475569' : bedColors4[Math.min(cell.level-1,3)];

    const spriteDefs = [
        // Bed against West wall, centered north-south
        { x:0.13, y:0.50, h0:0.00, h1:0.18, w:0.40, color:'#78350f' },
        { x:0.13, y:0.50, h0:0.18, h1:0.36, w:0.38, color:bedCol },
        // Pillow near north end of bed
        { x:0.12, y:0.28, h0:0.34, h1:0.44, w:0.10, color: cell.status==='dirty'?'#94a3b8':'#f8fafc' },
        // Headboard (west-most, thin vertical slab)
        { x:0.04, y:0.50, h0:0.15, h1:0.72, w:0.40, color:'#451a03' },
        // Nightstand (level 2+)
        ...(cell.level >= 2 ? [
            { x:0.13, y:0.22, h0:0.00, h1:0.32, w:0.10, color:'#78350f' },
            { x:0.13, y:0.22, h0:0.32, h1:0.42, w:0.04, color:'#fef9c3' }, // lamp
        ] : []),
        // Desk + monitor on East wall (level 3+)
        ...(cell.level >= 3 ? [
            { x:0.87, y:0.26, h0:0.00, h1:0.30, w:0.38, color:'#1e293b' },
            { x:0.87, y:0.24, h0:0.30, h1:0.55, w:0.22, color:'#38bdf8' },
        ] : []),
        // Canopy posts (level 4)
        ...(cell.level >= 4 ? [
            { x:0.06, y:0.32, h0:0.15, h1:0.90, w:0.02, color:'#ca8a04' },
            { x:0.06, y:0.68, h0:0.15, h1:0.90, w:0.02, color:'#ca8a04' },
            { x:0.06, y:0.50, h0:0.87, h1:0.92, w:0.38, color:'#ca8a04' },
        ] : []),
    ];

    const fwd_x = Math.sin(angle), fwd_y = -Math.cos(angle);
    const rgt_x = Math.cos(angle), rgt_y =  Math.sin(angle);
    const hex2rgb2 = h => { const n=parseInt(h.replace('#',''),16); return [(n>>16)&255,(n>>8)&255,n&255]; };

    const projSprites = spriteDefs.map(sp => {
        const rx = sp.x - 0.5, ry = sp.y - 0.5;
        return { ...sp, fwd: rx*fwd_x + ry*fwd_y, rgt: rx*rgt_x + ry*rgt_y };
    }).filter(sp => sp.fwd > 0.04).sort((a,b) => b.fwd - a.fwd);

    for (const sp of projSprites) {
        const scale = H * 0.5 / sp.fwd;
        const sX = W/2 + (sp.rgt / sp.fwd) * (W/2);
        const sTop = horizon - (sp.h1 - 0.5) * scale;
        const sBot = horizon - (sp.h0 - 0.5) * scale;
        const sHW  = (sp.w * 0.5 / sp.fwd) * (W/2);
        const shade2 = Math.min(1, Math.max(0.25, 1 - sp.fwd * 1.1));
        const [rr,gg,bb] = hex2rgb2(sp.color);
        ctx.fillStyle = `rgb(${Math.round(rr*shade2)},${Math.round(gg*shade2)},${Math.round(bb*shade2)})`;
        ctx.fillRect(sX - sHW, Math.max(0, sTop), sHW * 2, Math.max(0, Math.min(H, sBot) - Math.max(0, sTop)));
    }

    // --- Ceiling light glow ---
    const lightGrd = ctx.createRadialGradient(W/2, 0, 0, W/2, 0, H * 0.6);
    lightGrd.addColorStop(0, 'rgba(255,248,200,0.20)');
    lightGrd.addColorStop(1, 'rgba(255,248,200,0)');
    ctx.fillStyle = lightGrd;
    ctx.fillRect(0, 0, W, horizon);
    ctx.beginPath(); ctx.arc(W/2, 12, 7, 0, Math.PI*2);
    ctx.fillStyle = '#fef9c3'; ctx.fill();

    // --- Floor perspective grid lines ---
    for (let i = 1; i <= 10; i++) {
        const t = i / 10;
        const y = horizon + t * (H - horizon);
        ctx.strokeStyle = `rgba(60,30,10,${0.28*(1-t)})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // --- Compass rose (top-right) ---
    const cxC = W - 42, cyC = 42, crC = 22;
    ctx.beginPath(); ctx.arc(cxC, cyC, crC, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(10,14,30,0.78)'; ctx.fill();
    ctx.strokeStyle = '#334155'; ctx.lineWidth = 1; ctx.stroke();
    ctx.save();
    ctx.translate(cxC, cyC);
    ctx.rotate(angle);  // angle=0 means N needle points up
    // N (red)
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.moveTo(0, -crC*0.78); ctx.lineTo(-3.5, 4); ctx.lineTo(3.5, 4); ctx.closePath(); ctx.fill();
    // S (white)
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath(); ctx.moveTo(0, crC*0.78); ctx.lineTo(-2.5, -4); ctx.lineTo(2.5, -4); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 7px Inter'; ctx.textAlign = 'center';
    ctx.fillText('N', cxC, cyC - crC + 8);

    // Facing label
    const normDeg = ((state.fpRoomAngle % 360) + 360) % 360;
    const facingWallName =
        normDeg < 45 || normDeg >= 315 ? 'Window Wall' :
        normDeg < 135 ? 'East Wall' :
        normDeg < 225 ? 'Door Wall' : 'West Wall';
    ctx.fillStyle = '#64748b'; ctx.font = '10px Inter'; ctx.textAlign = 'left';
    ctx.fillText(`Facing: ${facingWallName}  ·  Drag to rotate`, 18, 50);

    // --- Status overlays ---
    if (cell.status === 'building') {
        ctx.fillStyle = 'rgba(0,0,0,0.58)';
        ctx.fillRect(0, 0, W, H);
        ctx.font = 'bold 28px Inter'; ctx.textAlign = 'center'; ctx.fillStyle = '#fbbf24';
        ctx.fillText('🔨 Under Construction', W/2, H/2 - 20);
        const bw = 300, bh = 14;
        ctx.fillStyle = '#334155'; ctx.fillRect(W/2 - bw/2, H/2 + 10, bw, bh);
        ctx.fillStyle = '#fbbf24'; ctx.fillRect(W/2 - bw/2, H/2 + 10, bw * (cell.buildProgress/100), bh);
        ctx.fillStyle = '#e2e8f0'; ctx.font = '13px Inter';
        ctx.fillText(`${Math.floor(cell.buildProgress)}% complete`, W/2, H/2 + 38);
    } else if (cell.status === 'dirty') {
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
        ctx.font = 'bold 24px Inter'; ctx.textAlign = 'center'; ctx.fillStyle = '#f87171';
        ctx.fillText('🧹 Needs Cleaning', W/2, H/2);
    } else if (cell.guestId) {
        const walker = state.walkers.find(w => w.id === cell.guestId);
        const label = (walker && walker.type === 'vip') ? '👑 VIP Guest Staying' : '🔒 Guest Occupied';
        const gCol = (walker && walker.type === 'vip') ? '#f59e0b' : '#34d399';
        ctx.font = 'bold 18px Inter'; ctx.textAlign = 'center'; ctx.fillStyle = gCol;
        ctx.fillText(label, W/2, H - 80);
    }

    // --- Room level badge ---
    ctx.font = 'bold 14px Inter'; ctx.textAlign = 'left'; ctx.fillStyle = pal.accent;
    ctx.fillText(`★ ${pal.name}  ·  Floor ${f}`, 18, 30);

    // --- Back button ---
    ctx.fillStyle = 'rgba(15,23,42,0.82)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(14, H - 54, 130, 38, 8); else ctx.rect(14, H - 54, 130, 38);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 13px Inter'; ctx.textAlign = 'center';
    ctx.fillText('← Back to Corridor', 79, H - 28);
};
