// Game State — depends on constants.js

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
        receptionist: 0,
        chef: 0,
        valet: 0
    },
    walkers: [], // Entities inside hotel (Guests, builders, housekeepers)
    particles: [], // Dynamic particles
    maxRooms: 100, // up to 5 rooms × 20 guest floors
    maxFloors: 20,
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
    fpRoomAngle: 0,    // degrees; 0 = facing window wall, 180 = facing door
    /** Manager walk: FP movement on floor `f`; x = column axis 0..GRID_COLS, z = row axis 0..GRID_ROWS; yaw radians. */
    managerWalk: { f: 1, x: 0.55, z: 0.45, yaw: 0 },
    /** Named proprietor shown in the lobby (isometric) and header; `animFrame` is runtime only. */
    hotelOwner: { name: 'Jordan Blake', title: 'Proprietor', animFrame: 0 },
    /** Light progression / variety counters (save/load). */
    fun: {
        checkouts: 0,
        tipsTotal: 0,
        rushHourTicks: 0,
        lastCheckoutAt: 0
    },
    /** Fractional cash accumulators for facility passive income (avoids floating-point drift). */
    facilityIncomeAccum: {
        restaurant: 0,
        parking: 0
    },
    /** Tracks which facility cell IDs have already shown the "first earning" toast. */
    facilityEarningToasted: new Set(),
    /** Per-department training (0–max). Cash upgrades in Management; each job levels independently. */
    staffTrainingLevels: {
        housekeeper: 0,
        builder: 0,
        receptionist: 0,
        chef: 0,
        valet: 0
    }
};

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
        fun: state.fun
            ? { ...state.fun, rushHourTicks: 0 }
            : { checkouts: 0, tipsTotal: 0, rushHourTicks: 0, lastCheckoutAt: 0 },
        staffTrainingLevels: {
            housekeeper: Math.min(
                CONSTANTS.staffTraining.maxLevel,
                Math.max(0, state.staffTrainingLevels.housekeeper | 0)
            ),
            builder: Math.min(
                CONSTANTS.staffTraining.maxLevel,
                Math.max(0, state.staffTrainingLevels.builder | 0)
            ),
            receptionist: Math.min(
                CONSTANTS.staffTraining.maxLevel,
                Math.max(0, state.staffTrainingLevels.receptionist | 0)
            ),
            chef: Math.min(
                CONSTANTS.staffTraining.maxLevel,
                Math.max(0, (state.staffTrainingLevels.chef || 0) | 0)
            ),
            valet: Math.min(
                CONSTANTS.staffTraining.maxLevel,
                Math.max(0, (state.staffTrainingLevels.valet || 0) | 0)
            )
        },
        hotelOwner: {
            name: String(state.hotelOwner?.name || 'Jordan Blake').slice(0, 32),
            title: String(state.hotelOwner?.title || 'Proprietor').slice(0, 32)
        },
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
        state.maxRooms = Math.max(100, snap.maxRooms ?? 100);
        state.maxFloors = Math.max(20, snap.maxFloors ?? 20);
        state.gameSpeed = snap.gameSpeed ?? 1;
        state.isoYaw = snap.isoYaw ?? 0;
        state.fun = {
            checkouts: 0,
            tipsTotal: 0,
            rushHourTicks: 0,
            lastCheckoutAt: 0,
            ...(snap.fun && typeof snap.fun === 'object' ? snap.fun : {}),
            rushHourTicks: 0
        };
        const cap = CONSTANTS.staffTraining.maxLevel;
        const clampLv = v => Math.min(cap, Math.max(0, v | 0));
        if (snap.staffTrainingLevels && typeof snap.staffTrainingLevels === 'object') {
            state.staffTrainingLevels.housekeeper = clampLv(snap.staffTrainingLevels.housekeeper);
            state.staffTrainingLevels.builder = clampLv(snap.staffTrainingLevels.builder);
            state.staffTrainingLevels.receptionist = clampLv(snap.staffTrainingLevels.receptionist);
            state.staffTrainingLevels.chef = clampLv(snap.staffTrainingLevels.chef || 0);
            state.staffTrainingLevels.valet = clampLv(snap.staffTrainingLevels.valet || 0);
        } else {
            // Legacy saves (housekeeping only, max was 3 — still valid under new cap)
            state.staffTrainingLevels.housekeeper = clampLv(snap.hkTrainingLevel);
            state.staffTrainingLevels.builder = 0;
            state.staffTrainingLevels.receptionist = 0;
            state.staffTrainingLevels.chef = 0;
            state.staffTrainingLevels.valet = 0;
        }
        if (!state.managerWalk || typeof state.managerWalk !== 'object') {
            state.managerWalk = { f: 1, x: 0.55, z: 0.45, yaw: 0 };
        }
        if (snap.hotelOwner && typeof snap.hotelOwner === 'object') {
            state.hotelOwner = state.hotelOwner || {};
            state.hotelOwner.name = String(snap.hotelOwner.name || state.hotelOwner.name || 'Jordan Blake').slice(0, 32);
            state.hotelOwner.title = String(snap.hotelOwner.title || state.hotelOwner.title || 'Proprietor').slice(0, 32);
            state.hotelOwner.animFrame = 0;
        } else {
            state.hotelOwner = { name: 'Jordan Blake', title: 'Proprietor', animFrame: 0 };
        }
        state.hotel = snap.hotel;
        state.walkers = [];
        state.particles = [];

        // Re-spawn AI walkers for all hired staff (walkers are not persisted)
        for (let i = 0; i < state.staff.receptionist; i++) spawnWalker('receptionist');
        for (let i = 0; i < state.staff.housekeeper; i++) spawnWalker('housekeeper');
        for (let i = 0; i < state.staff.builder; i++) spawnWalker('builder');

        // Ensure owner walker is present (not persisted; re-spawned at lobby default)
        if (!state.walkers.find(w => w.id === 'owner')) {
            spawnOwnerWalker(0, 0.5, 0.5);
        }
        for (let i = 0; i < (state.staff.chef || 0); i++) spawnWalker('chef');
        for (let i = 0; i < (state.staff.valet || 0); i++) spawnWalker('valet');

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

// Expose on window for cross-file access
window.state      = state;
window.addFloor   = addFloor;
