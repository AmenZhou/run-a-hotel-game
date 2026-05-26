// simulation-walkers.js — depends on: constants.js, state.js, simulation.js

// Walker System Controller
function spawnWalker(type, assignedRoomId = null) {
    const isGuest = type === 'guest' || type === 'vip';
    const id = `${type}_${Math.random().toString(36).substr(2, 9)}`;

    const walker = {
        id,
        type,
        f: 0, // start ground floor
        r: 1, // start front floor cell
        c: 1,
        u: 0.8, // start near lobby gate entrance
        v: 0.8,
        targetF: 0,
        targetR: 1,
        targetC: 1,
        targetU: 0.8,
        targetV: 0.8,
        state: 'entering', // entering, waiting_checkin, elevator_up, walking_to_room, living, housekeeping, building, exiting
        speed: 0.05,
        facingRight: true,
        assignedRoom: assignedRoomId, // {f, r, c} room reference
        animFrame: Math.random() * 100,
        hairColor: type === 'vip' ? '#ffffff' : ['#f59e0b', '#dc2626', '#3b82f6', '#10b981', '#ffffff', '#475569'][Math.floor(Math.random() * 6)],
        shirtColor: type === 'vip' ? '#f59e0b' : (isGuest ? ['#ef4444', '#10b981', '#3b82f6', '#a855f7', '#ec4899'][Math.floor(Math.random() * 5)] : (type === 'housekeeper' ? '#db2777' : (type === 'chef' ? '#fb923c' : (type === 'valet' ? '#38bdf8' : '#d97706')))),
        moodText: type === 'vip' ? '👑 VIP' : '',
        moodTimer: type === 'vip' ? 5.0 : 0,
        // Slightly shorter stays than early builds — more checkouts = steadier cash dopamine
        stayTime: type === 'vip'
            ? 18 + Math.floor(Math.random() * 10)
            : 10 + Math.floor(Math.random() * 14)
    };

    if (type === 'receptionist') {
        walker.r = 0; walker.c = 0;
        walker.u = 0.5; walker.v = 0.25;
        walker.targetU = 0.5; walker.targetV = 0.25;
        walker.state = 'serving';
    } else if (type === 'housekeeper') {
        // Starts in Lobby resting area
        walker.r = 0; walker.c = 0;
        walker.u = 0.2; walker.v = 0.6;
        walker.targetU = 0.2; walker.targetV = 0.6;
        walker.state = 'idle';
    } else if (type === 'builder') {
        walker.r = 0; walker.c = 1;
        walker.u = 0.7; walker.v = 0.5;
        walker.targetU = 0.7; walker.targetV = 0.5;
        walker.state = 'idle';
    } else if (type === 'chef') {
        walker.r = 0; walker.c = 2;
        walker.u = 0.3; walker.v = 0.4;
        walker.targetU = 0.3; walker.targetV = 0.4;
        walker.state = 'idle';
    } else if (type === 'valet') {
        walker.r = 1; walker.c = 2;
        walker.u = 0.5; walker.v = 0.5;
        walker.targetU = 0.5; walker.targetV = 0.5;
        walker.state = 'idle';
    } else if (isGuest) {
        // Guests immediately head to the Reception Desk
        walker.targetR = 0; walker.targetC = 0;
        walker.targetU = 0.5; walker.targetV = 0.6;
    }

    state.walkers.push(walker);
    return id;
}

// Complete precise continuous coordinate movement system
function moveTowards(w, f, r, c, u, v, dt) {
    const worldR = w.r + w.u;
    const worldC = w.c + w.v;
    const targetR = r + u;
    const targetC = c + v;

    const dR = targetR - worldR;
    const dC = targetC - worldC;
    const dist = Math.sqrt(dR*dR + dC*dC);

    const step = w.speed * dt * state.gameSpeed;
    w.animFrame += dt * state.gameSpeed;

    if (dist <= step) {
        w.f = f;
        w.r = r;
        w.c = c;
        w.u = u;
        w.v = v;
        return true; // Reached goal
    } else {
        const angle = Math.atan2(dC, dR);
        const nextR = worldR + Math.cos(angle) * step;
        const nextC = worldC + Math.sin(angle) * step;

        w.r = Math.floor(nextR);
        w.c = Math.floor(nextC);
        w.u = nextR - w.r;
        w.v = nextC - w.c;
        w.f = f;

        w.facingRight = (dC >= 0);
        return false;
    }
}

const STAFF_TRAINING_JOB_KEYS = ['housekeeper', 'builder', 'receptionist'];

function getStaffTrainingLevel(job) {
    const cap = CONSTANTS.staffTraining.maxLevel;
    if (!STAFF_TRAINING_JOB_KEYS.includes(job) || !state.staffTrainingLevels) return 0;
    return Math.min(cap, Math.max(0, state.staffTrainingLevels[job] | 0));
}

/** Per-second cleanliness gain while a housekeeper is actively housekeeping (scaled by training). */
function getHousekeeperCleanRate() {
    const base = 30;
    const lv = getStaffTrainingLevel('housekeeper');
    const e = CONSTANTS.staffTraining.jobs.housekeeper.effectPerLevel;
    return base * (1 + e * lv);
}

/** Automated builder construction progress per second (before × dt × gameSpeed). */
function getBuilderConstructionRate() {
    const base = 0.8;
    const lv = getStaffTrainingLevel('builder');
    const e = CONSTANTS.staffTraining.jobs.builder.effectPerLevel;
    return base * (1 + e * lv);
}

/** Multiplier on the per-receptionist booking odds contribution (see `triggerGuestBooking`). */
function getReceptionistBookingMultiplier() {
    const lv = getStaffTrainingLevel('receptionist');
    const e = CONSTANTS.staffTraining.jobs.receptionist.effectPerLevel;
    return 1 + e * lv;
}

/**
 * True if this housekeeper is already reserved for this room (walking, in elevator, or cleaning).
 * Idle walkers are not counted — elevator states must use `_preElevatorState === 'heading_to_clean'`
 * so a second HK does not pick the same dirty suite while the first is between floors.
 */
function isHousekeeperCommittedToRoom(ww, room) {
    if (ww.type !== 'housekeeper' || ww.assignedRoom !== room) return false;
    if (ww.state === 'heading_to_clean' || ww.state === 'housekeeping') return true;
    if ((ww.state === 'elevator_up' || ww.state === 'elevator_down') && ww._preElevatorState === 'heading_to_clean') {
        return true;
    }
    return false;
}

/**
 * Dirty room not already claimed by another housekeeper (heading, elevator leg, or cleaning).
 */
function findDirtyRoomForHousekeeper(selfWalker) {
    for (let f = 1; f < state.hotel.length; f++) {
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const room = state.hotel[f][r][c];
                if (room.type !== 'guest' || room.status !== 'dirty') continue;
                const claimed = state.walkers.some(ww =>
                    ww.id !== selfWalker.id &&
                    isHousekeeperCommittedToRoom(ww, room)
                );
                if (!claimed) return { room, f, r, c };
            }
        }
    }
    return null;
}

/** Builder reserved for this build site (including elevator transit toward the site). */
function isBuilderCommittedToRoom(ww, room) {
    if (ww.type !== 'builder' || ww.assignedRoom !== room) return false;
    if (ww.state === 'heading_to_build' || ww.state === 'building') return true;
    if ((ww.state === 'elevator_up' || ww.state === 'elevator_down') && ww._preElevatorState === 'heading_to_build') {
        return true;
    }
    return false;
}

/** Building room not already claimed by another builder. */
function findBuildingSiteForBuilder(selfWalker) {
    for (let f = 1; f < state.hotel.length; f++) {
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const room = state.hotel[f][r][c];
                const buildable = room.type === 'guest' || room.type === 'restaurant' || room.type === 'parking';
                if (!buildable || room.status !== 'building') continue;
                const claimed = state.walkers.some(ww =>
                    ww.id !== selfWalker.id &&
                    isBuilderCommittedToRoom(ww, room)
                );
                if (!claimed) return { room, f, r, c };
            }
        }
    }
    return null;
}

// Main Entity Logic State Updates
function updateWalkers(dt) {
    // 1. Assign automated builders to projects
    if (state.staff.builder > 0) {
        state.walkers.forEach(w => {
            if (w.type === 'builder' && w.state === 'idle') {
                const hit = findBuildingSiteForBuilder(w);
                if (hit) {
                    w.assignedRoom = hit.room;
                    w.state = 'heading_to_build';
                    w.targetF = hit.f;
                    w.targetR = hit.r;
                    w.targetC = hit.c;
                    w.targetU = 0.35;
                    w.targetV = 0.35;
                }
            }
        });
    }

    // 2. Assign automated housekeepers to cleaning
    if (state.staff.housekeeper > 0) {
        state.walkers.forEach(w => {
            if (w.type === 'housekeeper' && w.state === 'idle') {
                const hit = findDirtyRoomForHousekeeper(w);
                if (hit) {
                    w.assignedRoom = hit.room;
                    w.state = 'heading_to_clean';
                    w.targetF = hit.f;
                    w.targetR = hit.r;
                    w.targetC = hit.c;
                    w.targetU = 0.5;
                    w.targetV = 0.5;
                }
            }
        });
    }

    // 2b. Update owner walker (movement + animFrame tick)
    const _ownerW = state.walkers.find(w => w.id === 'owner');
    if (_ownerW) {
        // Always tick animFrame so the idle bob animation works
        _ownerW.animFrame = (_ownerW.animFrame || 0) + dt * state.gameSpeed * 2.2;
        updateOwnerWalker(_ownerW, dt);
    }

    // 3. Move walkers
    for (let i = state.walkers.length - 1; i >= 0; i--) {
        const w = state.walkers[i];
        // Owner movement is handled separately above — skip standard AI for owner
        if (w.id === 'owner') continue;

        // Handle Speech Bubble Countdown
        if (w.moodTimer > 0) {
            w.moodTimer -= dt * state.gameSpeed;
            if (w.moodTimer <= 0) w.moodText = '';
        }

        // --- Navigation Path Engine ---
        // If changing levels, must route through elevator
        const elevatorR = ELEVATOR_R;
        const elevatorC = ELEVATOR_C;
        const elevatorU = ELEVATOR_U;
        const elevatorV = ELEVATOR_V;

        if (w.f !== w.targetF) {
            // Check if arrived at Elevator door on current floor
            const atElevatorCurrentFloor = (w.r === elevatorR && w.c === elevatorC && Math.abs(w.u - elevatorU) < 0.1 && Math.abs(w.v - elevatorV) < 0.1);

            if (!atElevatorCurrentFloor) {
                // Head to Elevator door
                moveTowards(w, w.f, elevatorR, elevatorC, elevatorU, elevatorV, dt);
            } else {
                // Save pre-elevator state so it can be restored after the ride
                if (w.state !== 'elevator_up' && w.state !== 'elevator_down') {
                    w._preElevatorState = w.state;
                }
                w.state = (w.targetF > w.f) ? 'elevator_up' : 'elevator_down';
                const liftSpeed = 1.0 * dt * state.gameSpeed;
                const diff = w.targetF - w.f;
                if (Math.abs(diff) <= liftSpeed) {
                    w.f = w.targetF;
                    // Restore the state that was active before entering the elevator
                    w.state = w._preElevatorState || 'idle';
                    delete w._preElevatorState;
                } else {
                    w.f += Math.sign(diff) * liftSpeed;
                }
            }
        } else {
            // On correct floor! Walk directly to destination coordinates
            const reached = moveTowards(w, w.targetF, w.targetR, w.targetC, w.targetU, w.targetV, dt);
            if (reached) {
                // Reached destination. Fire action based on state machine
                if (w.state === 'entering') {
                    // Stands in front of lobby desk to register checkin
                    w.state = 'waiting_checkin';
                    w.moodText = w.type === 'vip' ? '👑 Special VIP!' : '🔑 Hello!';
                    w.moodTimer = 3.0;
                }
                else if (w.state === 'waiting_checkin') {
                    // Wait for front desk receptionist registration approval
                    const room = w.assignedRoom;
                    if (room && room.status === 'ready') {
                        // Success! Checked in. Go to assigned suite
                        AudioEngine.playCash();
                        w.state = 'walking_to_room';
                        const roomCoords = room.id.match(/\d+/g).map(Number);
                        w.targetF = roomCoords[0];
                        w.targetR = roomCoords[1];
                        w.targetC = roomCoords[2];
                        w.targetU = 0.45; w.targetV = 0.35; // Bed/couch center
                        w.moodText = w.type === 'vip' ? '👑 Elite Suite!' : '✨ Checked in!';
                        w.moodTimer = 2.0;
                    } else {
                        // Failed checkin — release the ghost reservation so room can be rebooked
                        if (w.assignedRoom) w.assignedRoom.guestId = null;
                        w.state = 'exiting';
                        w.targetF = 0; w.targetR = 1; w.targetC = 1;
                        w.targetU = 0.9; w.targetV = 0.9;
                        w.moodText = '😢 No room?!';
                        w.moodTimer = 3.0;
                    }
                }
                else if (w.state === 'walking_to_room') {
                    // Arrived in guest room. Start resting living cycle
                    w.state = 'living';
                    w.moodText = w.type === 'vip' ? '👑 Five Star Stay' : '💤 Cozy!';
                    w.moodTimer = 3.0;
                }
                else if (w.state === 'living' || w.state === 'sleeping') {
                    // Always decrement stayTime regardless of sleep/wake cycle
                    w.stayTime -= dt * state.gameSpeed;

                    // Use animFrame (which increments even when stationary) for sleep cycle
                    if (Math.floor(w.animFrame / 5) % 2 === 0) {
                        w.state = 'sleeping';
                        if (Math.random() < 0.15 * state.gameSpeed) {
                            const scr = isoToScreen(w.c, w.r, w.f, CanvasRenderer.canvas.width, CanvasRenderer.canvas.height);
                            const zPos = getIsoLoc(scr.x, scr.y, 0.24, 0.32, 0.28);
                            addParticle(zPos.x, zPos.y, 'zZ', '#cbd5e1', 0.2, -0.8, 8, 'text');
                        }
                    } else {
                        w.state = 'living';
                    }

                    if (w.stayTime <= 0) {
                        // Checkout! Exit suite, turn suite dirty, pay cash
                        let surgeMultiplier = 1.0; // hoisted — referenced outside if(room) for mood text
                        let tip = 0;               // hoisted — referenced outside if(room) for mood text
                        const room = w.assignedRoom;
                        if (room) {
                            room.status = 'dirty';
                            room.cleanliness = 0;
                            room.guestId = null;

                            let rent = CONSTANTS.roomLevels[room.level - 1].rent;
                            if (w.type === 'vip') rent *= 5;

                            // Surge pricing: hotel fill rate drives a premium when rooms are scarce
                            let builtRooms = 0, occupiedRooms = 0;
                            for (let f = 1; f < state.hotel.length; f++)
                                for (let rr = 0; rr < GRID_ROWS; rr++)
                                    for (let cc = 0; cc < GRID_COLS; cc++) {
                                        const rm = state.hotel[f][rr][cc];
                                        if (rm.type === 'guest') { builtRooms++; if (rm.guestId) occupiedRooms++; }
                                    }
                            const occupancyPct = builtRooms > 0 ? occupiedRooms / builtRooms : 0;
                            surgeMultiplier = 1.0;
                            if (occupancyPct >= 0.9) surgeMultiplier = 1.4;
                            else if (occupancyPct >= 0.7) surgeMultiplier = 1.2;
                            if (surgeMultiplier > 1.0) rent = Math.round(rent * surgeMultiplier);

                            state.cash += rent;
                            AudioEngine.playCash();

                            if (!state.fun) {
                                state.fun = { checkouts: 0, tipsTotal: 0, rushHourTicks: 0, lastCheckoutAt: 0, recentCheckoutTimes: [] };
                            }
                            if (!state.fun.recentCheckoutTimes) state.fun.recentCheckoutTimes = [];
                            state.fun.checkouts++;
                            const nowMs = typeof performance !== 'undefined' ? performance.now() : 0;
                            if (Math.random() < 0.4) {
                                tip = Math.max(1, Math.round(rent * (0.07 + Math.random() * 0.13)));
                                state.cash += tip;
                                state.fun.tipsTotal += tip;
                                AudioEngine.playTip();
                                const scr2 = isoToScreen(w.c, w.r, w.f, CanvasRenderer.canvas.width, CanvasRenderer.canvas.height);
                                const tipPos = getIsoLoc(scr2.x, scr2.y, 0.55, 0.45, 0.72);
                                addParticle(tipPos.x, tipPos.y, `+${tip} tip`, '#fbbf24', 0.15, -0.95, 10, 'text');
                            }
                            const dtCombo = nowMs - (state.fun.lastCheckoutAt || 0);
                            if (state.fun.lastCheckoutAt > 0 && dtCombo < 10_000 && dtCombo > 0) {
                                const combo = Math.min(35, 4 + Math.round(rent * 0.08));
                                state.cash += combo;
                                AudioEngine.playTip();
                                showToast('Combo payout!', `Back-to-back checkouts — +$${combo} bonus.`, 'success');
                            }
                            state.fun.lastCheckoutAt = nowMs;

                            // Checkout chain → rush hour trigger (3 checkouts within 15 real seconds)
                            state.fun.recentCheckoutTimes.push(nowMs);
                            state.fun.recentCheckoutTimes = state.fun.recentCheckoutTimes.filter(t => nowMs - t < 15_000);
                            if (state.fun.recentCheckoutTimes.length >= 3 && state.fun.rushHourTicks === 0) {
                                state.fun.rushHourTicks = 42;
                                state.fun.recentCheckoutTimes = [];
                                showToast('Rush hour!', 'Word is spreading fast — guests are flooding in!', 'success');
                            }

                            const n = state.fun.checkouts;
                            if ([1, 5, 10, 25, 50, 100].includes(n)) {
                                showToast('Milestone', `${n} guest stays completed — keep building!`, 'success');
                            }

                            // Cash particle — ⚡ suffix flags surge pricing payout
                            const scr = isoToScreen(w.c, w.r, w.f, CanvasRenderer.canvas.width, CanvasRenderer.canvas.height);
                            const textPos = getIsoLoc(scr.x, scr.y, 0.5, 0.5, 0.6);
                            const rentLabel = surgeMultiplier > 1.0 ? `+$${rent} ⚡` : `+$${rent}`;
                            addParticle(textPos.x, textPos.y, rentLabel, '#10b981', 0, -1.2, 12, 'text');
                        }

                        w.state = 'exiting';
                        w.targetF = 0; w.targetR = 1; w.targetC = 1;
                        w.targetU = 0.9; w.targetV = 0.9;
                        // Guest mood reflects stay quality
                        if (w.type === 'vip') w.moodText = '👑 Spectacular!';
                        else if (surgeMultiplier > 1.0) w.moodText = '🤩 Peak stay!';
                        else if (tip > 0) w.moodText = '😊 Loved it!';
                        else w.moodText = '👋 Thanks!';
                        w.moodTimer = 2.5;
                    }
                }
                else if (w.state === 'exiting') {
                    // Despawn guest walker
                    state.walkers.splice(i, 1);
                }
                else if (w.state === 'dining' || w.state === 'parked') {
                    // Facility visitor — count down stay time then walk off
                    w.stayTime -= dt * state.gameSpeed;
                    if (w.stayTime <= 0) {
                        w.state = 'facility_exit';
                        w.targetU = Math.random() > 0.5 ? 0.9 : 0.1;
                        w.targetV = Math.random() > 0.5 ? 0.9 : 0.1;
                    }
                }
                else if (w.state === 'facility_exit') {
                    // Visitor reached the edge — despawn
                    state.walkers.splice(i, 1);
                    continue;
                }
                else if (w.state === 'heading_to_build') {
                    // Builder arrived at construction site. Perform hammer-works
                    w.state = 'building';
                    w.moodText = '🔨 Hammer!';
                    w.moodTimer = 2.0;
                }
                else if (w.state === 'building') {
                    const room = w.assignedRoom;
                    if (room && room.status === 'building') {
                        // Speed up construction
                        room.buildProgress = Math.min(100, room.buildProgress + getBuilderConstructionRate() * dt * state.gameSpeed);

                        // Spawn metal sparks
                        if (Math.random() < 0.3) {
                            const scr = isoToScreen(w.c, w.r, w.f, CanvasRenderer.canvas.width, CanvasRenderer.canvas.height);
                            const toolPos = getIsoLoc(scr.x, scr.y, w.u, w.v, 0.25);
                            addParticle(toolPos.x, toolPos.y, '', '#f59e0b', Math.random()*2 - 1, -Math.random()*2, 2.5, 'spark');
                            AudioEngine.playBuild();
                        }

                        if (room.buildProgress >= 100) {
                            room.buildProgress = 100;
                            room.status = 'ready';
                            AudioEngine.playUpgrade();
                            let detail = 'Automatic builders finished construction.';
                            if (room.type === 'guest') detail = 'Automatic builders finished the suite.';
                            else if (room.type === 'restaurant') detail = 'Automatic builders finished the restaurant.';
                            else if (room.type === 'parking') detail = 'Automatic builders finished the parking deck.';
                            showToast("Construction Complete!", detail, "success");
                            populateUpgradeSelect();
                            w.state = 'idle';
                            w.assignedRoom = null;
                            w.targetF = 0; w.targetR = 0; w.targetC = 1;
                            w.targetU = 0.7; w.targetV = 0.5;
                        }
                    } else {
                        // Finished
                        w.state = 'idle';
                        w.assignedRoom = null;
                        w.targetF = 0; w.targetR = 0; w.targetC = 1;
                        w.targetU = 0.7; w.targetV = 0.5;
                    }
                }
                else if (w.state === 'heading_to_clean') {
                    w.state = 'housekeeping';
                }
                else if (w.state === 'housekeeping') {
                    const room = w.assignedRoom;
                    if (room && room.status === 'dirty') {
                        room.cleanliness += getHousekeeperCleanRate() * dt * state.gameSpeed;

                        // Sweep dust clouds
                        if (Math.random() < 0.25) {
                            const scr = isoToScreen(w.c, w.r, w.f, CanvasRenderer.canvas.width, CanvasRenderer.canvas.height);
                            const broomPos = getIsoLoc(scr.x, scr.y, w.u, w.v, 0.05);
                            addParticle(broomPos.x, broomPos.y, '', '#cbd5e1', Math.random()*1.5 - 0.75, -Math.random()*0.8, 3, 'dust');
                            AudioEngine.playClean();
                        }

                        if (room.cleanliness >= 100) {
                            room.cleanliness = 100;
                            room.status = 'ready';
                            showToast("Room Sanitized!", "Vacant suite reopened for booking.", "success");
                            w.state = 'idle';
                            w.assignedRoom = null;
                            w.targetF = 0; w.targetR = 0; w.targetC = 0;
                            w.targetU = 0.2; w.targetV = 0.6;
                        }
                    } else {
                        w.state = 'idle';
                        w.assignedRoom = null;
                        w.targetF = 0; w.targetR = 0; w.targetC = 0;
                        w.targetU = 0.2; w.targetV = 0.6;
                    }
                }
            }
        }
    }
}

// ─── Manager walk (first-person locomotion) ─────────────────────────────────
window._mgrKeys = window._mgrKeys || {};

function isManagerWalkCell(f, r, c) {
    if (f < 0 || f >= state.hotel.length) return false;
    if (r < 0 || c < 0 || r >= GRID_ROWS || c >= GRID_COLS) return false;
    const cell = state.hotel[f][r][c];
    return cell.type === 'guest' ||
        cell.type === 'restaurant' ||
        cell.type === 'parking' ||
        cell.type === 'empty' ||
        cell.type === 'lobby';
}

const MANAGER_RADIUS = 0.072;
const MANAGER_PILLAR_CX = ELEVATOR_C + ELEVATOR_U;
const MANAGER_PILLAR_CZ = ELEVATOR_R + ELEVATOR_V;
const MANAGER_PILLAR_R = 0.11;

function canManagerStandAt(f, x, z) {
    const corners = [
        [x - MANAGER_RADIUS, z - MANAGER_RADIUS],
        [x + MANAGER_RADIUS, z - MANAGER_RADIUS],
        [x - MANAGER_RADIUS, z + MANAGER_RADIUS],
        [x + MANAGER_RADIUS, z + MANAGER_RADIUS]
    ];
    for (let i = 0; i < corners.length; i++) {
        const cx = corners[i][0];
        const cz = corners[i][1];
        const c = Math.floor(cx);
        const r = Math.floor(cz);
        if (!isManagerWalkCell(f, r, c)) return false;
    }
    const dx = x - MANAGER_PILLAR_CX;
    const dz = z - MANAGER_PILLAR_CZ;
    if (dx * dx + dz * dz < (MANAGER_PILLAR_R + MANAGER_RADIUS) * (MANAGER_PILLAR_R + MANAGER_RADIUS)) {
        return false;
    }
    return true;
}

function clampManagerToValid(f, x, z) {
    let nx = Math.max(MANAGER_RADIUS, Math.min(GRID_COLS - MANAGER_RADIUS, x));
    let nz = Math.max(MANAGER_RADIUS, Math.min(GRID_ROWS - MANAGER_RADIUS, z));
    if (canManagerStandAt(f, nx, nz)) return { x: nx, z: nz };
    if (canManagerStandAt(f, nx, z)) return { x: nx, z };
    if (canManagerStandAt(f, x, nz)) return { x, z: nz };
    return { x, z };
}

/** Open 3D suite when standing in a guest cell and pressing E (manager mode). */
function tryManagerEnterSuite() {
    if (state.viewMode !== 'manager' || state.fpRoom) return;
    const M = state.managerWalk;
    if (!M) return;
    const c = Math.floor(M.x);
    const r = Math.floor(M.z);
    const cell = state.hotel[M.f]?.[r]?.[c];
    if (!cell || cell.type !== 'guest') {
        showToast('No suite here', 'Walk into a guest suite footprint and press E to enter.', 'info');
        return;
    }
    state.fpRoom = { f: M.f, r, c };
    state.fpFloor = M.f;
    state.fpRoomAngle = (M.yaw * 180) / Math.PI;
    showToast('Suite entered', 'Drag to look around. Esc or ← Back leaves the room.', 'success');
}

/** Change floor when standing near the elevator core (manager mode). dir: +1 or -1 */
function tryManagerElevatorFloor(dir) {
    if (state.viewMode !== 'manager' || state.fpRoom) return;
    const M = state.managerWalk;
    if (!M) return;
    const dx = M.x - MANAGER_PILLAR_CX;
    const dz = M.z - MANAGER_PILLAR_CZ;
    if (dx * dx + dz * dz > 0.34 * 0.34) {
        showToast('Elevator', 'Stand closer to the lift core (center column) to change floors.', 'info');
        return;
    }
    const nf = M.f + dir;
    if (nf < 0 || nf >= state.hotel.length) return;
    if (!canManagerStandAt(nf, M.x, M.z)) {
        showToast('Elevator', 'That floor has no walkable space at this spot — try another column.', 'warning');
        return;
    }
    M.f = nf;
    state.fpFloor = nf;
    showToast('Floor change', `Now on floor ${nf}.`, 'success');
}

function updateManagerWalk(dt) {
    if (state.viewMode !== 'manager' || state.fpRoom) return;
    const M = state.managerWalk;
    if (!M) return;

    const keys = window._mgrKeys || {};
    const turn = (keys.ArrowLeft || keys.KeyA ? 1 : 0) - (keys.ArrowRight || keys.KeyD ? 1 : 0);
    M.yaw += turn * 2.4 * dt * Math.PI;

    const mv = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    if (mv !== 0) {
        const speed = 1.25 * state.gameSpeed;
        const step = mv * speed * dt;
        const nx = M.x + Math.sin(M.yaw) * step;
        const nz = M.z + Math.cos(M.yaw) * step;
        let cx = nx;
        let cz = nz;
        if (!canManagerStandAt(M.f, nx, nz)) {
            if (canManagerStandAt(M.f, nx, M.z)) cx = nx;
            else if (canManagerStandAt(M.f, M.x, nz)) cz = nz;
            else cx = M.x;
            cz = M.z;
        }
        const cl = clampManagerToValid(M.f, cx, cz);
        M.x = cl.x;
        M.z = cl.z;
    }
    state.fpFloor = M.f;
}

function resetManagerWalkSpawn() {
    state.managerWalk = { f: 1, x: 0.55, z: 0.45, yaw: 0 };
    state.fpFloor = 1;
}

// ─── Owner Walker ─────────────────────────────────────────────────────────────

/**
 * Spawn the owner walker entity (type='owner', id='owner') at the given position.
 * The owner uses the standard walker rendering path (type === 'owner' already handled).
 * gridX / gridY are flat tile coords in 0..GRID_COLS / 0..GRID_ROWS space.
 */
function spawnOwnerWalker(floor, gridX, gridY) {
    if (floor  === undefined) floor  = 0;
    if (gridX  === undefined) gridX  = 0.5;
    if (gridY  === undefined) gridY  = 0.5;

    // Remove any stale owner walker
    const idx = state.walkers.findIndex(w => w.id === 'owner');
    if (idx !== -1) state.walkers.splice(idx, 1);

    const r = Math.floor(gridY);
    const c = Math.floor(gridX);
    const u = gridY - r;
    const v = gridX - c;

    state.walkers.push({
        id: 'owner',
        type: 'owner',
        f: floor,
        r: r,
        c: c,
        u: u,
        v: v,
        targetF: floor,
        targetR: r,
        targetC: c,
        targetU: u,
        targetV: v,
        // Flat grid coords (convenience mirror kept in sync)
        gridX:  gridX,
        gridY:  gridY,
        targetGridX: gridX,
        targetGridY: gridY,
        state: 'idle',
        speed: 0.08,          // tiles/sec — slightly faster than guests
        facingRight: true,
        animFrame: 0,
        hairColor: '#64748b',
        shirtColor: '#172554',
        moodText: '',
        moodTimer: 0,
        stayTime: Infinity
    });
}

/**
 * Move the owner walker to a given isometric grid cell (click-to-move).
 * gridX / gridY are floating-point tile coordinates (centre of clicked cell + 0.5 offset).
 * Exposed globally so the canvas click handler in renderer.js can call it.
 */
window.moveOwnerTo = function(floor, gridX, gridY) {
    const ownerW = state.walkers.find(w => w.id === 'owner');
    if (!ownerW) return;

    ownerW.targetF        = floor;
    ownerW.targetGridX    = gridX;
    ownerW.targetGridY    = gridY;
    ownerW.targetR        = Math.floor(gridY);
    ownerW.targetC        = Math.floor(gridX);
    ownerW.targetU        = gridY - Math.floor(gridY);
    ownerW.targetV        = gridX - Math.floor(gridX);
    ownerW.state          = 'owner_walking';
};

/** Per-frame owner movement — called inside updateWalkers. */
function updateOwnerWalker(ownerW, dt) {
    if (!ownerW || ownerW.state !== 'owner_walking') return;

    // Floor change: teleport instantly (simple; elevator animation not required)
    if (ownerW.f !== ownerW.targetF) {
        ownerW.f = ownerW.targetF;
    }

    // Current flat grid position derived from r/c/u/v
    // Mapping: r = row, c = col, u = sub-row offset, v = sub-col offset
    const curX = ownerW.c + ownerW.v;   // column axis
    const curY = ownerW.r + ownerW.u;   // row axis

    const dx = ownerW.targetGridX - curX;
    const dy = ownerW.targetGridY - curY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.04) {
        // Snap to target
        ownerW.c      = ownerW.targetC;
        ownerW.r      = ownerW.targetR;
        ownerW.v      = ownerW.targetV;
        ownerW.u      = ownerW.targetU;
        ownerW.gridX  = ownerW.targetGridX;
        ownerW.gridY  = ownerW.targetGridY;
        ownerW.state  = 'idle';
    } else {
        const speed = ownerW.speed * dt * state.gameSpeed;
        const step  = Math.min(speed, dist);
        const nx = curX + (dx / dist) * step;
        const ny = curY + (dy / dist) * step;

        ownerW.c    = Math.max(0, Math.floor(nx));
        ownerW.r    = Math.max(0, Math.floor(ny));
        ownerW.v    = nx - ownerW.c;
        ownerW.u    = ny - ownerW.r;
        ownerW.gridX = nx;
        ownerW.gridY = ny;
        ownerW.facingRight = dx >= 0;
    }
}

// ─── Facility Visitor Spawning ────────────────────────────────────────────────

const DINER_MOOD_TEXTS  = ['🍽 Yum!', '☕ Nice!', '🍷 Cheers!'];
const DRIVER_MOOD_TEXTS = ['🚗 Parked!', '🅿 Thanks!', '🔑 Sweet!'];
const HAIR_COLORS       = ['#f59e0b', '#dc2626', '#3b82f6', '#10b981', '#ffffff', '#475569'];

/**
 * Spawn diner walkers at ready+staffed restaurants and driver walkers at
 * ready+staffed parking cells, capped at 2 visitors per facility cell.
 * Called every simulationStep (once per second of game time).
 */
function triggerFacilityVisitors() {
    for (let f = 1; f < state.hotel.length; f++) {
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const cell = state.hotel[f][r][c];
                if (cell.status !== 'ready') continue;

                if (cell.type === 'restaurant' && (state.staff.chef || 0) > 0) {
                    const present = state.walkers.filter(
                        w => w.type === 'diner' && w.assignedFacility === cell.id
                    ).length;
                    if (present < 2 && Math.random() < 0.40) {
                        _spawnFacilityVisitor('diner', cell, f, r, c);
                    }
                } else if (cell.type === 'parking' && (state.staff.valet || 0) > 0) {
                    const present = state.walkers.filter(
                        w => w.type === 'driver' && w.assignedFacility === cell.id
                    ).length;
                    if (present < 2 && Math.random() < 0.35) {
                        _spawnFacilityVisitor('driver', cell, f, r, c);
                    }
                }
            }
        }
    }
}

/** Internal: create a single diner or driver walker at the given facility cell. */
function _spawnFacilityVisitor(type, cell, f, r, c) {
    const isDiner  = type === 'diner';
    const u        = 0.3 + Math.random() * 0.4;
    const v        = 0.3 + Math.random() * 0.4;
    const moodArr  = isDiner ? DINER_MOOD_TEXTS : DRIVER_MOOD_TEXTS;
    const moodText = moodArr[Math.floor(Math.random() * moodArr.length)];
    const hairColor = HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)];
    const stayTime = isDiner
        ? 8  + Math.random() * 12
        : 6  + Math.random() * 10;

    state.walkers.push({
        id:               `${type}_${Math.random().toString(36).substr(2, 9)}`,
        type,
        f,
        r,               c,
        u,               v,
        targetF:          f,
        targetR:          r,
        targetC:          c,
        targetU:          u,
        targetV:          v,
        state:            isDiner ? 'dining' : 'parked',
        assignedFacility: cell.id,
        stayTime,
        speed:            0.04,
        hairColor,
        shirtColor:       isDiner ? '#f97316' : '#0ea5e9',
        moodText,
        moodTimer:        3.0,
        animFrame:        Math.random() * 100,
        facingRight:      true
    });
}

// ─────────────────────────────────────────────────────────────────────────────

// Expose on window for cross-file access
window.updateManagerWalk         = updateManagerWalk;
window.tryManagerEnterSuite      = tryManagerEnterSuite;
window.tryManagerElevatorFloor   = tryManagerElevatorFloor;
window.resetManagerWalkSpawn     = resetManagerWalkSpawn;
window.spawnOwnerWalker          = spawnOwnerWalker;
window.triggerFacilityVisitors   = triggerFacilityVisitors;
