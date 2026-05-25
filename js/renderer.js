const CanvasRenderer = {
    canvas: null,
    ctx: null,
    hoveredTile: null,
    fpDoorHitAreas: [],  // populated each frame in drawFPDoor for click detection

    init(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());

        // FP room drag-rotation state
        let fpDragActive = false;
        let fpDragStartX = 0;
        let fpDragStartAngle = 0;

        this.canvas.addEventListener('mousedown', (e) => {
            if (state.viewMode === 'firstperson' && state.fpRoom) {
                fpDragActive = true;
                fpDragStartX = e.clientX;
                fpDragStartAngle = state.fpRoomAngle;
            }
        });
        this.canvas.addEventListener('mouseup', () => { fpDragActive = false; });
        this.canvas.addEventListener('mouseleave', () => { fpDragActive = false; });

        // Track mouse selection
        this.canvas.addEventListener('mousemove', (e) => {
            if (fpDragActive) {
                state.fpRoomAngle = fpDragStartAngle + (e.clientX - fpDragStartX) * 0.3;
                return;
            }
            if (state.viewMode === 'firstperson') { this.hoveredTile = null; return; }
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            this.hoveredTile = null;
            // Scan top levels down to secure click ordering
            for (let f = state.hotel.length - 1; f >= 0; f--) {
                for (let r = 0; r < GRID_ROWS; r++) {
                    for (let c = 0; c < GRID_COLS; c++) {
                        const cell = state.hotel[f][r][c];
                        if (cell.type !== 'empty') {
                            if (isPointInIsometricTile(mouseX, mouseY, c, r, f, this.canvas.width, this.canvas.height)) {
                                this.hoveredTile = { f, r, c, cell };
                                return;
                            }
                        }
                    }
                }
            }
        });

        // Trigger manual clicks
        this.canvas.addEventListener('click', (e) => {
            if (state.viewMode === 'firstperson') {
                const rect = this.canvas.getBoundingClientRect();
                const mx = e.clientX - rect.left, my = e.clientY - rect.top;
                const W = this.canvas.width, H = this.canvas.height;

                // If in room interior view
                if (state.fpRoom) {
                    // Back button: x 14-144, y H-54 to H-16
                    if (mx >= 14 && mx <= 144 && my >= H - 54 && my <= H - 16) {
                        state.fpRoom = null;
                    }
                    return;
                }

                // Corridor view: check door hit areas
                for (const area of this.fpDoorHitAreas) {
                    if (mx >= area.xMin && mx <= area.xMax && my >= area.yMin && my <= area.yMax) {
                        state.fpRoom = { f: area.f, r: area.row, c: area.col };
                        return;
                    }
                }

                // Floor nav buttons
                const navX = W - 56, navMid = H / 2;
                if (mx >= navX && mx <= navX + 44 && my >= navMid - 58 && my <= navMid - 16) {
                    if (state.fpFloor < state.hotel.length - 1) state.fpFloor++;
                }
                if (mx >= navX && mx <= navX + 44 && my >= navMid + 16 && my <= navMid + 58) {
                    if (state.fpFloor > 0) state.fpFloor--;
                }
                return;
            }
            if (this.hoveredTile) {
                const { f, r, c, cell } = this.hoveredTile;
                const screen = isoToScreen(c, r, f, this.canvas.width, this.canvas.height);
                const clickPos = getIsoLoc(screen.x, screen.y, 0.5, 0.5, 0.5);

                if (cell.status === 'building') {
                    cell.buildProgress = Math.min(100, cell.buildProgress + 8);
                    AudioEngine.playBuild();
                    for(let i=0; i<6; i++) {
                        addParticle(clickPos.x + (Math.random()*16 - 8), clickPos.y + (Math.random()*16 - 8), '', '#f59e0b', Math.random()*2 - 1, -Math.random()*2, 3, 'spark');
                    }
                    if (cell.buildProgress >= 100) {
                        cell.buildProgress = 100;
                        cell.status = 'ready';
                        AudioEngine.playUpgrade();
                        populateUpgradeSelect();
                        showToast("Construction Complete!", "Suite is ready for guests!", 'success');
                    } else {
                        showToast("Construction Assisted!", `Blueprint speed increased. Now at ${Math.floor(cell.buildProgress)}%`, 'success');
                    }
                } else if (cell.status === 'dirty') {
                    cell.cleanliness += 20;
                    AudioEngine.playClean();
                    for(let i=0; i<6; i++) {
                        addParticle(clickPos.x + (Math.random()*16 - 8), clickPos.y + (Math.random()*16 - 8), '', '#cbd5e1', Math.random()*2 - 1, -Math.random()*2, 4, 'dust');
                    }
                    if (cell.cleanliness >= 100) {
                        cell.cleanliness = 100;
                        cell.status = 'ready';
                        showToast("Room Hand Cleaned!", "Suite fully sanitized and vacant.", "success");
                    } else {
                        showToast("Sweeping...", `Room is ${cell.cleanliness}% clean`, 'info');
                    }
                }
            }
        });
    },

    resize() {
        this.canvas.width = this.canvas.parentElement.clientWidth;
        this.canvas.height = this.canvas.parentElement.clientHeight;
    },

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (state.viewMode === 'firstperson') {
            this.drawFirstPersonView();
            this.drawParticles();
            return;
        }
        this.drawGround();

        // 1. Draw Glass Elevator Column Track (Behind the rooms)
        this.drawElevatorShaftBackLine();

        // 2. Render stacking hotel layout blocks depth first
        for (let f = 0; f < state.hotel.length; f++) {
            for (let r = 0; r < GRID_ROWS; r++) {
                for (let c = 0; c < GRID_COLS; c++) {
                    const cell = state.hotel[f][r][c];
                    const isHovered = this.hoveredTile && this.hoveredTile.f === f && this.hoveredTile.r === r && this.hoveredTile.c === c;
                    
                    if (cell.type === 'lobby') {
                        this.drawLobbyBlock(c, r, f, isHovered);
                    } else if (cell.type === 'guest') {
                        this.drawGuestBlock(c, r, f, cell, isHovered);
                    }
                }
            }
        }

        // 3. Draw Active Elevator Cabins sliding smoothly
        this.drawElevatorCabins();

        // 4. Render Walkers
        this.drawWalkers();

        // 5. Render Particle Sparks
        this.drawParticles();
    },

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
        } else if (cell.status === 'dirty') {
            this.ctx.fillStyle = '#f87171';
            this.ctx.fillText("🧹 DIRTY", screen.x, drawY);
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
    },

    drawWalkers() {
        state.walkers.forEach(w => {
            const screen = isoToScreen(w.c, w.r, w.f, this.canvas.width, this.canvas.height);
            const pos = getIsoLoc(screen.x, screen.y, w.u, w.v, 0);

            // Hide walker if riding the lift shaft elevator capsule (we draw capsule separately)
            if (w.state === 'elevator_up' || w.state === 'elevator_down') {
                return;
            }

            const frame = Math.floor(w.animFrame) % 8;
            const walkBob = (w.state === 'housekeeping' || w.state === 'building' || w.state === 'entering' || w.state === 'walking_to_room' || w.state === 'exiting') 
                ? Math.abs(Math.sin(w.animFrame * 0.35)) * 4 * state.zoom : 0;

            // Horizontal flip if walking left
            const scaleX = w.facingRight ? 1 : -1;

            this.ctx.save();
            this.ctx.translate(pos.x, pos.y - walkBob);

            // Sleep rendering (Horizontal in bed)
            if (w.state === 'sleeping') {
                this.ctx.restore(); // reset translate
                // Draw horizontal sleeping head on mattress
                const sleepPos = getIsoLoc(screen.x, screen.y, 0.24, 0.32, 0.28);
                this.ctx.beginPath();
                this.ctx.arc(sleepPos.x, sleepPos.y, 3 * state.zoom, 0, Math.PI * 2);
                this.ctx.fillStyle = '#fed7aa';
                this.ctx.fill();
                return;
            }

            // Head
            this.ctx.beginPath();
            this.ctx.arc(0, -12 * state.zoom, 3.5 * state.zoom, 0, Math.PI * 2);
            this.ctx.fillStyle = '#fed7aa';
            this.ctx.fill();

            // Crown for VIP instead of regular hair!
            if (w.type === 'vip') {
                this.ctx.fillStyle = '#f59e0b'; // golden yellow
                this.ctx.strokeStyle = '#d97706';
                this.ctx.lineWidth = 0.5 * state.zoom;
                this.ctx.beginPath();
                this.ctx.moveTo(-4 * state.zoom, -15.5 * state.zoom);
                this.ctx.lineTo(-4 * state.zoom, -19.5 * state.zoom);
                this.ctx.lineTo(-2 * state.zoom, -17.5 * state.zoom);
                this.ctx.lineTo(0, -21 * state.zoom);
                this.ctx.lineTo(2 * state.zoom, -17.5 * state.zoom);
                this.ctx.lineTo(4 * state.zoom, -19.5 * state.zoom);
                this.ctx.lineTo(4 * state.zoom, -15.5 * state.zoom);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();
            } else {
                // Regular Hair
                this.ctx.fillStyle = w.hairColor;
                this.ctx.fillRect(-3 * state.zoom, -17 * state.zoom, 6 * state.zoom, 2.5 * state.zoom);
            }

            // Body Uniform
            this.ctx.fillStyle = w.shirtColor;
            this.ctx.fillRect(-3.5 * scaleX * state.zoom, -9 * state.zoom, 7 * state.zoom, 9 * state.zoom);

            // Arm detailing
            this.ctx.fillStyle = '#fed7aa';
            if (w.state === 'housekeeping') {
                // Broom sweep stick
                this.ctx.beginPath();
                this.ctx.moveTo(3 * scaleX * state.zoom, -4 * state.zoom);
                this.ctx.lineTo(9 * scaleX * state.zoom, 3 * state.zoom);
                this.ctx.strokeStyle = '#b45309';
                this.ctx.lineWidth = 1.5;
                this.ctx.stroke();
            } else if (w.state === 'building') {
                // Hammer tapping wall
                this.ctx.fillStyle = '#64748b';
                this.ctx.fillRect(4 * scaleX * state.zoom, -9 * state.zoom, 3 * state.zoom, 1.5 * state.zoom);
                this.ctx.fillStyle = '#cbd5e1';
                this.ctx.fillRect(7 * scaleX * state.zoom, -11 * state.zoom, 1.5 * state.zoom, 5 * state.zoom);
            }

            this.ctx.restore();

            // Dialogue speech balloons
            if (w.moodText && w.moodTimer > 0) {
                this.ctx.fillStyle = '#ffffff';
                this.ctx.strokeStyle = '#1e293b';
                this.ctx.lineWidth = 1;
                this.ctx.font = `bold ${8 * state.zoom}px Inter`;
                
                const txtW = this.ctx.measureText(w.moodText).width + 8;
                const bY = pos.y - 18 * state.zoom;
                
                this.ctx.beginPath();
                this.ctx.roundRect(pos.x - txtW/2, bY - 12, txtW, 14, 4);
                this.ctx.fill();
                this.ctx.stroke();

                this.ctx.fillStyle = '#0f172a';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(w.moodText, pos.x, bY - 2);
            }
        });
    },

    drawFirstPersonView() {
        // If a room is selected, show its interior instead
        if (state.fpRoom) {
            const { f, r, c } = state.fpRoom;
            const cell = state.hotel[f] && state.hotel[f][r] && state.hotel[f][r][c];
            if (cell) { this.drawFPRoomInterior(cell, f, r, c); return; }
            state.fpRoom = null;  // stale reference — fall through to corridor
        }

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
        if (state.fpFloor > 0) {
            ctx.fillStyle = 'rgba(99,102,241,0.85)';
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(navX, navMid + 16, 44, 42, 8); else ctx.rect(navX, navMid + 16, 44, 42);
            ctx.fill();
            ctx.fillStyle = '#fff'; ctx.font = 'bold 22px Inter'; ctx.textAlign = 'center';
            ctx.fillText('↓', navX + 22, navMid + 43);
            ctx.font = '9px Inter'; ctx.fillText('DN', navX + 22, navMid + 56);
        }
    },

    drawFPDoor(side, index, cell, W, H, fL, fR, fT, fB, t, dt = 0.22) {
        if (cell.type === 'empty') return;
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
    },

    drawFPRoomInterior(cell, f, r, c) {
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
    },

    drawParticles() {
        state.particles.forEach(p => {
            this.ctx.save();
            this.ctx.globalAlpha = p.life;
            if (p.type === 'text') {
                this.ctx.font = `bold ${p.size * state.zoom}px Inter`;
                this.ctx.fillStyle = p.color;
                this.ctx.textAlign = 'center';
                this.ctx.fillText(p.text, p.x, p.y);
            } else {
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size * state.zoom, 0, Math.PI * 2);
                this.ctx.fillStyle = p.color;
                this.ctx.fill();
            }
            this.ctx.restore();
        });
    }
};

// Market Dynamics
