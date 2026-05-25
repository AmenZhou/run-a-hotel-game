// Grid dimensions — must be defined before state
const GRID_ROWS = 2; // rows per floor (corridor sides: left wall / right wall)
const GRID_COLS = 3; // columns per floor (rooms per corridor side)
const GRID_SIZE = GRID_COLS; // legacy alias used by isometric renderer square loops

/** Starting cash for new games and full resets (`startNewGame`, first load with no save). */
const STARTING_CASH = 10000;

// Game State
const state = {
    cash: STARTING_CASH,
    materials: {
        concrete: 50,
        wood: 35,
        steel: 15
    },
    marketPrices: {
        concrete: 20,
        wood: 12,
        steel: 60
    },
    marketTrends: {
        concrete: 0,
        wood: 0,
        steel: 0
    },
    hotel: [], // 3D Array of floors & cells
    staff: {
        housekeeper: 0,
        builder: 0,
        receptionist: 0
    },
    walkers: [], // Entities inside hotel (Guests, builders, housekeepers)
    particles: [], // Dynamic particles
    maxRooms: 20, // 5 rooms × 4 guest floors (elevator shaft excluded per floor)
    maxFloors: 4,
    zoom: 1.1,
    panX: 0,
    panY: 0,
    activeTab: 'build',
    viewMode: 'inside', // 'inside' = transparent view showing furniture; 'exterior' = solid building
    gameSpeed: 1, // 1x, 2x, 4x speed scaling
    /** Yaw (rad) for isometric overlook — rotate building in Inside / Exterior views. */
    isoYaw: 0,
    campaignActive: false,
    campaignTimer: 0,
    campaignTheme: "",
    campaignText: "",
    fpFloor: 1,
    fpRoom: null,      // {f, r, c} — which room interior to show; null = corridor view
    fpRoomAngle: 0     // degrees; 0 = facing window wall, 180 = facing door
};

// Constant Pricing & Values
const CONSTANTS = {
    materials: {
        concrete: { basePrice: 20, min: 10, max: 45 },
        wood: { basePrice: 12, min: 6, max: 28 },
        steel: { basePrice: 60, min: 30, max: 120 }
    },
    buildRoomCost: {
        cash: 1500,
        concrete: 25,
        wood: 15
    },
    upgradeRoomCost: {
        cash: 800,
        wood: 12,
        steel: 6
    },
    staff: {
        housekeeper: { cost: 500, wage: 2 },
        builder: { cost: 800, wage: 3 },
        receptionist: { cost: 400, wage: 3 }
    },
    roomLevels: [
        { name: "Standard Room", rent: 15, maxStars: 1 },
        { name: "Deluxe Suite", rent: 35, maxStars: 2 },
        { name: "Executive Suite", rent: 75, maxStars: 3 },
        { name: "Penthouse Suite", rent: 180, maxStars: 5 }
    ]
};

// Audio Synthesizer Engine
const AudioEngine = {
    ctx: null,
    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    },
    playCash() {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(587.33, now); // D5
        osc1.frequency.exponentialRampToValueAtTime(880.00, now + 0.1); // A5

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1174.66, now); // D6

        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.4);
        osc2.stop(now + 0.4);
    },
    playBuild() {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.setValueAtTime(180, now + 0.08);
        osc.frequency.setValueAtTime(130, now + 0.16);

        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.25);
    },
    playClean() {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const noise = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        noise.type = 'sine';
        noise.frequency.setValueAtTime(600, now);
        noise.frequency.exponentialRampToValueAtTime(150, now + 0.3);

        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

        noise.connect(gain);
        gain.connect(this.ctx.destination);

        noise.start(now);
        noise.stop(now + 0.35);
    },
    playUpgrade() {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(261.63, now); // C4
        osc.frequency.setValueAtTime(329.63, now + 0.1); // E4
        osc.frequency.setValueAtTime(392.00, now + 0.2); // G4
        osc.frequency.setValueAtTime(523.25, now + 0.3); // C5

        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.55);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.6);
    }
};

// Gemini API Integration with Exponential Backoff Retries
async function callGemini(userQuery, systemPrompt) {
    const apiKey = ""; // Runtime provides this automatically
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
    
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] }
    };

    let delay = 1000;
    for (let i = 0; i < 5; i++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error("Invalid model response structure");
            return text;
        } catch (err) {
            if (i === 4) {
                throw err; // throw error after 5 failed retries
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2; // exponential delay: 1s, 2s, 4s, 8s, 16s
        }
    }
}

// Toast Alerts
function showToast(title, message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `bg-slate-900 border-l-4 p-4 rounded-xl shadow-2xl flex items-start gap-3 transition-all duration-300 transform translate-x-12 opacity-0 select-none ${
        type === 'success' ? 'border-emerald-500' :
        type === 'error' ? 'border-rose-500' :
        type === 'warning' ? 'border-amber-500' : 'border-indigo-500'
    }`;
    
    const icon = type === 'success' ? 'fa-circle-check text-emerald-400' :
                 type === 'error' ? 'fa-circle-exclamation text-rose-400' :
                 type === 'warning' ? 'fa-triangle-exclamation text-amber-400' : 'fa-circle-info text-indigo-400';

    toast.innerHTML = `
        <span class="text-lg mt-0.5"><i class="fa-solid ${icon}"></i></span>
        <div>
            <h4 class="font-bold text-xs text-slate-100">${title}</h4>
            <p class="text-[11px] text-slate-400 mt-1 leading-relaxed">${message}</p>
        </div>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.remove('translate-x-12', 'opacity-0');
    }, 10);

    setTimeout(() => {
        toast.classList.add('translate-x-12', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Isometric Grid Constants & Sizing
const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;
const FLOOR_HEIGHT = 52;

// Elevator column positioned on cell (0, 1) back corner (u: 0.15, v: 0.15)
const ELEVATOR_R = 0;
const ELEVATOR_C = 1;
const ELEVATOR_U = 0.2;
const ELEVATOR_V = 0.2;

function initHotel() {
    state.hotel = [];
    addFloor(); // Lobby (Floor 0)
    addFloor(); // Guest suites level (Floor 1)
}

function addFloor() {
    const floorIndex = state.hotel.length;
    const isLobby = floorIndex === 0;
    
    const floor = [];
    for (let r = 0; r < GRID_ROWS; r++) {
        const row = [];
        for (let c = 0; c < GRID_COLS; c++) {
            row.push({
                type: isLobby ? 'lobby' : 'empty',
                level: 1,
                status: 'ready', // ready, building, dirty
                buildProgress: 0,
                cleanliness: 100,
                guestId: null, // Links to active walker ID
                id: `F${floorIndex}R${r}C${c}`
            });
        }
        floor.push(row);
    }
    state.hotel.push(floor);
    
    // Auto build first room at (0,0) on floor 1 to begin checkins
    if (floorIndex === 1) {
        state.hotel[1][0][0] = {
            type: 'guest',
            level: 1,
            status: 'ready',
            buildProgress: 100,
            cleanliness: 100,
            guestId: null,
            id: 'F1R0C0'
        };
    }
}

// ─── Save / Load ─────────────────────────────────────────────────────────────
const SAVE_KEY = 'grand_hotel_save_v1';

function saveGame() {
    // Snapshot only the durable parts of state (strip transient walker/particle data)
    const snapshot = {
        cash: state.cash,
        materials: { ...state.materials },
        staff: { ...state.staff },
        maxRooms: state.maxRooms,
        maxFloors: state.maxFloors,
        gameSpeed: state.gameSpeed,
        isoYaw: state.isoYaw ?? 0,
        hotel: state.hotel.map(floor =>
            floor.map(row =>
                row.map(cell => ({
                    type: cell.type,
                    level: cell.level,
                    status: cell.status === 'occupied' ? 'dirty' : cell.status, // reset occupied to dirty on load
                    buildProgress: cell.buildProgress,
                    cleanliness: cell.cleanliness,
                    guestId: null, // walkers are re-spawned fresh
                    id: cell.id
                }))
            )
        )
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
    showToast('Game Saved!', 'Your hotel progress has been saved.', 'success');
}

function loadGame() {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { showToast('No Save Found', 'Start a fresh hotel below.', 'warning'); return false; }
    try {
        const snap = JSON.parse(raw);
        state.cash = snap.cash ?? state.cash;
        state.materials = { ...state.materials, ...snap.materials };
        state.staff = { ...state.staff, ...snap.staff };
        state.maxRooms = snap.maxRooms ?? state.maxRooms;
        state.maxFloors = snap.maxFloors ?? state.maxFloors;
        state.gameSpeed = snap.gameSpeed ?? 1;
        state.isoYaw = snap.isoYaw ?? 0;
        state.hotel = snap.hotel;
        state.walkers = [];
        state.particles = [];

        // Re-spawn AI walkers for all hired staff (walkers are not persisted)
        for (let i = 0; i < state.staff.receptionist; i++) spawnWalker('receptionist');
        for (let i = 0; i < state.staff.housekeeper; i++) spawnWalker('housekeeper');
        for (let i = 0; i < state.staff.builder; i++) spawnWalker('builder');

        showToast('Game Loaded!', 'Welcome back — your hotel is ready.', 'success');
        return true;
    } catch (e) {
        showToast('Load Failed', 'Save data is corrupted.', 'error');
        return false;
    }
}

function deleteSave() {
    localStorage.removeItem(SAVE_KEY);
    showToast('Save Deleted', 'Starting fresh.', 'warning');
}

function hasSave() {
    return !!localStorage.getItem(SAVE_KEY);
}
// ─────────────────────────────────────────────────────────────────────────────

// Particle Engine Implementation
function addParticle(x, y, text, color, vx = 0, vy = -1, size = 10, type = 'text') {
    state.particles.push({
        x, y, text, color, vx, vy, size, type,
        life: 1.0, // starts full life
        decay: 0.02 + Math.random() * 0.015
    });
}

function updateParticles() {
    for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.x += p.vx * state.gameSpeed;
        p.y += p.vy * state.gameSpeed;
        p.life -= p.decay * state.gameSpeed;
        if (p.life <= 0) {
            state.particles.splice(i, 1);
        }
    }
}

// Convert 3D projection array to screen pixels
function isoToScreen(col, row, floor, canvasWidth, canvasHeight) {
    const cx = canvasWidth / 2 + state.panX;
    const cy = canvasHeight / 2 + state.panY + 120; // Lower down to fit height

    const x = (col - row) * TILE_WIDTH * state.zoom;
    const y = (col + row) * TILE_HEIGHT * state.zoom;
    const z = floor * FLOOR_HEIGHT * state.zoom;

    return { x: cx + x, y: cy + y - z };
}

/** Pivot used by iso projection and overlook rotation (must match renderer). */
function getIsoViewPivot(canvasWidth, canvasHeight) {
    return {
        x: canvasWidth / 2 + state.panX,
        y: canvasHeight / 2 + state.panY + 120
    };
}

/** Map screen coords back to pre-rotation space (inverse of canvas rotate around pivot). */
function screenToIsoUnrotated(mx, my, canvasWidth, canvasHeight) {
    const yaw = state.isoYaw || 0;
    if (Math.abs(yaw) < 1e-6) return { x: mx, y: my };
    const piv = getIsoViewPivot(canvasWidth, canvasHeight);
    const dx = mx - piv.x;
    const dy = my - piv.y;
    const c = Math.cos(-yaw);
    const s = Math.sin(-yaw);
    return { x: piv.x + dx * c - dy * s, y: piv.y + dx * s + dy * c };
}

/**
 * When stacked floors share a grid column, iso diamonds overlap on screen.
 * Pick the tile whose center is closest to the cursor; on ties prefer the lower floor
 * so mid-levels stay reachable after a third floor is built.
 */
function pickHoveredIsoTile(mx, my, canvasWidth, canvasHeight) {
    const p = screenToIsoUnrotated(mx, my, canvasWidth, canvasHeight);
    const ux = p.x;
    const uy = p.y;
    let best = null;
    for (let f = state.hotel.length - 1; f >= 0; f--) {
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const cell = state.hotel[f][r][c];
                if (cell.type === 'empty') continue;
                if (!isPointInIsometricTile(ux, uy, c, r, f, canvasWidth, canvasHeight)) continue;
                const center = isoToScreen(c, r, f, canvasWidth, canvasHeight);
                const dx = ux - center.x;
                const dy = uy - center.y;
                const d = dx * dx + dy * dy;
                if (!best || d < best.d - 0.25 || (Math.abs(d - best.d) <= 0.25 && f < best.f)) {
                    best = { f, r, c, cell, d };
                }
            }
        }
    }
    return best;
}

// Coordinate helper for precise room detailing
function getIsoLoc(cx, cy, u, v, h_level) {
    const tw = TILE_WIDTH * state.zoom;
    const th = TILE_HEIGHT * state.zoom;
    const d = FLOOR_HEIGHT * state.zoom;
    
    const rx = (v - u) * tw;
    const ry = (u + v) * th;
    const rz = h_level * d;
    return { x: cx + rx, y: cy + ry - rz };
}

// Check if mouse is hovering room
function isPointInIsometricTile(px, py, col, row, floor, canvasWidth, canvasHeight) {
    const center = isoToScreen(col, row, floor, canvasWidth, canvasHeight);
    const tw = TILE_WIDTH * state.zoom;
    const th = TILE_HEIGHT * state.zoom;

    const dx = Math.abs(px - center.x);
    const dy = Math.abs(py - center.y);

    return (dx / tw + dy / th) <= 1.0;
}

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
        shirtColor: type === 'vip' ? '#f59e0b' : (isGuest ? ['#ef4444', '#10b981', '#3b82f6', '#a855f7', '#ec4899'][Math.floor(Math.random() * 5)] : (type === 'housekeeper' ? '#db2777' : '#d97706')),
        moodText: type === 'vip' ? '👑 VIP' : '',
        moodTimer: type === 'vip' ? 5.0 : 0,
        stayTime: type === 'vip' ? 30 : 15 + Math.floor(Math.random() * 20) // VIPs stay longer!
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
    } else if (isGuest) {
        // Guests immediately head to the Reception Desk
        walker.targetR = 0; walker.targetC = 0;
        walker.targetU = 0.5; walker.targetV = 0.6;
    }

    state.walkers.push(walker);
    return id;
}


function updateMarketPrices() {
    for (const key in state.marketPrices) {
        const config = CONSTANTS.materials[key];
        const pctChange = (Math.random() * 0.4 - 0.2); // -20% to +20%
        const priceDiff = Math.round(config.basePrice * pctChange);
        let newPrice = state.marketPrices[key] + priceDiff;
        
        if (newPrice < config.min) newPrice = config.min;
        if (newPrice > config.max) newPrice = config.max;

        state.marketTrends[key] = Math.round(((newPrice - state.marketPrices[key]) / state.marketPrices[key]) * 100);
        state.marketPrices[key] = newPrice;
    }
}

// Find vacant room matching requirement
function getVacantRoom() {
    for (let f = 1; f < state.hotel.length; f++) {
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const room = state.hotel[f][r][c];
                if (room.type === 'guest' && room.status === 'ready' && !room.guestId) {
                    return room;
                }
            }
        }
    }
    return null;
}

// Checkin trigger logic
function triggerGuestBooking() {
    const vacant = getVacantRoom();
    if (!vacant) {
        // Debug: log room states to help diagnose booking issues
        const roomStates = [];
        for (let f = 1; f < state.hotel.length; f++) {
            for (let r = 0; r < GRID_ROWS; r++) {
                for (let c = 0; c < GRID_COLS; c++) {
                    const rm = state.hotel[f][r][c];
                    if (rm.type === 'guest') roomStates.push(`F${f}R${r}C${c}:${rm.status}(guestId=${rm.guestId})`);
                }
            }
        }
        console.log('[booking] No vacant room. Staff:', JSON.stringify(state.staff), '| Rooms:', roomStates.join(', ') || 'none');
        return;
    }

    // Checkin odds boost from star rating + receptionists
    const baseChance = 0.25;
    const recBonus = state.staff.receptionist * 0.2;
    const ratingBonus = Number(getHotelRating()) * 0.1;
    let finalChance = baseChance + recBonus + ratingBonus;

    // Apply Gemini-powered marketing boost
    if (state.campaignActive) {
        finalChance *= 2.0;
    }

    const roll = Math.random();
    console.log(`[booking] Vacant: ${vacant.id} | chance=${finalChance.toFixed(2)} roll=${roll.toFixed(2)} → ${roll < finalChance ? 'BOOKED' : 'no show'}`);
    if (roll < finalChance) {
        // Spawn walker guest heading to lobby desk
        const guestId = spawnWalker('guest', vacant);
        vacant.guestId = guestId; // Reserve room spot
    }
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

// Main Entity Logic State Updates
function updateWalkers(dt) {
    // 1. Assign automated builders to projects
    if (state.staff.builder > 0) {
        state.walkers.forEach(w => {
            if (w.type === 'builder' && w.state === 'idle') {
                // Find unfinished room
                for (let f = 1; f < state.hotel.length; f++) {
                    for (let r = 0; r < GRID_ROWS; r++) {
                        for (let c = 0; c < GRID_COLS; c++) {
                            const room = state.hotel[f][r][c];
                            if (room.type === 'guest' && room.status === 'building') {
                                w.assignedRoom = room;
                                w.state = 'heading_to_build';
                                w.targetF = f; w.targetR = r; w.targetC = c;
                                w.targetU = 0.35; w.targetV = 0.35;
                                break;
                            }
                        }
                        if (w.state !== 'idle') break;
                    }
                    if (w.state !== 'idle') break;
                }
            }
        });
    }

    // 2. Assign automated housekeepers to cleaning
    if (state.staff.housekeeper > 0) {
        state.walkers.forEach(w => {
            if (w.type === 'housekeeper' && w.state === 'idle') {
                for (let f = 1; f < state.hotel.length; f++) {
                    for (let r = 0; r < GRID_ROWS; r++) {
                        for (let c = 0; c < GRID_COLS; c++) {
                            const room = state.hotel[f][r][c];
                            if (room.type === 'guest' && room.status === 'dirty') {
                                w.assignedRoom = room;
                                w.state = 'heading_to_clean';
                                w.targetF = f; w.targetR = r; w.targetC = c;
                                w.targetU = 0.5; w.targetV = 0.5;
                                break;
                            }
                        }
                        if (w.state !== 'idle') break;
                    }
                    if (w.state !== 'idle') break;
                }
            }
        });
    }

    // 3. Move walkers
    for (let i = state.walkers.length - 1; i >= 0; i--) {
        const w = state.walkers[i];
        
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
                        const room = w.assignedRoom;
                        if (room) {
                            room.status = 'dirty';
                            room.cleanliness = 0;
                            room.guestId = null;

                            let rent = CONSTANTS.roomLevels[room.level - 1].rent;
                            // VIP gets huge multiplier payout
                            if (w.type === 'vip') {
                                rent *= 5;
                            }
                            state.cash += rent;
                            AudioEngine.playCash();
                            
                            // Cash particles floating
                            const scr = isoToScreen(w.c, w.r, w.f, CanvasRenderer.canvas.width, CanvasRenderer.canvas.height);
                            const textPos = getIsoLoc(scr.x, scr.y, 0.5, 0.5, 0.6);
                            addParticle(textPos.x, textPos.y, `+$${rent}`, '#10b981', 0, -1.2, 12, 'text');
                        }
                        
                        w.state = 'exiting';
                        w.targetF = 0; w.targetR = 1; w.targetC = 1;
                        w.targetU = 0.9; w.targetV = 0.9;
                        w.moodText = w.type === 'vip' ? '👑 Marvelous service!' : '👋 Bye!';
                        w.moodTimer = 2.0;
                    }
                }
                else if (w.state === 'exiting') {
                    // Despawn guest walker
                    state.walkers.splice(i, 1);
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
                        room.buildProgress = Math.min(100, room.buildProgress + 0.8 * dt * state.gameSpeed);
                        
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
                            showToast("Construction Complete!", "Automatic builders finished room.", "success");
                            populateUpgradeSelect();
                            w.state = 'idle';
                            w.targetF = 0; w.targetR = 0; w.targetC = 1;
                            w.targetU = 0.7; w.targetV = 0.5;
                        }
                    } else {
                        // Finished
                        w.state = 'idle';
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
                        room.cleanliness += 30 * dt * state.gameSpeed; // ~3 seconds to clean (matches construction speed)
                        
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
                            w.targetF = 0; w.targetR = 0; w.targetC = 0;
                            w.targetU = 0.2; w.targetV = 0.6;
                        }
                    } else {
                        w.state = 'idle';
                        w.targetF = 0; w.targetR = 0; w.targetC = 0;
                        w.targetU = 0.2; w.targetV = 0.6;
                    }
                }
            }
        }
    }
}

// Expose game internals for the AI agent
window.state      = state;
window.CONSTANTS  = CONSTANTS;
window.GRID_ROWS  = GRID_ROWS;
window.GRID_COLS  = GRID_COLS;
window.addFloor   = addFloor;

