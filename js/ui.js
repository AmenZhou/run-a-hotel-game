// Global Ticker
let marketTimer = 15;
function simulationStep() {
    marketTimer--;
    if (marketTimer <= 0) {
        updateMarketPrices();
        marketTimer = 15;
        updateUI();
    }
    const cdEl = document.getElementById('market-countdown');
    if (cdEl) cdEl.innerText = `Next Refresh: ${marketTimer}s`;

    let totalWages = 0;
    let totalRent = 0;

    // Operational staff ledger subtraction
    for (const staffType in state.staff) {
        const count = state.staff[staffType];
        totalWages += count * CONSTANTS.staff[staffType].wage;
    }
    state.cash -= totalWages;

    // Estimate steady-state rent from currently occupied rooms
    // (actual cash arrives on checkout; this is the display estimate)
    for (let f = 1; f < state.hotel.length; f++) {
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const cell = state.hotel[f][r][c];
                if (cell.type === 'guest' && cell.guestId) {
                    const walker = state.walkers.find(w => w.id === cell.guestId);
                    const baseRent = CONSTANTS.roomLevels[cell.level - 1].rent;
                    // Spread lump payout over average stay length for ledger display
                    const avgStay = 25; // seconds
                    const perSec = baseRent / avgStay * (walker && walker.type === 'vip' ? 5 : 1);
                    totalRent += Math.round(perSec * 10) / 10;
                }
            }
        }
    }

    // Passive construction progress (3%/sec base; builders also contribute via walker AI)
    for (let f = 1; f < state.hotel.length; f++) {
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const cell = state.hotel[f][r][c];
                if (cell.type === 'guest' && cell.status === 'building') {
                    cell.buildProgress = Math.min(100, cell.buildProgress + 3 * state.gameSpeed);
                    if (cell.buildProgress >= 100) {
                        cell.buildProgress = 100;
                        cell.status = 'ready';
                        AudioEngine.playUpgrade();
                        populateUpgradeSelect();
                        showToast("Construction Complete!", `Suite on Floor ${f} is ready for guests!`, 'success');
                    }
                }
            }
        }
    }

    // Handle idle reception desk checks
    triggerGuestBooking();

    // Decrement AI Campaign active timer
    if (state.campaignActive) {
        state.campaignTimer--;
        const timerEl = document.getElementById('ai-marketing-timer');
        if (timerEl) timerEl.innerText = `${state.campaignTimer}s`;

        if (state.campaignTimer <= 0) {
            state.campaignActive = false;
            const activeBox = document.getElementById('ai-marketing-active-box');
            if (activeBox) activeBox.classList.add('hidden');
            showToast("Campaign Concluded", "Your limited-time AI marketing boost has ended.", "warning");
        }
    }

    // Update financial statement balances
    const netFlow = totalRent - totalWages;
    const lRent = document.getElementById('ledger-rent');
    if (lRent) lRent.innerText = `~+$${Math.round(totalRent)}/sec`;
    const lWages = document.getElementById('ledger-wages');
    if (lWages) lWages.innerText = `-$${totalWages}/sec`;

    const netEl = document.getElementById('ledger-net');
    if (netEl) {
        netEl.innerText = `${netFlow >= 0 ? '+' : ''}$${Math.round(netFlow)}/sec`;
        netEl.className = netFlow >= 0 ? 'text-emerald-400' : 'text-rose-400';
    }

    // Cash runway warning — fire at most once every 30 seconds
    if (totalWages > 0 && state.cash < totalWages * 30) {
        if (!simulationStep._warnedAt || (Date.now() - simulationStep._warnedAt) > 30000) {
            simulationStep._warnedAt = Date.now();
            const burnSecs = Math.max(0, Math.round(state.cash / totalWages));
            showToast('⚠️ Low Cash!', `At current wages, you have ~${burnSecs}s of runway.`, 'warning');
        }
    }

    updateUI();
}

function getHotelRating() {
    let totalRooms = 0;
    let scoreSum = 0;
    for (let f = 1; f < state.hotel.length; f++) {
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const cell = state.hotel[f][r][c];
                if (cell.type === 'guest') {
                    totalRooms++;
                    scoreSum += cell.level;
                }
            }
        }
    }
    return totalRooms > 0 ? (scoreSum / totalRooms).toFixed(1) : "1.0";
}

function getRoomCapacity() {
    let occupied = 0;
    let built = 0;
    for (let f = 1; f < state.hotel.length; f++) {
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const cell = state.hotel[f][r][c];
                if (cell.type === 'guest') {
                    built++;
                    if (cell.guestId) occupied++;
                }
            }
        }
    }
    return { occupied, built };
}

function updateUI() {
    const stCash = document.getElementById('stat-cash');
    if (stCash) stCash.innerText = `$${state.cash.toLocaleString()}`;
    
    const rating = getHotelRating();
    const stRating = document.getElementById('stat-rating');
    if (stRating) stRating.innerText = `${rating} ★`;

    const cap = getRoomCapacity();
    const stGuests = document.getElementById('stat-guests');
    if (stGuests) stGuests.innerText = `${cap.occupied} / ${cap.built}`;

    const uiTotalRooms = document.getElementById('ui-total-rooms');
    if (uiTotalRooms) uiTotalRooms.innerText = `${cap.built} / ${state.maxRooms}`;
    const uiMaxFloors = document.getElementById('ui-max-floors');
    if (uiMaxFloors) uiMaxFloors.innerText = `${state.hotel.length - 1} Floor(s)`;

    const invConc = document.getElementById('inv-concrete');
    if (invConc) invConc.innerText = `${state.materials.concrete} units`;
    const invWood = document.getElementById('inv-wood');
    if (invWood) invWood.innerText = `${state.materials.wood} units`;
    const invSteel = document.getElementById('inv-steel');
    if (invSteel) invSteel.innerText = `${state.materials.steel} units`;

    const renderTrend = (material) => {
        const trend = state.marketTrends[material];
        const price = state.marketPrices[material];
        const prEl = document.getElementById(`price-${material}`);
        if (prEl) prEl.innerText = `$${price}`;
        const el = document.getElementById(`trend-${material}`);
        if (el) {
            if (trend > 0) {
                el.className = 'text-xs text-rose-500 font-bold';
                el.innerHTML = `<i class="fa-solid fa-caret-up"></i> +${trend}%`;
            } else if (trend < 0) {
                el.className = 'text-xs text-emerald-400 font-bold';
                el.innerHTML = `<i class="fa-solid fa-caret-down"></i> ${trend}%`;
            } else {
                el.className = 'text-xs text-slate-500 font-bold';
                el.innerHTML = `<i class="fa-solid fa-minus"></i> 0%`;
            }
        }
    };
    renderTrend('concrete');
    renderTrend('wood');
    renderTrend('steel');

    const stHk = document.getElementById('staff-housekeeper-count');
    if (stHk) stHk.innerText = state.staff.housekeeper;
    const stBld = document.getElementById('staff-builder-count');
    if (stBld) stBld.innerText = state.staff.builder;
    const stRec = document.getElementById('staff-receptionist-count');
    if (stRec) stRec.innerText = state.staff.receptionist;

    const canBuild = state.cash >= CONSTANTS.buildRoomCost.cash &&
                     state.materials.concrete >= CONSTANTS.buildRoomCost.concrete &&
                     state.materials.wood >= CONSTANTS.buildRoomCost.wood &&
                     cap.built < state.maxRooms;
    const btnBuild = document.getElementById('btn-build-room');
    if (btnBuild) btnBuild.disabled = !canBuild;
}

function populateUpgradeSelect() {
    const select = document.getElementById('select-upgrade-room');
    if (!select) return;
    select.innerHTML = '';
    
    let hasRooms = false;
    for (let f = 1; f < state.hotel.length; f++) {
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const cell = state.hotel[f][r][c];
                if (cell.type === 'guest') {
                    hasRooms = true;
                    // Only allow upgrading vacant, clean, fully-built rooms
                    if (cell.level < CONSTANTS.roomLevels.length && !cell.guestId && cell.status === 'ready') {
                        const opt = document.createElement('option');
                        opt.value = `${f}-${r}-${c}`;
                        opt.innerText = `Floor ${f} Suite [${r},${c}] — Lvl ${cell.level} → ${cell.level + 1}`;
                        select.appendChild(opt);
                    }
                }
            }
        }
    }

    const btnUpgrade = document.getElementById('btn-upgrade-room');
    if (!hasRooms || select.options.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.innerText = 'No rooms ready for renovation';
        select.appendChild(opt);
        if (btnUpgrade) btnUpgrade.disabled = true;
    } else {
        if (btnUpgrade) btnUpgrade.disabled = false;
    }
}

window.buyMaterial = function(material, amount) {
    const unitPrice = state.marketPrices[material];
    let buyCount = amount;

    if (amount === 'max') {
        buyCount = Math.floor(state.cash / unitPrice);
    }

    if (buyCount <= 0) {
        showToast("Transaction Denied", "Insufficient liquidity to complete purchase.", "error");
        return;
    }

    const totalCost = buyCount * unitPrice;
    if (state.cash < totalCost) {
        showToast("Transaction Denied", "Insufficient liquidity to purchase requested quantity.", "error");
        return;
    }

    state.cash -= totalCost;
    state.materials[material] += buyCount;
    AudioEngine.playCash();
    showToast("Transaction Approved", `Acquired ${buyCount} units of structural ${material}.`, "success");
    updateUI();
};

window.hireStaff = function(staffType) {
    const config = CONSTANTS.staff[staffType];
    if (state.cash < config.cost) {
        showToast("Hiring Process Halted", "Insufficient corporate budget to hire this specialist.", "error");
        return;
    }

    state.cash -= config.cost;
    state.staff[staffType]++;
    
    // Spawn corresponding automated walker
    spawnWalker(staffType);

    AudioEngine.playCash();
    showToast("Workforce Expanded", `Successfully contracted a new ${staffType}.`, "success");
    updateUI();
};

function setupTabs() {
    const tabs = ['build', 'market', 'staff', 'ai'];
    tabs.forEach(tab => {
        const btn = document.getElementById(`tab-${tab}`);
        if (btn) {
            btn.addEventListener('click', () => {
                tabs.forEach(t => {
                    const elTab = document.getElementById(`tab-${t}`);
                    if (elTab) elTab.className = 'flex-1 py-4 text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200 border-b-2 border-transparent transition-all flex flex-col items-center gap-1.5';
                    const elCont = document.getElementById(`content-${t}`);
                    if (elCont) elCont.classList.add('hidden');
                });
                btn.className = 'flex-1 py-4 text-xs font-bold uppercase tracking-wider text-amber-500 border-b-2 border-amber-500 transition-all flex flex-col items-center gap-1.5';
                const elAct = document.getElementById(`content-${tab}`);
                if (elAct) elAct.classList.remove('hidden');
                state.activeTab = tab;
            });
        }
    });
}

// Expand Room Blueprint Event
const btnBuild = document.getElementById('btn-build-room');
if (btnBuild) {
    btnBuild.addEventListener('click', () => {
        let target = null;
        for (let f = 1; f < state.hotel.length; f++) {
            for (let r = 0; r < GRID_ROWS; r++) {
                for (let c = 0; c < GRID_COLS; c++) {
                    if (state.hotel[f][r][c].type === 'empty') {
                        target = { f, r, c };
                        break;
                    }
                }
                if (target) break;
            }
            if (target) break;
        }

        if (!target) {
            const guestFloors = state.hotel.length - 1; // floor 0 is lobby
            if (guestFloors >= state.maxFloors) {
                showToast("Floor Limit Reached!", `Maximum ${state.maxFloors} guest floors — hotel fully expanded!`, 'warning');
                return;
            }
            addFloor();
            target = { f: state.hotel.length - 1, r: 0, c: 0 };
            showToast(`Floor ${target.f} Unlocked!`, `New guest floor added — ${state.maxFloors - guestFloors - 1} floor expansion(s) remaining.`, 'success');
        }

        state.cash -= CONSTANTS.buildRoomCost.cash;
        state.materials.concrete -= CONSTANTS.buildRoomCost.concrete;
        state.materials.wood -= CONSTANTS.buildRoomCost.wood;

        state.hotel[target.f][target.r][target.c] = {
            type: 'guest',
            level: 1,
            status: 'building',
            buildProgress: 0,
            cleanliness: 100,
            guestId: null,
            id: `F${target.f}R${target.r}C${target.c}`
        };

        AudioEngine.playBuild();
        showToast("Construction Approved!", `Laying foundation columns at Floor ${target.f} [Grid ${target.r},${target.c}].`, "success");
        updateUI();
    });
}

// Upgrade Suite Event
const btnUpgrade = document.getElementById('btn-upgrade-room');
if (btnUpgrade) {
    btnUpgrade.addEventListener('click', () => {
        const select = document.getElementById('select-upgrade-room');
        if (!select || !select.value) return;

        const [f, r, c] = select.value.split('-').map(Number);
        const cell = state.hotel[f][r][c];

        if (state.cash < CONSTANTS.upgradeRoomCost.cash ||
            state.materials.wood < CONSTANTS.upgradeRoomCost.wood ||
            state.materials.steel < CONSTANTS.upgradeRoomCost.steel) {
            showToast("Renovation Delayed", "Insufficient materials or capital to upgrade.", "error");
            return;
        }

        state.cash -= CONSTANTS.upgradeRoomCost.cash;
        state.materials.wood -= CONSTANTS.upgradeRoomCost.wood;
        state.materials.steel -= CONSTANTS.upgradeRoomCost.steel;

        cell.level++;
        AudioEngine.playUpgrade();
        showToast("Renovation Finalized!", `Upgraded to a ${CONSTANTS.roomLevels[cell.level - 1].name}!`, "success");
        
        populateUpgradeSelect();
        updateUI();
    });
}

// ✨ AI STRATEGIC CONSULTANT EVENT
const btnAiConsult = document.getElementById('btn-ai-consult');
if (btnAiConsult) {
    btnAiConsult.addEventListener('click', async () => {
        const box = document.getElementById('ai-advisor-box');
        const textBox = document.getElementById('ai-advisor-text');
        
        btnAiConsult.disabled = true;
        btnAiConsult.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> <span>✨ Auditing layout...</span>`;
        box.classList.remove('hidden');
        textBox.innerHTML = `<span class="animate-pulse text-slate-500">Alfred is calculating numbers, inspecting layouts, and drafting an executive brief...</span>`;

        const snapshot = {
            cash: state.cash,
            materials: state.materials,
            staff: state.staff,
            rating: getHotelRating(),
            rooms: getRoomCapacity().built,
            occupied: getRoomCapacity().occupied
        };

        const userQuery = `Current State of the Hotel: ${JSON.stringify(snapshot)}. Give me your hotel blueprint strategic advice.`;
        const systemPrompt = "You are Alfred, a legendary, incredibly sophisticated five-star hotel manager and management consultant. Analyze the player's real-time hotel state. Give exactly 3 short, brilliant bullet points of strategy, followed by a humorous, high-society summary quote. Keep the tone aristocratic, highly entertaining, and crisp. Focus on materials, cash flow, and stars.";

        try {
            const responseText = await callGemini(userQuery, systemPrompt);
            textBox.innerHTML = responseText.replace(/\n/g, '<br>');
        } catch (err) {
            textBox.innerHTML = `<span class="text-rose-400"><i class="fa-solid fa-circle-exclamation"></i> Communication link to Alfred failed. Please try again in a few seconds. Alfred dislikes being rushed.</span>`;
        } finally {
            btnAiConsult.disabled = false;
            btnAiConsult.innerHTML = `<i class="fa-solid fa-brain"></i> <span>✨ Generate Strategic Audit</span>`;
        }
    });
}

// ✨ AI MARKETING CAMPAIGN EVENT
const btnAiMarketing = document.getElementById('btn-ai-marketing');
if (btnAiMarketing) {
    btnAiMarketing.addEventListener('click', async () => {
        const themeInput = document.getElementById('input-ai-theme');
        const activeBox = document.getElementById('ai-marketing-active-box');
        const copyBox = document.getElementById('ai-marketing-copy');
        
        let theme = themeInput.value.trim();
        if (!theme) theme = "Cozy Imperial Luxury"; // Default theme

        btnAiMarketing.disabled = true;
        btnAiMarketing.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> <span>✨ Designing Ad Copy...</span>`;

        const stars = getHotelRating();
        const hotelName = document.getElementById('hotel-name')?.innerText || "The Royal Obsidian";
        const userQuery = `Write a premium, short, glamorous 3-sentence hotel advertisement tagline/copy based on this theme: "${theme}". The hotel is named "${hotelName}" and has an official rating of ${stars} stars. Make it sound exclusive, enticing, and atmospheric.`;
        const systemPrompt = "You are an award-winning creative advertising copywriter for ultra-luxury brands. Write exactly three sentences of captivating copy. Do not include introductory text, headers, or quotes. Focus entirely on setting a mesmerizing atmospheric scene.";

        try {
            const copyText = await callGemini(userQuery, systemPrompt);
            
            // Activate Campaign Boost State
            state.campaignActive = true;
            state.campaignTimer = 60;
            state.campaignTheme = theme;
            state.campaignText = copyText;

            activeBox.classList.remove('hidden');
            copyBox.innerHTML = copyText;
            document.getElementById('ai-marketing-timer').innerText = `60s`;

            // Spawn Crown-wearing high-value VIP Guest!
            const vacant = getVacantRoom();
            if (vacant) {
                const vipId = spawnWalker('vip', vacant);
                vacant.guestId = vipId;
                showToast("✨ AI Campaign Launched!", `A wealthy VIP Guest attracted by your "${theme}" ad has checked in! 👑`, "success");
            } else {
                spawnWalker('vip');
                showToast("✨ AI Campaign Active!", `Your ad copy is live! VIP Guest has entered the lobby looking for an opening! 👑`, "success");
            }
            
            themeInput.value = "";
        } catch (err) {
            showToast("✨ Hub Overloaded", "The advertising team was unable to connect. Please try again soon.", "error");
        } finally {
            btnAiMarketing.disabled = false;
            btnAiMarketing.innerHTML = `<i class="fa-solid fa-bullhorn"></i> <span>✨ Launch Campaign & Spawn VIP</span>`;
        }
    });
}

// Panning and Camera view controls
document.getElementById('btn-zoom-in').addEventListener('click', () => { state.zoom = Math.min(1.8, state.zoom + 0.1); });
document.getElementById('btn-zoom-out').addEventListener('click', () => { state.zoom = Math.max(0.5, state.zoom - 0.1); });
document.getElementById('btn-reset-view').addEventListener('click', () => { state.zoom = 1.1; state.panX = 0; state.panY = 0; });

document.getElementById('btn-toggle-view').addEventListener('click', () => {
    const modes   = ['inside', 'exterior', 'firstperson'];
    const labels  = ['Inside View', 'Exterior View', '1st Person'];
    const icons   = ['fa-eye', 'fa-building', 'fa-person-walking'];
    const classes = [
        'px-3 h-10 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-lg',
        'px-3 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold text-xs flex items-center gap-1.5 transition-all border border-slate-600',
        'px-3 h-10 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-lg'
    ];
    const idx = modes.indexOf(state.viewMode);
    const next = (idx + 1) % 3;
    state.viewMode = modes[next];
    if (state.viewMode === 'firstperson') state.fpFloor = Math.max(1, Math.min(state.fpFloor, state.hotel.length - 1));
    const btn = document.getElementById('btn-toggle-view');
    btn.className = classes[next];
    document.getElementById('txt-view-mode').innerText = labels[next];
    const ic = btn.querySelector('i');
    if (ic) ic.className = `fa-solid ${icons[next]}`;
});

// Drag Panning Interaction
let isDragging = false;
let startX, startY;
const canvasEl = document.getElementById('game-canvas');
canvasEl.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX - state.panX;
    startY = e.clientY - state.panY;
});
window.addEventListener('mousemove', (e) => {
    if (isDragging && state.viewMode !== 'firstperson') {
        state.panX = e.clientX - startX;
        state.panY = e.clientY - startY;
    }
});
window.addEventListener('mouseup', () => { isDragging = false; });

// Time scale speed toggle event listeners
document.getElementById('speed-1x').addEventListener('click', () => setGameSpeed(1));
document.getElementById('speed-2x').addEventListener('click', () => setGameSpeed(2));
document.getElementById('speed-4x').addEventListener('click', () => setGameSpeed(4));

function setGameSpeed(speed) {
    state.gameSpeed = speed;
    ['1x', '2x', '4x'].forEach(s => {
        const btn = document.getElementById(`speed-${s}`);
        if (s === `${speed}x`) {
            btn.className = 'px-2.5 py-1 text-xs font-bold rounded bg-amber-500 text-slate-950 transition-all';
        } else {
            btn.className = 'px-2.5 py-1 text-xs font-bold rounded text-slate-400 hover:text-white transition-all';
        }
    });
}

// Setup static default reception staff
function spawnDefaultReceptionist() {
    spawnWalker('receptionist');
}

// Save / Load button handlers
document.getElementById('btn-save')?.addEventListener('click', () => saveGame());
document.getElementById('btn-load')?.addEventListener('click', () => {
    if (loadGame()) {
        // loadGame() already re-spawns all staff walkers from state.staff counts
        populateUpgradeSelect();
        updateUI();
    }
});

// Initial launch loop
window.onload = function () {
    // Restore from save if one exists, otherwise start fresh
    if (hasSave() && loadGame()) {
        // loadGame() re-spawns staff; ensure at least 1 receptionist is present
        if (!state.walkers.some(w => w.type === 'receptionist')) spawnDefaultReceptionist();
    } else {
        initHotel();
        spawnDefaultReceptionist();
    }
    CanvasRenderer.init('game-canvas');
    setupTabs();
    populateUpgradeSelect();
    updateUI();

    // Auto-save every 60 seconds
    setInterval(saveGame, 60000);

    // Secondary physics tick rate (runs every 1 second)
    setInterval(simulationStep, 1000);

    // Dynamic frame animator loop
    let lastTime = performance.now();
    function drawLoop(now) {
        const dt = (now - lastTime) / 1000;
        lastTime = now;

        // Secure bounds checks for frame skips
        const cappedDt = Math.min(dt, 0.1);
        
        updateWalkers(cappedDt);
        updateParticles();
        CanvasRenderer.draw();

        requestAnimationFrame(drawLoop);
    }
    requestAnimationFrame(drawLoop);
}
