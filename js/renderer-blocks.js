// renderer-blocks.js — depends on: constants.js, state.js, simulation.js, renderer-core.js

// All block/tile drawing methods — mixed into CanvasRenderer after definition.

const _rendererBlocks = {

    drawGround() {
        for (let r = -1; r <= GRID_ROWS + 1; r++) {
            for (let c = -1; c <= GRID_COLS + 1; c++) {
                const screen = isoToScreen(c, r, 0, this.canvas.width, this.canvas.height);
                const tw = TILE_WIDTH * state.zoom;
                const th = TILE_HEIGHT * state.zoom;

                this.ctx.beginPath();
                this.ctx.moveTo(screen.x, screen.y);
                this.ctx.lineTo(screen.x + tw, screen.y + th);
                this.ctx.lineTo(screen.x, screen.y + th * 2);
                this.ctx.lineTo(screen.x - tw, screen.y + th);
                this.ctx.closePath();

                this.ctx.fillStyle = (r + c) % 2 === 0 ? '#0f172a' : '#1e293b';
                this.ctx.fill();
                this.ctx.strokeStyle = '#334155';
                this.ctx.lineWidth = 0.5;
                this.ctx.stroke();
            }
        }
    },

    drawIsometricCube(cx, cy, width, height, colors, strokeColor, isHovered) {
        const w = width * state.zoom;
        const h = TILE_HEIGHT * 2 * state.zoom;
        const d = height * state.zoom;

        const leftX = cx - w;
        const rightX = cx + w;
        const topY = cy - d;
        const botY = cy + h;

        // Top
        this.ctx.beginPath();
        this.ctx.moveTo(cx, cy - d);
        this.ctx.lineTo(cx + w, cy - d + h/2);
        this.ctx.lineTo(cx, cy - d + h);
        this.ctx.lineTo(cx - w, cy - d + h/2);
        this.ctx.closePath();
        this.ctx.fillStyle = isHovered ? '#6366f1' : colors.top;
        this.ctx.fill();
        this.ctx.strokeStyle = strokeColor;
        this.ctx.lineWidth = 1;
        this.ctx.stroke();

        // Left
        this.ctx.beginPath();
        this.ctx.moveTo(cx - w, cy - d + h/2);
        this.ctx.lineTo(cx, cy - d + h);
        this.ctx.lineTo(cx, cy + h);
        this.ctx.lineTo(cx - w, cy + h/2);
        this.ctx.closePath();
        this.ctx.fillStyle = isHovered ? '#4f46e5' : colors.left;
        this.ctx.fill();
        this.ctx.stroke();

        // Right
        this.ctx.beginPath();
        this.ctx.moveTo(cx, cy - d + h);
        this.ctx.lineTo(cx + w, cy - d + h/2);
        this.ctx.lineTo(cx + w, cy + h/2);
        this.ctx.lineTo(cx, cy + h);
        this.ctx.closePath();
        this.ctx.fillStyle = isHovered ? '#3730a3' : colors.right;
        this.ctx.fill();
        this.ctx.stroke();
    },

    drawIsoBox(cx, cy, u1, u2, v1, v2, h1, h2, colors) {
        const p000 = getIsoLoc(cx, cy, u1, v1, h1);
        const p100 = getIsoLoc(cx, cy, u2, v1, h1);
        const p010 = getIsoLoc(cx, cy, u1, v2, h1);
        const p110 = getIsoLoc(cx, cy, u2, v2, h1);

        const p001 = getIsoLoc(cx, cy, u1, v1, h2);
        const p101 = getIsoLoc(cx, cy, u2, v1, h2);
        const p011 = getIsoLoc(cx, cy, u1, v2, h2);
        const p111 = getIsoLoc(cx, cy, u2, v2, h2);

        // Left Face
        this.ctx.beginPath();
        this.ctx.moveTo(p010.x, p010.y);
        this.ctx.lineTo(p110.x, p110.y);
        this.ctx.lineTo(p111.x, p111.y);
        this.ctx.lineTo(p011.x, p011.y);
        this.ctx.closePath();
        this.ctx.fillStyle = colors.left;
        this.ctx.fill();
        this.ctx.strokeStyle = colors.stroke || 'rgba(15,23,42,0.15)';
        this.ctx.stroke();

        // Right Face
        this.ctx.beginPath();
        this.ctx.moveTo(p100.x, p100.y);
        this.ctx.lineTo(p110.x, p110.y);
        this.ctx.lineTo(p111.x, p111.y);
        this.ctx.lineTo(p101.x, p101.y);
        this.ctx.closePath();
        this.ctx.fillStyle = colors.right;
        this.ctx.fill();
        this.ctx.stroke();

        // Top Face
        this.ctx.beginPath();
        this.ctx.moveTo(p001.x, p001.y);
        this.ctx.lineTo(p101.x, p101.y);
        this.ctx.lineTo(p111.x, p111.y);
        this.ctx.lineTo(p011.x, p011.y);
        this.ctx.closePath();
        this.ctx.fillStyle = colors.top;
        this.ctx.fill();
        this.ctx.stroke();
    },

    // Transparent lift track lines drawn behind rooms
    drawElevatorShaftBackLine() {
        const base = isoToScreen(ELEVATOR_C, ELEVATOR_R, 0, this.canvas.width, this.canvas.height);
        const ePosBottom = getIsoLoc(base.x, base.y, ELEVATOR_U, ELEVATOR_V, 0);
        const ePosTop = getIsoLoc(base.x, base.y, ELEVATOR_U, ELEVATOR_V, state.hotel.length);

        this.ctx.beginPath();
        this.ctx.moveTo(ePosBottom.x, ePosBottom.y);
        this.ctx.lineTo(ePosTop.x, ePosTop.y);
        this.ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)';
        this.ctx.lineWidth = 14 * state.zoom;
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.moveTo(ePosBottom.x, ePosBottom.y);
        this.ctx.lineTo(ePosTop.x, ePosTop.y);
        this.ctx.strokeStyle = 'rgba(34, 211, 238, 0.4)';
        this.ctx.lineWidth = 2 * state.zoom;
        this.ctx.stroke();
    },

    drawElevatorCabins() {
        const base = isoToScreen(ELEVATOR_C, ELEVATOR_R, 0, this.canvas.width, this.canvas.height);

        // Scan for riders
        state.walkers.forEach(w => {
            if (w.state === 'elevator_up' || w.state === 'elevator_down') {
                // Don't draw cabin when it's visually inside a guest room at the elevator column
                const floorIndex = Math.round(w.f);
                if (floorIndex >= 1 && floorIndex < state.hotel.length) {
                    const cellAtShaft = state.hotel[floorIndex]?.[ELEVATOR_R]?.[ELEVATOR_C];
                    if (cellAtShaft && cellAtShaft.type === 'guest') return;
                }
                const cabPos = getIsoLoc(base.x, base.y, ELEVATOR_U, ELEVATOR_V, w.f);

                // Draw glowing sliding glass bubble cabin
                this.ctx.beginPath();
                this.ctx.arc(cabPos.x, cabPos.y - 12 * state.zoom, 10 * state.zoom, 0, Math.PI * 2);
                this.ctx.fillStyle = 'rgba(6, 182, 212, 0.15)';
                this.ctx.fill();
                this.ctx.strokeStyle = '#22d3ee';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();

                // Small light flare inside cabin
                this.ctx.beginPath();
                this.ctx.arc(cabPos.x - 3 * state.zoom, cabPos.y - 15 * state.zoom, 3 * state.zoom, 0, Math.PI * 2);
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                this.ctx.fill();
            }
        });
    },

    drawLobbyBlock(col, row, floor, isHovered) {
        const screen = isoToScreen(col, row, floor, this.canvas.width, this.canvas.height);

        if (state.viewMode === 'exterior') {
            const colors = { top: '#1e293b', left: '#0f172a', right: '#020617' };
            this.drawIsometricCube(screen.x, screen.y, TILE_WIDTH, FLOOR_HEIGHT, colors, '#334155', isHovered);
            return;
        }

        // Back-Left Wall
        const w1 = getIsoLoc(screen.x, screen.y, 0, 0, 0);
        const w2 = getIsoLoc(screen.x, screen.y, 1, 0, 0);
        const w3 = getIsoLoc(screen.x, screen.y, 1, 0, 1);
        const w4 = getIsoLoc(screen.x, screen.y, 0, 0, 1);
        this.ctx.beginPath();
        this.ctx.moveTo(w1.x, w1.y); this.ctx.lineTo(w2.x, w2.y); this.ctx.lineTo(w3.x, w3.y); this.ctx.lineTo(w4.x, w4.y);
        this.ctx.closePath();
        this.ctx.fillStyle = isHovered ? '#1e1b4b' : '#1e293b';
        this.ctx.fill();
        this.ctx.strokeStyle = '#334155';
        this.ctx.stroke();

        // Back-Right Wall
        const wr1 = getIsoLoc(screen.x, screen.y, 0, 0, 0);
        const wr2 = getIsoLoc(screen.x, screen.y, 0, 1, 0);
        const wr3 = getIsoLoc(screen.x, screen.y, 0, 1, 1);
        const wr4 = getIsoLoc(screen.x, screen.y, 0, 0, 1);
        this.ctx.beginPath();
        this.ctx.moveTo(wr1.x, wr1.y); this.ctx.lineTo(wr2.x, wr2.y); this.ctx.lineTo(wr3.x, wr3.y); this.ctx.lineTo(wr4.x, wr4.y);
        this.ctx.closePath();
        this.ctx.fillStyle = isHovered ? '#0f172a' : '#0f172a';
        this.ctx.fill();
        this.ctx.strokeStyle = '#334155';
        this.ctx.stroke();

        // Checkered Lobby Marble floor
        for (let u = 0; u < 1; u += 0.25) {
            for (let v = 0; v < 1; v += 0.25) {
                const f1 = getIsoLoc(screen.x, screen.y, u, v, 0);
                const f2 = getIsoLoc(screen.x, screen.y, u + 0.25, v, 0);
                const f3 = getIsoLoc(screen.x, screen.y, u + 0.25, v + 0.25, 0);
                const f4 = getIsoLoc(screen.x, screen.y, u, v + 0.25, 0);

                this.ctx.beginPath();
                this.ctx.moveTo(f1.x, f1.y); this.ctx.lineTo(f2.x, f2.y); this.ctx.lineTo(f3.x, f3.y); this.ctx.lineTo(f4.x, f4.y);
                this.ctx.closePath();
                this.ctx.fillStyle = (Math.round(u * 4) + Math.round(v * 4)) % 2 === 0 ? '#334155' : '#475569';
                this.ctx.fill();
                this.ctx.strokeStyle = 'rgba(15,23,42,0.15)';
                this.ctx.stroke();
            }
        }

        // --- Furniture Layout ---
        // Mahogany Reception Counter desk
        this.drawIsoBox(screen.x, screen.y, 0.4, 0.7, 0.4, 0.52, 0, 0.35, {
            top: '#78350f', left: '#92400e', right: '#b45309', stroke: '#451a03'
        });

        // Cozy Red Lounge sofa
        this.drawIsoBox(screen.x, screen.y, 0.1, 0.25, 0.45, 0.85, 0, 0.18, {
            top: '#dc2626', left: '#b91c1c', right: '#991b1b'
        });
        this.drawIsoBox(screen.x, screen.y, 0.1, 0.15, 0.45, 0.85, 0.18, 0.38, {
            top: '#b91c1c', left: '#991b1b', right: '#7f1d1d'
        });

        // Decorative plant pots
        this.drawIsoBox(screen.x, screen.y, 0.82, 0.92, 0.12, 0.22, 0, 0.2, {
            top: '#d97706', left: '#b45309', right: '#92400e'
        });
        const plantLoc = getIsoLoc(screen.x, screen.y, 0.87, 0.17, 0.35);
        this.ctx.beginPath();
        this.ctx.arc(plantLoc.x, plantLoc.y, 5 * state.zoom, 0, Math.PI * 2);
        this.ctx.fillStyle = '#059669';
        this.ctx.fill();
    },

    drawGuestBlock(col, row, floor, cell, isHovered) {
        const screen = isoToScreen(col, row, floor, this.canvas.width, this.canvas.height);

        if (state.viewMode === 'exterior') {
            let colors = { top: '#cbd5e1', left: '#94a3b8', right: '#64748b' };
            if (cell.level === 2) colors = { top: '#93c5fd', left: '#60a5fa', right: '#2563eb' };
            if (cell.level === 3) colors = { top: '#fde047', left: '#facc15', right: '#ca8a04' };
            if (cell.level >= 4) colors = { top: '#c084fc', left: '#a855f7', right: '#7e22ce' };

            this.drawIsometricCube(screen.x, screen.y, TILE_WIDTH, FLOOR_HEIGHT, colors, '#475569', isHovered);
            this.drawWindows(screen, cell);
            this.drawRoomStatusIcons(screen, cell);
            return;
        }

        // Inside layout theme wallpapers
        let wallL = '#e2e8f0';
        let wallR = '#cbd5e1';
        let floorL = '#78350f';
        let floorR = '#5b21b6'; // defaults

        if (cell.level === 2) { // Deluxe Teal Carpet
            wallL = '#f0fdf4'; wallR = '#dcfce7'; floorL = '#0d9488'; floorR = '#0f766e';
        } else if (cell.level === 3) { // Royal Indigo Wall
            wallL = '#e0e7ff'; wallR = '#c7d2fe'; floorL = '#312e81'; floorR = '#1e1b4b';
        } else if (cell.level >= 4) { // Platinum Suite
            wallL = '#faf5ff'; wallR = '#f3e8ff'; floorL = '#581c87'; floorR = '#4c1d95';
        } else { // Standard Wood planks
            floorL = '#a16207'; floorR = '#854d0e';
        }

        // Draw Left Wall Frame
        const wl1 = getIsoLoc(screen.x, screen.y, 0, 0, 0);
        const wl2 = getIsoLoc(screen.x, screen.y, 1, 0, 0);
        const wl3 = getIsoLoc(screen.x, screen.y, 1, 0, 1);
        const wl4 = getIsoLoc(screen.x, screen.y, 0, 0, 1);
        this.ctx.beginPath();
        this.ctx.moveTo(wl1.x, wl1.y); this.ctx.lineTo(wl2.x, wl2.y); this.ctx.lineTo(wl3.x, wl3.y); this.ctx.lineTo(wl4.x, wl4.y);
        this.ctx.closePath();
        this.ctx.fillStyle = isHovered ? '#6366f1' : (cell.status === 'building' ? '#475569' : wallL);
        this.ctx.fill();
        this.ctx.strokeStyle = '#94a3b8';
        this.ctx.stroke();

        // Draw Right Wall Frame
        const wr1 = getIsoLoc(screen.x, screen.y, 0, 0, 0);
        const wr2 = getIsoLoc(screen.x, screen.y, 0, 1, 0);
        const wr3 = getIsoLoc(screen.x, screen.y, 0, 1, 1);
        const wr4 = getIsoLoc(screen.x, screen.y, 0, 0, 1);
        this.ctx.beginPath();
        this.ctx.moveTo(wr1.x, wr1.y); this.ctx.lineTo(wr2.x, wr2.y); this.ctx.lineTo(wr3.x, wr3.y); this.ctx.lineTo(wr4.x, wr4.y);
        this.ctx.closePath();
        this.ctx.fillStyle = isHovered ? '#4f46e5' : (cell.status === 'building' ? '#334155' : wallR);
        this.ctx.fill();
        this.ctx.strokeStyle = '#94a3b8';
        this.ctx.stroke();

        // Check if under active build progress
        if (cell.status === 'building') {
            this.drawBuildupStages(screen, cell);
        } else {
            // Standard Planks floor
            for (let u = 0; u < 1; u += 0.2) {
                const f1 = getIsoLoc(screen.x, screen.y, u, 0, 0);
                const f2 = getIsoLoc(screen.x, screen.y, u + 0.2, 0, 0);
                const f3 = getIsoLoc(screen.x, screen.y, u + 0.2, 1, 0);
                const f4 = getIsoLoc(screen.x, screen.y, u, 1, 0);

                this.ctx.beginPath();
                this.ctx.moveTo(f1.x, f1.y); this.ctx.lineTo(f2.x, f2.y); this.ctx.lineTo(f3.x, f3.y); this.ctx.lineTo(f4.x, f4.y);
                this.ctx.closePath();
                this.ctx.fillStyle = (Math.round(u * 5) % 2 === 0) ? floorL : floorR;
                this.ctx.fill();
                this.ctx.strokeStyle = 'rgba(15,23,42,0.1)';
                this.ctx.stroke();
            }

            // Draw Furniture depending on Luxury Suite level
            this.drawSuiteFurniture(screen, cell);
        }

        // Overlay status indicators
        this.drawRoomStatusIcons(screen, cell);
    },

    drawFacilityBlock(col, row, floor, cell, isHovered) {
        const screen = isoToScreen(col, row, floor, this.canvas.width, this.canvas.height);
        const isRest = cell.type === 'restaurant';

        if (state.viewMode === 'exterior') {
            const colors = isRest
                ? { top: '#fb923c', left: '#ea580c', right: '#9a3412' }
                : { top: '#64748b', left: '#475569', right: '#334155' };
            this.drawIsometricCube(screen.x, screen.y, TILE_WIDTH, FLOOR_HEIGHT, colors, '#1e293b', isHovered);
            if (isRest) {
                this.drawWindows(screen, { guestId: cell.status === 'ready' ? 1 : null });
            }
            this.drawRoomStatusIcons(screen, cell);
            return;
        }

        const wallL = isRest ? '#fff7ed' : '#e2e8f0';
        const wallR = isRest ? '#ffedd5' : '#cbd5e1';

        const wl1 = getIsoLoc(screen.x, screen.y, 0, 0, 0);
        const wl2 = getIsoLoc(screen.x, screen.y, 1, 0, 0);
        const wl3 = getIsoLoc(screen.x, screen.y, 1, 0, 1);
        const wl4 = getIsoLoc(screen.x, screen.y, 0, 0, 1);
        this.ctx.beginPath();
        this.ctx.moveTo(wl1.x, wl1.y); this.ctx.lineTo(wl2.x, wl2.y); this.ctx.lineTo(wl3.x, wl3.y); this.ctx.lineTo(wl4.x, wl4.y);
        this.ctx.closePath();
        this.ctx.fillStyle = isHovered ? '#6366f1' : (cell.status === 'building' ? '#475569' : wallL);
        this.ctx.fill();
        this.ctx.strokeStyle = '#94a3b8';
        this.ctx.stroke();

        const wr1 = getIsoLoc(screen.x, screen.y, 0, 0, 0);
        const wr2 = getIsoLoc(screen.x, screen.y, 0, 1, 0);
        const wr3 = getIsoLoc(screen.x, screen.y, 0, 1, 1);
        const wr4 = getIsoLoc(screen.x, screen.y, 0, 0, 1);
        this.ctx.beginPath();
        this.ctx.moveTo(wr1.x, wr1.y); this.ctx.lineTo(wr2.x, wr2.y); this.ctx.lineTo(wr3.x, wr3.y); this.ctx.lineTo(wr4.x, wr4.y);
        this.ctx.closePath();
        this.ctx.fillStyle = isHovered ? '#4f46e5' : (cell.status === 'building' ? '#334155' : wallR);
        this.ctx.fill();
        this.ctx.strokeStyle = '#94a3b8';
        this.ctx.stroke();

        if (cell.status === 'building') {
            this.drawBuildupStages(screen, cell);
        } else if (isRest) {
            const floorA = '#9a3412';
            const floorB = '#7c2d12';
            for (let u = 0; u < 1; u += 0.2) {
                const f1 = getIsoLoc(screen.x, screen.y, u, 0, 0);
                const f2 = getIsoLoc(screen.x, screen.y, u + 0.2, 0, 0);
                const f3 = getIsoLoc(screen.x, screen.y, u + 0.2, 1, 0);
                const f4 = getIsoLoc(screen.x, screen.y, u, 1, 0);
                this.ctx.beginPath();
                this.ctx.moveTo(f1.x, f1.y); this.ctx.lineTo(f2.x, f2.y); this.ctx.lineTo(f3.x, f3.y); this.ctx.lineTo(f4.x, f4.y);
                this.ctx.closePath();
                this.ctx.fillStyle = (Math.round(u * 5) % 2 === 0) ? floorA : floorB;
                this.ctx.fill();
            }
            this.drawIsoBox(screen.x, screen.y, 0.2, 0.55, 0.25, 0.55, 0, 0.22, { top: '#fef3c7', left: '#fde68a', right: '#fcd34d' });
            this.drawIsoBox(screen.x, screen.y, 0.55, 0.85, 0.35, 0.75, 0, 0.22, { top: '#fef3c7', left: '#fde68a', right: '#fcd34d' });
            this.drawIsoBox(screen.x, screen.y, 0.42, 0.58, 0.42, 0.58, 0.32, 0.38, { top: '#dc2626', left: '#b91c1c', right: '#991b1b' });
        } else {
            const asph1 = '#334155';
            const asph2 = '#1e293b';
            for (let u = 0; u < 1; u += 0.2) {
                const f1 = getIsoLoc(screen.x, screen.y, u, 0, 0);
                const f2 = getIsoLoc(screen.x, screen.y, u + 0.2, 0, 0);
                const f3 = getIsoLoc(screen.x, screen.y, u + 0.2, 1, 0);
                const f4 = getIsoLoc(screen.x, screen.y, u, 1, 0);
                this.ctx.beginPath();
                this.ctx.moveTo(f1.x, f1.y); this.ctx.lineTo(f2.x, f2.y); this.ctx.lineTo(f3.x, f3.y); this.ctx.lineTo(f4.x, f4.y);
                this.ctx.closePath();
                this.ctx.fillStyle = (Math.round(u * 5) % 2 === 0) ? asph1 : asph2;
                this.ctx.fill();
            }
            const yl = '#facc15';
            this.ctx.strokeStyle = yl;
            this.ctx.lineWidth = 2.2 * state.zoom;
            const p1 = getIsoLoc(screen.x, screen.y, 0.08, 0.15, 0.02);
            const p2 = getIsoLoc(screen.x, screen.y, 0.92, 0.85, 0.02);
            this.ctx.beginPath();
            this.ctx.moveTo(p1.x, p1.y);
            this.ctx.lineTo(p2.x, p2.y);
            this.ctx.stroke();
            this.drawIsoBox(screen.x, screen.y, 0.72, 0.92, 0.08, 0.22, 0, 0.2, { top: '#fbbf24', left: '#f59e0b', right: '#d97706' });
        }

        this.drawRoomStatusIcons(screen, cell);
    },

    // 4-Stage visual buildup loop
    drawBuildupStages(screen, cell) {
        const progress = cell.buildProgress;

        // Stage 1: Concrete base & Raw Steel Rebars [0% - 30%]
        if (progress <= 30) {
            // Concrete base slab
            const f1 = getIsoLoc(screen.x, screen.y, 0, 0, 0);
            const f2 = getIsoLoc(screen.x, screen.y, 1, 0, 0);
            const f3 = getIsoLoc(screen.x, screen.y, 1, 1, 0);
            const f4 = getIsoLoc(screen.x, screen.y, 0, 1, 0);
            this.ctx.beginPath();
            this.ctx.moveTo(f1.x, f1.y); this.ctx.lineTo(f2.x, f2.y); this.ctx.lineTo(f3.x, f3.y); this.ctx.lineTo(f4.x, f4.y);
            this.ctx.closePath();
            this.ctx.fillStyle = '#64748b';
            this.ctx.fill();
            this.ctx.strokeStyle = '#475569';
            this.ctx.stroke();

            // Raw structural steel pillars
            const colSize = 0.08;
            this.drawIsoBox(screen.x, screen.y, 0.05, 0.05 + colSize, 0.05, 0.05 + colSize, 0, 0.8, { top: '#cbd5e1', left: '#94a3b8', right: '#475569' });
            this.drawIsoBox(screen.x, screen.y, 0.85, 0.85 + colSize, 0.05, 0.05 + colSize, 0, 0.8, { top: '#cbd5e1', left: '#94a3b8', right: '#475569' });
            this.drawIsoBox(screen.x, screen.y, 0.05, 0.05 + colSize, 0.85, 0.85 + colSize, 0, 0.8, { top: '#cbd5e1', left: '#94a3b8', right: '#475569' });

            // Concrete aggregate bags on floor
            this.drawIsoBox(screen.x, screen.y, 0.4, 0.55, 0.4, 0.55, 0, 0.15, { top: '#cbd5e1', left: '#94a3b8', right: '#64748b' });
            this.drawIsoBox(screen.x, screen.y, 0.45, 0.6, 0.42, 0.57, 0.15, 0.28, { top: '#cbd5e1', left: '#94a3b8', right: '#64748b' });
        }
        // Stage 2: Wood framing studs [31% - 65%]
        else if (progress <= 65) {
            // Timber plywood floor
            const f1 = getIsoLoc(screen.x, screen.y, 0, 0, 0);
            const f2 = getIsoLoc(screen.x, screen.y, 1, 0, 0);
            const f3 = getIsoLoc(screen.x, screen.y, 1, 1, 0);
            const f4 = getIsoLoc(screen.x, screen.y, 0, 1, 0);
            this.ctx.beginPath();
            this.ctx.moveTo(f1.x, f1.y); this.ctx.lineTo(f2.x, f2.y); this.ctx.lineTo(f3.x, f3.y); this.ctx.lineTo(f4.x, f4.y);
            this.ctx.closePath();
            this.ctx.fillStyle = '#b45309';
            this.ctx.fill();

            // Timber wall frame studs
            for (let u = 0.1; u < 1.0; u += 0.2) {
                this.drawIsoBox(screen.x, screen.y, u, u + 0.04, 0.02, 0.06, 0, 0.95, { top: '#f59e0b', left: '#d97706', right: '#92400e' });
            }
            for (let v = 0; v < 1.0; v += 0.2) {
                this.drawIsoBox(screen.x, screen.y, 0.02, 0.06, v, v + 0.04, 0, 0.95, { top: '#f59e0b', left: '#d97706', right: '#92400e' });
            }
            // Horizontal top plate beam
            this.drawIsoBox(screen.x, screen.y, 0.02, 0.98, 0.02, 0.06, 0.92, 0.97, { top: '#f59e0b', left: '#d97706', right: '#92400e' });
        }
        // Stage 3: Drywalls & Electrical hanging bulbs [66% - 90%]
        else if (progress <= 90) {
            // Rough drywall boards
            const f1 = getIsoLoc(screen.x, screen.y, 0, 0, 0);
            const f2 = getIsoLoc(screen.x, screen.y, 1, 0, 0);
            const f3 = getIsoLoc(screen.x, screen.y, 1, 1, 0);
            const f4 = getIsoLoc(screen.x, screen.y, 0, 1, 0);
            this.ctx.beginPath();
            this.ctx.moveTo(f1.x, f1.y); this.ctx.lineTo(f2.x, f2.y); this.ctx.lineTo(f3.x, f3.y); this.ctx.lineTo(f4.x, f4.y);
            this.ctx.closePath();
            this.ctx.fillStyle = '#d1d5db';
            this.ctx.fill();

            // Dangling electric bulb
            const ceil = getIsoLoc(screen.x, screen.y, 0.5, 0.5, 1.0);
            const bulb = getIsoLoc(screen.x, screen.y, 0.5, 0.5, 0.6);
            this.ctx.beginPath();
            this.ctx.moveTo(ceil.x, ceil.y);
            this.ctx.lineTo(bulb.x, bulb.y);
            this.ctx.strokeStyle = '#1e293b';
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();

            this.ctx.beginPath();
            this.ctx.arc(bulb.x, bulb.y, 3.5 * state.zoom, 0, Math.PI*2);
            this.ctx.fillStyle = '#fef08a';
            this.ctx.fill();

            // Paint cans and wood crates
            this.drawIsoBox(screen.x, screen.y, 0.3, 0.42, 0.6, 0.72, 0, 0.22, { top: '#cbd5e1', left: '#94a3b8', right: '#475569' });
            this.drawIsoBox(screen.x, screen.y, 0.7, 0.8, 0.3, 0.4, 0, 0.2, { top: '#f43f5e', left: '#e11d48', right: '#be123c' });
        }
        // Stage 4: Wrapped furniture [91% - 99%]
        else {
            // Wood floor boards laid
            const f1 = getIsoLoc(screen.x, screen.y, 0, 0, 0);
            const f2 = getIsoLoc(screen.x, screen.y, 1, 0, 0);
            const f3 = getIsoLoc(screen.x, screen.y, 1, 1, 0);
            const f4 = getIsoLoc(screen.x, screen.y, 0, 1, 0);
            this.ctx.beginPath();
            this.ctx.moveTo(f1.x, f1.y); this.ctx.lineTo(f2.x, f2.y); this.ctx.lineTo(f3.x, f3.y); this.ctx.lineTo(f4.x, f4.y);
            this.ctx.closePath();
            this.ctx.fillStyle = '#a16207';
            this.ctx.fill();

            // Draw bed wrapped in white protective tarp sheet
            this.drawIsoBox(screen.x, screen.y, 0.1, 0.8, 0.1, 0.5, 0, 0.28, {
                top: '#f8fafc', left: '#f1f5f9', right: '#e2e8f0'
            });
            // Cardboard toolboxes
            this.drawIsoBox(screen.x, screen.y, 0.4, 0.6, 0.65, 0.85, 0, 0.25, {
                top: '#ea580c', left: '#c2410c', right: '#9a3412'
            });
        }
    },

    drawSuiteFurniture(screen, cell) {
        let blanket = '#2563eb';
        let pillow = '#ffffff';

        if (cell.status === 'dirty') {
            blanket = '#475569';
            pillow = '#94a3b8';
        } else if (cell.level === 2) {
            blanket = '#10b981';
        } else if (cell.level === 3) {
            blanket = '#d97706';
        } else if (cell.level >= 4) {
            blanket = '#a855f7';
        }

        // Bed Base frame
        this.drawIsoBox(screen.x, screen.y, 0.1, 0.8, 0.1, 0.5, 0, 0.18, {
            top: '#78350f', left: '#5b21b6', right: '#451a03'
        });
        // Comfortable Mattress
        this.drawIsoBox(screen.x, screen.y, 0.15, 0.75, 0.12, 0.48, 0.18, 0.26, {
            top: blanket, left: blanket, right: blanket
        });
        // Soft Pillow
        this.drawIsoBox(screen.x, screen.y, 0.15, 0.32, 0.18, 0.42, 0.26, 0.31, {
            top: pillow, left: pillow, right: pillow
        });

        // Bedside drawer (Lvl 2+)
        if (cell.level >= 2) {
            this.drawIsoBox(screen.x, screen.y, 0.1, 0.25, 0.7, 0.85, 0, 0.22, {
                top: '#92400e', left: '#78350f', right: '#451a03'
            });
            // Nightstand light lamp glowing
            this.drawIsoBox(screen.x, screen.y, 0.14, 0.21, 0.74, 0.81, 0.22, 0.35, {
                top: '#fef08a', left: '#facc15', right: '#ca8a04'
            });
        }

        // Deluxe Rug and High-Tech Work desk (Lvl 3+)
        if (cell.level >= 3) {
            // Elegant velvet rug
            this.drawIsoBox(screen.x, screen.y, 0.3, 0.75, 0.55, 0.9, 0, 0.01, {
                top: '#1e3a8a', left: '#1e40af', right: '#1d4ed8'
            });
            // Executive computer desk
            this.drawIsoBox(screen.x, screen.y, 0.55, 0.85, 0.75, 0.9, 0, 0.26, {
                top: '#1e293b', left: '#334155', right: '#0f172a'
            });
            // Monitor screen glow
            this.drawIsoBox(screen.x, screen.y, 0.65, 0.75, 0.78, 0.84, 0.26, 0.36, {
                top: '#38bdf8', left: '#0284c7', right: '#0369a1'
            });
        }

        // Luxury Canopy bed framing (Lvl 4+)
        if (cell.level >= 4) {
            const bp = 0.03;
            this.drawIsoBox(screen.x, screen.y, 0.1, 0.1+bp, 0.1, 0.1+bp, 0, 0.8, { top: '#ca8a04', left: '#eab308', right: '#854d0e' });
            this.drawIsoBox(screen.x, screen.y, 0.8-bp, 0.8, 0.1, 0.1+bp, 0, 0.8, { top: '#ca8a04', left: '#eab308', right: '#854d0e' });
            this.drawIsoBox(screen.x, screen.y, 0.1, 0.1+bp, 0.5-bp, 0.5, 0, 0.8, { top: '#ca8a04', left: '#eab308', right: '#854d0e' });
            this.drawIsoBox(screen.x, screen.y, 0.8-bp, 0.8, 0.5-bp, 0.5, 0, 0.8, { top: '#ca8a04', left: '#eab308', right: '#854d0e' });
        }
    },

    drawWindows(screen, cell) {
        const w = TILE_WIDTH * state.zoom;
        const h = TILE_HEIGHT * 2 * state.zoom;
        const d = FLOOR_HEIGHT * state.zoom;

        this.ctx.fillStyle = cell.guestId ? '#fef08a' : '#1e293b';
        this.ctx.strokeStyle = '#475569';
        this.ctx.lineWidth = 1;

        const winW = 8 * state.zoom;
        const winH = 15 * state.zoom;

        // Left Window
        this.ctx.beginPath();
        const lx1 = screen.x - w * 0.4;
        const ly1 = screen.y + h/2 * 0.35 - d/2;
        this.ctx.moveTo(lx1, ly1);
        this.ctx.lineTo(lx1 + winW, ly1 + winW/2);
        this.ctx.lineTo(lx1 + winW, ly1 + winW/2 + winH);
        this.ctx.lineTo(lx1, ly1 + winH);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();

        // Right Window
        this.ctx.beginPath();
        const rx1 = screen.x + w * 0.15;
        const ry1 = screen.y + h/2 * 0.9 - d/2;
        this.ctx.moveTo(rx1, ry1);
        this.ctx.lineTo(rx1 + winW, ry1 - winW/2);
        this.ctx.lineTo(rx1 + winW, ry1 - winW/2 + winH);
        this.ctx.lineTo(rx1, ry1 + winH);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();
    },

    drawRoomStatusIcons(screen, cell) {
        const fontSize = 10 * state.zoom;
        this.ctx.font = `bold ${fontSize}px Inter`;
        this.ctx.textAlign = 'center';

        const bounceOffset = Math.sin(Date.now() / 250) * 3 * state.zoom;
        const drawY = screen.y - (FLOOR_HEIGHT * 0.85 * state.zoom) + bounceOffset;

        if (cell.status === 'building') {
            const barW = 40 * state.zoom;
            const barH = 5 * state.zoom;

            this.ctx.fillStyle = '#334155';
            this.ctx.fillRect(screen.x - barW/2, drawY - 10, barW, barH);
            this.ctx.fillStyle = '#fbbf24';
            this.ctx.fillRect(screen.x - barW/2, drawY - 10, barW * (cell.buildProgress / 100), barH);

            this.ctx.fillStyle = '#e2e8f0';
            this.ctx.fillText("🔨 BUILD", screen.x, drawY - 15);
        } else if (cell.status === 'dirty' && cell.type === 'guest') {
            this.ctx.fillStyle = '#f87171';
            this.ctx.fillText("🧹 DIRTY", screen.x, drawY);
        } else if (cell.type === 'restaurant' && cell.status === 'ready') {
            this.ctx.fillStyle = '#fb923c';
            this.ctx.fillText("🍽 OPEN", screen.x, drawY);
        } else if (cell.type === 'parking' && cell.status === 'ready') {
            this.ctx.fillStyle = '#94a3b8';
            this.ctx.fillText("🅿️ OPEN", screen.x, drawY);
        } else if (cell.guestId) {
            // Find walker to verify if VIP
            const walker = state.walkers.find(w => w.id === cell.guestId);
            const prefix = (walker && walker.type === 'vip') ? "👑 VIP" : "👤 OCCUPIED";
            this.ctx.fillStyle = (walker && walker.type === 'vip') ? '#f59e0b' : '#34d399';
            const starStr = "★".repeat(cell.level);
            this.ctx.fillText(`${prefix} (${starStr})`, screen.x, drawY);
        } else {
            this.ctx.fillStyle = '#94a3b8';
            this.ctx.fillText("🛏️ VACANT", screen.x, drawY);
        }
    }

};

// Mix all block-drawing methods into CanvasRenderer
Object.assign(CanvasRenderer, _rendererBlocks);
