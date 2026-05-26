// renderer-core.js — depends on: constants.js, state.js, simulation.js
// Block/tile drawing methods live in renderer-blocks.js (mixed in via Object.assign after this file loads).

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
            else if (w.type === 'diner') { category = 'GUEST'; role = 'Diner'; }
            else if (w.type === 'driver') { category = 'GUEST'; role = 'Driver'; }
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
            const walkBob = (w.state === 'housekeeping' || w.state === 'building' || w.state === 'entering' || w.state === 'walking_to_room' || w.state === 'exiting' || w.state === 'owner_walking' || w.state === 'facility_exit')
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
