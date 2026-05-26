// ui.js — depends on: constants.js, state.js, simulation.js, simulation-walkers.js

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

    // Rush hour — random demand spike (feels alive, rewards having empty rooms)
    if (state.fun) {
        if (state.fun.rushHourTicks > 0) {
            state.fun.rushHourTicks--;
            if (state.fun.rushHourTicks === 0) {
                showToast('Rush hour over', 'Booking frenzy has calmed down.', 'info');
            }
        } else if (Math.random() < 0.035) {
            state.fun.rushHourTicks = 42;
            showToast('Rush hour!', 'Lobby is buzzing — higher check-in odds for ~40s.', 'success');
        }
    }

    // Estimate steady-state rent from currently occupied rooms
    let totalRent = 0;
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

    // Passive construction progress (0.5%/sec base — builder walker does the heavy lifting)
    for (let f = 1; f < state.hotel.length; f++) {
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const cell = state.hotel[f][r][c];
                const passiveBuildTypes = ['guest', 'restaurant', 'parking'];
                if (passiveBuildTypes.includes(cell.type) && cell.status === 'building') {
                    cell.buildProgress = Math.min(100, cell.buildProgress + 0.5 * state.gameSpeed);
                    if (cell.buildProgress >= 100) {
                        cell.buildProgress = 100;
                        cell.status = 'ready';
                        AudioEngine.playUpgrade();
                        populateUpgradeSelect();
                        let msg = `Structure on Floor ${f} is ready.`;
                        if (cell.type === 'guest') msg = `Suite on Floor ${f} is ready for guests!`;
                        else if (cell.type === 'restaurant') msg = `Restaurant on Floor ${f} is open!`;
                        else if (cell.type === 'parking') msg = `Parking on Floor ${f} is ready!`;
                        showToast("Construction Complete!", msg, 'success');
                    }
                }
            }
        }
    }

    // Handle idle reception desk checks
    triggerGuestBooking();

    // Spawn facility visitors (diners at restaurants, drivers at parking)
    triggerFacilityVisitors();

    // Passive income from ready restaurants and parking lots
    {
        if (!state.facilityIncomeAccum) state.facilityIncomeAccum = { restaurant: 0, parking: 0 };
        if (!state.facilityEarningToasted) state.facilityEarningToasted = new Set();

        const chefCount = Math.min(3, state.staff.chef || 0);
        const valetCount = Math.min(3, state.staff.valet || 0);
        const unstaffed = CONSTANTS.facilityUnstaffedFactor;
        const restaurantStaffFactor = chefCount > 0 ? 1.0 : unstaffed;
        const parkingStaffFactor    = valetCount > 0 ? 1.0 : unstaffed;
        const restaurantMultiplier  = restaurantStaffFactor * (1 + chefCount * 0.25);
        const parkingMultiplier     = parkingStaffFactor    * (1 + valetCount * 0.25);

        for (let f = 1; f < state.hotel.length; f++) {
            for (let r = 0; r < GRID_ROWS; r++) {
                for (let c = 0; c < GRID_COLS; c++) {
                    const cell = state.hotel[f][r][c];
                    if (cell.status !== 'ready') continue;
                    if (cell.type === 'restaurant') {
                        const income = CONSTANTS.restaurantIncome * restaurantMultiplier * state.gameSpeed;
                        state.facilityIncomeAccum.restaurant += income;
                        if (!state.facilityEarningToasted.has(cell.id)) {
                            state.facilityEarningToasted.add(cell.id);
                            const rate = chefCount > 0 ? CONSTANTS.restaurantIncome.toFixed(2) : (CONSTANTS.restaurantIncome * unstaffed).toFixed(2);
                            const tip = chefCount > 0 ? '' : ' Hire a Chef to unlock full rate.';
                            showToast('Restaurant Open!', `Floor ${f} diner earning $${rate}/s.${tip}`, 'success');
                        }
                    } else if (cell.type === 'parking') {
                        const income = CONSTANTS.parkingIncome * parkingMultiplier * state.gameSpeed;
                        state.facilityIncomeAccum.parking += income;
                        if (!state.facilityEarningToasted.has(cell.id)) {
                            state.facilityEarningToasted.add(cell.id);
                            const rate = valetCount > 0 ? CONSTANTS.parkingIncome.toFixed(2) : (CONSTANTS.parkingIncome * unstaffed).toFixed(2);
                            const tip = valetCount > 0 ? '' : ' Hire a Valet to unlock full rate.';
                            showToast('Parking Ready!', `Floor ${f} lot earning $${rate}/s.${tip}`, 'success');
                        }
                    }
                }
            }
        }

        if (state.facilityIncomeAccum.restaurant >= 1) {
            const earned = Math.floor(state.facilityIncomeAccum.restaurant);
            state.cash += earned;
            state.facilityIncomeAccum.restaurant -= earned;
        }
        if (state.facilityIncomeAccum.parking >= 1) {
            const earned = Math.floor(state.facilityIncomeAccum.parking);
            state.cash += earned;
            state.facilityIncomeAccum.parking -= earned;
        }
    }

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

    // Ledger: rent estimate + facility passive income
    const lRent = document.getElementById('ledger-rent');
    if (lRent) lRent.innerText = `~+$${totalRent.toFixed(2)}/sec`;
    const lWages = document.getElementById('ledger-wages');
    if (lWages) lWages.innerText = '— (hire fee only)';

    // Calculate current facility income rate for display
    let facilityPerSec = 0;
    {
        const cc = Math.min(3, state.staff.chef || 0);
        const vc = Math.min(3, state.staff.valet || 0);
        const rf = cc > 0 ? 1.0 : CONSTANTS.facilityUnstaffedFactor;
        const pf = vc > 0 ? 1.0 : CONSTANTS.facilityUnstaffedFactor;
        for (let f = 1; f < state.hotel.length; f++) {
            for (let r = 0; r < GRID_ROWS; r++) {
                for (let c = 0; c < GRID_COLS; c++) {
                    const cell = state.hotel[f][r][c];
                    if (cell.status !== 'ready') continue;
                    if (cell.type === 'restaurant') facilityPerSec += CONSTANTS.restaurantIncome * rf * (1 + cc * 0.25);
                    else if (cell.type === 'parking') facilityPerSec += CONSTANTS.parkingIncome * pf * (1 + vc * 0.25);
                }
            }
        }
    }
    const lFacility = document.getElementById('ledger-facility');
    if (lFacility) lFacility.innerText = `+$${facilityPerSec.toFixed(2)}/sec`;

    const netFlow = totalRent + facilityPerSec;
    const netEl = document.getElementById('ledger-net');
    if (netEl) {
        netEl.innerText = `${netFlow >= 0 ? '+' : ''}$${netFlow.toFixed(2)}/sec`;
        netEl.className = netFlow >= 0 ? 'text-emerald-400' : 'text-rose-400';
    }

    updateUI();
}

/** True if we can place another structure on guest floors (empty cell or new floor under cap). */
function hasStructuralBuildSlot() {
    for (let f = 1; f < state.hotel.length; f++) {
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                if (r === ELEVATOR_R && c === ELEVATOR_C) continue;
                if (state.hotel[f][r][c].type === 'empty') return true;
            }
        }
    }
    const guestFloors = state.hotel.length - 1;
    return guestFloors < state.maxFloors;
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

    const stFun = document.getElementById('stat-fun');
    if (stFun && state.fun) {
        const rush = state.fun.rushHourTicks > 0 ? ` · rush ${state.fun.rushHourTicks}s` : '';
        stFun.innerHTML = `<span class="text-amber-200">${state.fun.checkouts}</span> stays · <span class="text-amber-100/90">$${state.fun.tipsTotal}</span> tips<span class="text-rose-300">${rush}</span>`;
    }

    const stOwner = document.getElementById('stat-owner');
    if (stOwner && state.hotelOwner) {
        stOwner.textContent = state.hotelOwner.name || 'Owner';
        stOwner.title = state.hotelOwner.title || 'Proprietor';
    }
    const ownerNameIn = document.getElementById('owner-name-input');
    const ownerTitleIn = document.getElementById('owner-title-input');
    if (ownerNameIn && state.hotelOwner && document.activeElement !== ownerNameIn) {
        ownerNameIn.value = state.hotelOwner.name || '';
    }
    if (ownerTitleIn && state.hotelOwner && document.activeElement !== ownerTitleIn) {
        ownerTitleIn.value = state.hotelOwner.title || '';
    }

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
    const stChef = document.getElementById('staff-chef-count');
    if (stChef) stChef.innerText = state.staff.chef || 0;
    const stValet = document.getElementById('staff-valet-count');
    if (stValet) stValet.innerText = state.staff.valet || 0;

    const stMax = CONSTANTS.staffTraining.maxLevel;
    const bindTraining = (job, labelId, costId, btnId) => {
        const lv = getStaffTrainingLevel(job);
        const lab = document.getElementById(labelId);
        if (lab) lab.textContent = `Lv ${lv} / ${stMax}`;
        const costEl = document.getElementById(costId);
        const btn = document.getElementById(btnId);
        if (!btn || !costEl) return;
        if (lv >= stMax) {
            costEl.textContent = 'MAX';
            btn.disabled = true;
        } else {
            const c = CONSTANTS.staffTraining.jobs[job].upgradeCosts[lv];
            costEl.textContent = `$${c}`;
            btn.disabled = state.cash < c;
        }
    };
    bindTraining('housekeeper', 'hk-training-label', 'hk-upgrade-cost', 'btn-upgrade-hk');
    bindTraining('builder', 'bld-training-label', 'bld-upgrade-cost', 'btn-upgrade-bld');
    bindTraining('receptionist', 'rec-training-label', 'rec-upgrade-cost', 'btn-upgrade-rec');

    const canBuild = hasStructuralBuildSlot() &&
                     state.cash >= CONSTANTS.buildRoomCost.cash &&
                     state.materials.concrete >= CONSTANTS.buildRoomCost.concrete &&
                     state.materials.wood >= CONSTANTS.buildRoomCost.wood &&
                     cap.built < state.maxRooms;
    const btnBuild = document.getElementById('btn-build-room');
    if (btnBuild) btnBuild.disabled = !canBuild;

    const br = CONSTANTS.buildRestaurantCost;
    const canRestaurant = hasStructuralBuildSlot() &&
        state.cash >= br.cash &&
        state.materials.concrete >= br.concrete &&
        state.materials.wood >= br.wood &&
        state.materials.steel >= br.steel;
    const btnRest = document.getElementById('btn-build-restaurant');
    if (btnRest) btnRest.disabled = !canRestaurant;

    const bp = CONSTANTS.buildParkingCost;
    const canParking = hasStructuralBuildSlot() &&
        state.cash >= bp.cash &&
        state.materials.concrete >= bp.concrete &&
        state.materials.steel >= bp.steel;
    const btnPark = document.getElementById('btn-build-parking');
    if (btnPark) btnPark.disabled = !canParking;
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

window.fireStaff = function(staffType) {
    if (state.staff[staffType] <= 0) {
        showToast("No Staff to Dismiss", `You have no ${staffType}s on payroll.`, "warning");
        return;
    }
    state.staff[staffType]--;
    // Remove one walker of this type
    const idx = state.walkers.findIndex(w => w.type === staffType);
    if (idx !== -1) state.walkers.splice(idx, 1);
    showToast('Staff dismissed', `${staffType} has left — you can recruit again from Management when needed.`, 'warning');
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

window.upgradeStaffTraining = function (job) {
    const jobs = CONSTANTS.staffTraining.jobs;
    if (!jobs[job]) {
        showToast('Invalid upgrade', 'Unknown staff department.', 'error');
        return;
    }
    const max = CONSTANTS.staffTraining.maxLevel;
    const lv = getStaffTrainingLevel(job);
    const deptName = { housekeeper: 'Housekeeping', builder: 'Construction crew', receptionist: 'Reception' }[job] || job;
    if (lv >= max) {
        showToast('Training maxed', `${deptName} is already at level ${max}.`, 'warning');
        return;
    }
    const cost = jobs[job].upgradeCosts[lv];
    if (state.cash < cost) {
        showToast('Insufficient funds', `Need $${cost} for the next ${deptName.toLowerCase()} training level.`, 'error');
        return;
    }
    state.cash -= cost;
    state.staffTrainingLevels[job] = lv + 1;
    const nl = state.staffTrainingLevels[job];
    const e = jobs[job].effectPerLevel;
    const pct = Math.round(100 * e * nl);
    const titles = {
        housekeeper: 'Housekeeping school',
        builder: 'Site supervisor program',
        receptionist: 'Front-desk excellence'
    };
    const bodies = {
        housekeeper: `All housekeepers clean ~${pct}% faster vs untrained (level ${nl}).`,
        builder: `Automated crew hammers ~${pct}% faster vs untrained (level ${nl}).`,
        receptionist: `Each receptionist pulls ~${pct}% more booking weight vs untrained (level ${nl}).`
    };
    showToast(titles[job] || 'Training upgraded', bodies[job] || `Level ${nl}.`, 'success');
    AudioEngine.playUpgrade();
    updateUI();
};

/** @deprecated Use upgradeStaffTraining('housekeeper') — kept for older onclick references. */
window.upgradeHousekeepingTraining = function () {
    window.upgradeStaffTraining('housekeeper');
};

function resolveNextGuestFloorBuildTarget() {
    let target = null;
    for (let f = 1; f < state.hotel.length; f++) {
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                if (r === ELEVATOR_R && c === ELEVATOR_C) continue;
                if (state.hotel[f][r][c].type === 'empty') {
                    target = { f, r, c };
                    break;
                }
            }
            if (target) break;
        }
    }
    if (!target) {
        const guestFloors = state.hotel.length - 1;
        if (guestFloors >= state.maxFloors) return null;
        addFloor();
        target = { f: state.hotel.length - 1, r: 0, c: 0 };
        showToast(`Floor ${target.f} Unlocked!`, `New guest floor added — ${state.maxFloors - guestFloors - 1} floor expansion(s) remaining.`, 'success');
    }
    return target;
}

function placeFacilityBuild(type, cost, label) {
    const target = resolveNextGuestFloorBuildTarget();
    if (!target) {
        showToast("Floor Limit Reached!", `Maximum ${state.maxFloors} guest floors — hotel fully expanded!`, 'warning');
        return;
    }
    if (state.cash < cost.cash ||
        state.materials.concrete < cost.concrete ||
        (cost.wood != null && state.materials.wood < cost.wood) ||
        (cost.steel != null && state.materials.steel < cost.steel)) {
        showToast('Insufficient Resources', 'Not enough cash or materials to build.', 'warning');
        return;
    }
    state.cash -= cost.cash;
    state.materials.concrete -= cost.concrete;
    if (cost.wood != null) state.materials.wood -= cost.wood;
    if (cost.steel != null) state.materials.steel -= cost.steel;

    state.hotel[target.f][target.r][target.c] = {
        type,
        level: 1,
        status: 'building',
        buildProgress: 0,
        cleanliness: 100,
        guestId: null,
        id: `F${target.f}R${target.r}C${target.c}`
    };

    AudioEngine.playBuild();
    showToast("Construction Approved!", `${label} at Floor ${target.f} [Grid ${target.r},${target.c}].`, 'success');
    updateUI();
}

window.upgradeRoom = function(f, r, c) {
    const cell = state.hotel[f] && state.hotel[f][r] && state.hotel[f][r][c];
    if (!cell || cell.type !== 'guest' || cell.status !== 'ready' || cell.guestId) return false;
    if (cell.level >= CONSTANTS.roomLevels.length) return false;
    if (state.cash < CONSTANTS.upgradeRoomCost.cash ||
        state.materials.wood < CONSTANTS.upgradeRoomCost.wood ||
        state.materials.steel < CONSTANTS.upgradeRoomCost.steel) return false;
    state.cash -= CONSTANTS.upgradeRoomCost.cash;
    state.materials.wood -= CONSTANTS.upgradeRoomCost.wood;
    state.materials.steel -= CONSTANTS.upgradeRoomCost.steel;
    cell.level++;
    AudioEngine.playUpgrade();
    showToast("Renovation Finalized!", `Upgraded to a ${CONSTANTS.roomLevels[cell.level - 1].name}!`, "success");
    populateUpgradeSelect();
    updateUI();
    return true;
};

// Initial launch loop
window.onload = function () {
    // Restore from save if one exists, otherwise start fresh
    if (hasSave() && loadGame()) {
        // loadGame() re-spawns walkers from saved staff counts — no free starter hires
        // loadGame also ensures owner walker is present
    } else {
        initHotel();
        // Spawn owner walker for a fresh game (no save file)
        spawnOwnerWalker(0, 0.5, 0.5);
    }
    Room3DRenderer.init();
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
        updateManagerWalk(cappedDt);
        if (state.hotelOwner) {
            state.hotelOwner.animFrame = (state.hotelOwner.animFrame || 0) + cappedDt * 2.2;
        }
        updateParticles();
        Room3DRenderer.renderFrame();
        CanvasRenderer.draw();

        requestAnimationFrame(drawLoop);
    }
    requestAnimationFrame(drawLoop);
}

// Expose for AI agent
window.initHotel = initHotel;
