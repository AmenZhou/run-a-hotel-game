// Renderer Core — isometric canvas rendering
// Depends on: constants.js, state.js, simulation.js

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
            if ((state.viewMode === 'firstperson' || state.viewMode === 'manager') && state.fpRoom) {
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
            if (state.viewMode === 'firstperson' || state.viewMode === 'manager') {
                this.hoveredTile = null;
                return;
            }
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const picked = pickHoveredIsoTile(mouseX, mouseY, this.canvas.width, this.canvas.height);
            this.hoveredTile = picked
                ? { f: picked.f, r: picked.r, c: picked.c, cell: picked.cell }
                : null;
        });

        // Trigger manual clicks
        this.canvas.addEventListener('click', (e) => {
            if (state.viewMode === 'firstperson' || state.viewMode === 'manager') {
                const rect = this.canvas.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;
                const W = this.canvas.width;
                const H = this.canvas.height;

                if (state.fpRoom) {
                    if (mx >= 14 && mx <= 144 && my >= H - 54 && my <= H - 16) {
                        state.fpRoom = null;
                        Room3DRenderer.hide();
                    }
                    return;
                }

                if (state.viewMode === 'firstperson') {
                    for (const area of this.fpDoorHitAreas) {
                        if (mx >= area.xMin && mx <= area.xMax && my >= area.yMin && my <= area.yMax) {
                            state.fpRoom = { f: area.f, r: area.row, c: area.col };
                            return;
                        }
                    }

                    const navX = W - 56;
                    const navMid = H / 2;
                    if (mx >= navX && mx <= navX + 44 && my >= navMid - 58 && my <= navMid - 16) {
                        if (state.fpFloor < state.hotel.length - 1) state.fpFloor++;
                    }
                    if (mx >= navX && mx <= navX + 44 && my >= navMid + 16 && my <= navMid + 58) {
                        if (state.fpFloor > 1) state.fpFloor--;
                    }
                }
                return;
            }
            if (this.hoveredTile) {
                const { f, r, c, cell } = this.hoveredTile;
                const screen = isoToScreen(c, r, f, this.canvas.width, this.canvas.height);
                const clickPos = getIsoLoc(screen.x, screen.y, 0.5, 0.5, 0.5);

                // Owner click-to-move: In Inside view, send owner to clicked cell centre
                if (state.viewMode === 'inside' && typeof window.moveOwnerTo === 'function') {
                    window.moveOwnerTo(f, c + 0.5, r + 0.5);
                }

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
                        let msg = 'Structure is ready.';
                        if (cell.type === 'guest') msg = 'Suite is ready for guests!';
                        else if (cell.type === 'restaurant') msg = 'Restaurant is open for service!';
                        else if (cell.type === 'parking') msg = 'Parking deck is ready!';
                        showToast("Construction Complete!", msg, 'success');
                    } else {
                        showToast("Construction Assisted!", `Blueprint speed increased. Now at ${Math.floor(cell.buildProgress)}%`, 'success');
                    }
                } else if (cell.type === 'guest' && cell.status === 'dirty') {
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
        if (state.viewMode === 'manager') {
            if (state.fpRoom) {
                this.drawFirstPersonView();
            } else {
                this.drawManagerRaycastView();
            }
            this.drawParticles();
            return;
        }
        Room3DRenderer.hide(); // hide 3D overlay in isometric / exterior views

        const pivX = this.canvas.width / 2 + state.panX;
        const pivY = this.canvas.height / 2 + state.panY + 120;
        const yaw = state.isoYaw || 0;
        this.ctx.save();
        this.ctx.translate(pivX, pivY);
        this.ctx.rotate(yaw);
        this.ctx.translate(-pivX, -pivY);

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
                    } else if (cell.type === 'restaurant' || cell.type === 'parking') {
                        this.drawFacilityBlock(c, r, f, cell, isHovered);
                    }
                }
            }
        }

        // 3. Draw Active Elevator Cabins sliding smoothly
        this.drawElevatorCabins();

        // 4. Render Walkers (owner walker included — type='owner' handled in drawWalkers)
        this.drawWalkers();

        // 4b. Hotel proprietor (lobby) — static fallback; skip if owner walker is present
        if (!state.walkers.find(w => w.id === 'owner')) {
            this.drawHotelOwner();
        }

        // 4c. Owner destination marker (pulsing ring at target cell when moving)
        this.drawOwnerDestinationMarker();

        // 5. Render Particle Sparks
        this.drawParticles();

        this.ctx.restore();
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
    },

    /**
     * Two-line pill above a walker: STAFF vs GUEST, then role (Housekeeper, Builder, Reception, Guest, VIP Guest).
     * @param {number} cx - screen x (center)
     * @param {number} tagBottomY - canvas Y of the bottom edge of the tag (just above the head; below this Y is the character)
     * @param {object} w - walker
     */
    drawWalkerIdentityTag(cx, tagBottomY, w) {
        const ctx = this.ctx;
        let isGuest = w.type === 'guest' || w.type === 'vip';
        let category;
        let role;
        if (w.type === 'owner') {
            category = 'OWNER';
            role = (state.hotelOwner && state.hotelOwner.name) ? String(state.hotelOwner.name) : 'You';
            isGuest = false;
        } else {
            category = isGuest ? 'GUEST' : 'STAFF';
            role = 'Guest';
            if (w.type === 'vip') role = 'VIP Guest';
            else if (w.type === 'guest') role = 'Guest';
            else if (w.type === 'housekeeper') role = 'Housekeeper';
            else if (w.type === 'builder') role = 'Builder';
            else if (w.type === 'receptionist') role = 'Reception';
            else if (w.type === 'chef') role = 'Chef';
            else if (w.type === 'valet') role = 'Valet';
        }

        const zt = Math.max(0.55, Math.min(2.4, state.zoom));
        const fsCat = Math.max(5, Math.min(11, 5.5 * zt));
        const fsRole = Math.max(6, Math.min(13, 6.5 * zt));
        const pad = Math.max(3, 3 * zt);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.font = `700 ${fsCat}px Inter,system-ui,sans-serif`;
        const wCat = ctx.measureText(category).width;
        ctx.font = `800 ${fsRole}px Inter,system-ui,sans-serif`;
        const wRole = ctx.measureText(role).width;
        const bw = Math.max(wCat, wRole) + pad * 2;
        const lineGap = 1;
        const bh = fsCat + fsRole + pad * 2 + lineGap;
        const rx = cx - bw / 2;
        const ry = tagBottomY - bh;

        let fill = '#1e293b';
        let border = '#64748b';
        if (isGuest) {
            fill = w.type === 'vip' ? '#451a03' : '#172554';
            border = w.type === 'vip' ? '#fbbf24' : '#60a5fa';
        } else if (w.type === 'housekeeper') {
            fill = '#500724';
            border = '#f472b6';
        } else if (w.type === 'builder') {
            fill = '#422006';
            border = '#f59e0b';
        } else if (w.type === 'receptionist') {
            fill = '#042f2e';
            border = '#2dd4bf';
        } else if (w.type === 'chef') {
            fill = '#431407';
            border = '#fb923c';
        } else if (w.type === 'valet') {
            fill = '#082f49';
            border = '#38bdf8';
        } else if (w.type === 'owner') {
            fill = '#1e1b4b';
            border = '#eab308';
        }

        ctx.fillStyle = fill;
        ctx.strokeStyle = border;
        ctx.lineWidth = Math.max(1, 1.1 * zt);
        const rr = Math.min(8, 3 + 2 * zt);
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(rx, ry, bw, bh, rr);
        } else {
            ctx.rect(rx, ry, bw, bh);
        }
        ctx.fill();
        ctx.stroke();

        let y = ry + pad + fsCat * 0.72;
        ctx.fillStyle = '#e2e8f0';
        ctx.font = `700 ${fsCat}px Inter,system-ui,sans-serif`;
        ctx.fillText(category, cx, y);

        y += fsCat * 0.35 + fsRole * 0.72;
        ctx.fillStyle = '#f8fafc';
        ctx.font = `800 ${fsRole}px Inter,system-ui,sans-serif`;
        ctx.fillText(role, cx, y);

        ctx.restore();
    },

    /** Proprietor figure in the lobby (floor 0); drawn after walkers for visibility. */
    drawHotelOwner() {
        if (state.viewMode !== 'inside') return;
        const o = state.hotelOwner;
        if (!o) return;

        const screen = isoToScreen(0, 0, 0, this.canvas.width, this.canvas.height);
        const pos = getIsoLoc(screen.x, screen.y, 0.78, 0.48, 0);
        const bob = Math.sin((o.animFrame || 0) * 1.35) * 2.2 * state.zoom;
        const ctx = this.ctx;
        const z = state.zoom;

        ctx.save();
        ctx.translate(pos.x, pos.y - bob);

        ctx.beginPath();
        ctx.arc(0, -12 * z, 3.5 * z, 0, Math.PI * 2);
        ctx.fillStyle = '#fde4d4';
        ctx.fill();

        ctx.fillStyle = '#64748b';
        ctx.fillRect(-3.5 * z, -17.5 * z, 7 * z, 3 * z);

        ctx.fillStyle = '#172554';
        ctx.fillRect(-4 * z, -9 * z, 8 * z, 10 * z);

        ctx.fillStyle = '#ca8a04';
        ctx.fillRect(-0.8 * z, -8 * z, 1.6 * z, 6.5 * z);

        ctx.strokeStyle = 'rgba(234,179,8,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(-4 * z, -9 * z, 8 * z, 10 * z);

        ctx.restore();

        const headTop = pos.y - bob - 16 * z;
        this.drawWalkerIdentityTag(pos.x, headTop - 4, { type: 'owner', id: '_hotel_owner' });
    },

    /** Draw a pulsing ring at the owner's target cell while they are walking. */
    drawOwnerDestinationMarker() {
        if (state.viewMode !== 'inside') return;
        const ownerW = state.walkers.find(w => w.id === 'owner');
        if (!ownerW || ownerW.state !== 'owner_walking') return;

        const targetGridX = ownerW.targetGridX;
        const targetGridY = ownerW.targetGridY;
        const tFloor      = ownerW.targetF;

        // Convert flat grid coords back into tile col/row for isoToScreen
        const tCol = Math.floor(targetGridX);
        const tRow = Math.floor(targetGridY);
        const screen = isoToScreen(tCol, tRow, tFloor, this.canvas.width, this.canvas.height);
        // Sub-tile offset within the tile
        const subU = targetGridY - tRow;   // row offset
        const subV = targetGridX - tCol;   // col offset
        const pos   = getIsoLoc(screen.x, screen.y, subU, subV, 0);

        const pulse = 0.55 + 0.45 * Math.sin(Date.now() / 200);
        const radius = 6 * state.zoom;
        const ctx = this.ctx;

        ctx.save();
        ctx.globalAlpha = 0.75 * pulse;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y - 2 * state.zoom, radius, 0, Math.PI * 2);
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth   = 2.5;
        ctx.stroke();

        // Outer ring (slightly larger, more transparent)
        ctx.globalAlpha = 0.35 * pulse;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y - 2 * state.zoom, radius * 1.55, 0, Math.PI * 2);
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth   = 1.5;
        ctx.stroke();
        ctx.restore();
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
            const walkBob = (w.state === 'housekeeping' || w.state === 'building' || w.state === 'entering' || w.state === 'walking_to_room' || w.state === 'exiting' || w.state === 'owner_walking')
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
                const sz = state.zoom;
                const headTopS = sleepPos.y - 3 * sz;
                this.drawWalkerIdentityTag(sleepPos.x, headTopS - 4, w);
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

            // Owner suit details: gold tie stripe
            if (w.type === 'owner') {
                this.ctx.fillStyle = '#ca8a04';
                this.ctx.fillRect(-0.8 * state.zoom, -8 * state.zoom, 1.6 * state.zoom, 6.5 * state.zoom);
                this.ctx.strokeStyle = 'rgba(234,179,8,0.5)';
                this.ctx.lineWidth = 1;
                this.ctx.strokeRect(-3.5 * state.zoom, -9 * state.zoom, 7 * state.zoom, 9 * state.zoom);
            }

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

            const z = state.zoom;
            const headTop = pos.y - walkBob - (w.type === 'vip' ? 21 : 15.5) * z;
            const moodLift = (w.moodText && w.moodTimer > 0) ? 24 * z : 0;
            this.drawWalkerIdentityTag(pos.x, headTop - 3 - moodLift, w);

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
