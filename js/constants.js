// Grid dimensions — must be defined before state
const GRID_ROWS = 2; // rows per floor (corridor sides: left wall / right wall)
const GRID_COLS = 3; // columns per floor (rooms per corridor side)
const GRID_SIZE = GRID_COLS; // legacy alias used by isometric renderer square loops

/** Starting cash for new games and full resets (`startNewGame`, first load with no save). */
const STARTING_CASH = 10000;

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
    /** Guest-floor amenity — uses same grid slot as a suite; boosts walk-in odds when ready. */
    buildRestaurantCost: {
        cash: 800,
        concrete: 15,
        wood: 10,
        steel: 4
    },
    /** Structured parking / motor court — same grid rules as restaurant. */
    buildParkingCost: {
        cash: 600,
        concrete: 20,
        steel: 6
    },
    upgradeRoomCost: {
        cash: 500,
        wood: 12,
        steel: 6
    },
    staff: {
        /** One-time hiring fee only — no recurring payroll (`simulationStep` does not deduct wages). */
        housekeeper: { cost: 30 },
        builder: { cost: 75 },
        receptionist: { cost: 40 },
        chef: { cost: 60 },
        valet: { cost: 45 }
    },
    /** Passive income per second for ready amenities (full rate requires at least 1 staff). */
    restaurantIncome: 1.50,
    parkingIncome: 1.00,
    /** Fraction of income earned when facility has no supporting staff (chef / valet). */
    facilityUnstaffedFactor: 0.5,
    /** Staff department upgrades — cash only; each role has its own level track (see `jobs`). */
    staffTraining: {
        maxLevel: 5,
        jobs: {
            housekeeper: {
                /** Cost to go from level L → L+1 (L = 0..maxLevel-1). */
                upgradeCosts: [140, 280, 450, 650, 900],
                /** Cleanliness / sec × (1 + effectPerLevel × level) for all housekeepers. */
                effectPerLevel: 0.55
            },
            builder: {
                upgradeCosts: [200, 380, 580, 820, 1100],
                /** Automated build progress / sec × (1 + effectPerLevel × level). */
                effectPerLevel: 0.48
            },
            receptionist: {
                upgradeCosts: [150, 290, 460, 680, 950],
                /** Per-receptionist booking bonus scales × (1 + effectPerLevel × level). */
                effectPerLevel: 0.15
            }
        }
    },
    /** Isometric canvas zoom — buttons + mouse wheel (`renderer` / `ui` clamp to these). */
    viewZoom: {
        min: 0.28,
        max: 5.5,
        stepButton: 0.18,
        stepWheel: 0.07,
        reset: 1.1
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
    playTip() {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1320, now + 0.06);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.14);
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

// Expose on window for cross-file access
window.CONSTANTS  = CONSTANTS;
window.GRID_ROWS  = GRID_ROWS;
window.GRID_COLS  = GRID_COLS;
window.GRID_SIZE  = GRID_SIZE;
window.STARTING_CASH = STARTING_CASH;
window.AudioEngine = AudioEngine;
