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

    // Passive construction progress (3%/sec base; builders also contribute via walker AI)
    for (let f = 1; f < state.hotel.length; f++) {
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const cell = state.hotel[f][r][c];
                const passiveBuildTypes = ['guest', 'restaurant', 'parking'];
                if (passiveBuildTypes.includes(cell.type) && cell.status === 'building') {
                    cell.buildProgress = Math.min(100, cell.buildProgress + 3 * state.gameSpeed);
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

// Expand Room Blueprint Event
const btnBuild = document.getElementById('btn-build-room');
if (btnBuild) {
    btnBuild.addEventListener('click', () => {
        const cap = getRoomCapacity();
        if (cap.built >= state.maxRooms) {
            showToast('Room cap', 'You are at maximum guest suites — upgrade or wait.', 'warning');
            return;
        }
        const target = resolveNextGuestFloorBuildTarget();
        if (!target) {
            showToast("Floor Limit Reached!", `Maximum ${state.maxFloors} guest floors — hotel fully expanded!`, 'warning');
            return;
        }
        if (state.cash < CONSTANTS.buildRoomCost.cash ||
            state.materials.concrete < CONSTANTS.buildRoomCost.concrete ||
            state.materials.wood < CONSTANTS.buildRoomCost.wood) {
            showToast('Insufficient Resources', 'Not enough cash or materials to build.', 'warning');
            return;
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
        showToast("Construction Approved!", `Laying foundation columns at Floor ${target.f} [Grid ${target.r},${target.c}].`, 'success');
        updateUI();
    });
}

const btnBuildRestaurant = document.getElementById('btn-build-restaurant');
if (btnBuildRestaurant) {
    btnBuildRestaurant.addEventListener('click', () => {
        placeFacilityBuild('restaurant', CONSTANTS.buildRestaurantCost, 'Restaurant');
    });
}
const btnBuildParking = document.getElementById('btn-build-parking');
if (btnBuildParking) {
    btnBuildParking.addEventListener('click', () => {
        placeFacilityBuild('parking', CONSTANTS.buildParkingCost, 'Parking deck');
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
const _vz = () => CONSTANTS.viewZoom;
document.getElementById('btn-zoom-in').addEventListener('click', () => {
    const vz = _vz();
    state.zoom = Math.min(vz.max, state.zoom + vz.stepButton);
});
document.getElementById('btn-zoom-out').addEventListener('click', () => {
    const vz = _vz();
    state.zoom = Math.max(vz.min, state.zoom - vz.stepButton);
});
document.getElementById('btn-reset-view').addEventListener('click', () => {
    const vz = _vz();
    state.zoom = vz.reset;
    state.panX = 0;
    state.panY = 0;
    state.isoYaw = 0;
});
const ISO_YAW_STEP = Math.PI / 18; // 10°
document.getElementById('btn-rotate-left')?.addEventListener('click', () => {
    state.isoYaw = (state.isoYaw || 0) - ISO_YAW_STEP;
});
document.getElementById('btn-rotate-right')?.addEventListener('click', () => {
    state.isoYaw = (state.isoYaw || 0) + ISO_YAW_STEP;
});

document.getElementById('btn-toggle-view').addEventListener('click', () => {
    const modes = ['inside', 'exterior', 'firstperson', 'manager'];
    const labels = ['Inside View', 'Exterior View', '1st Person', 'Manager walk'];
    const icons = ['fa-eye', 'fa-building', 'fa-person-walking', 'fa-user-tie'];
    const classes = [
        'px-3 h-10 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-lg',
        'px-3 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold text-xs flex items-center justify-center gap-1.5 transition-all border border-slate-600',
        'px-3 h-10 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-lg',
        'px-3 h-10 rounded-lg bg-violet-800 hover:bg-violet-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-lg border border-violet-600'
    ];
    const idx = modes.indexOf(state.viewMode);
    const next = (idx + 1) % modes.length;
    state.viewMode = modes[next];
    if (state.viewMode === 'firstperson') {
        state.fpFloor = Math.max(1, Math.min(state.fpFloor, state.hotel.length - 1));
    } else if (state.viewMode === 'manager') {
        resetManagerWalkSpawn();
        state.fpRoom = null;
        Room3DRenderer.hide();
        document.getElementById('game-canvas')?.focus?.();
    } else {
        state.fpRoom = null;
        Room3DRenderer.hide();
    }
    const btn = document.getElementById('btn-toggle-view');
    btn.className = classes[next];
    document.getElementById('txt-view-mode').innerText = labels[next];
    const ic = btn.querySelector('i');
    if (ic) ic.className = `fa-solid ${icons[next]}`;
});

// Drag pan + orbit (full 360° on isoYaw)
let isDragging = false;
let isOrbitDragging = false;
let startX, startY;
let orbitLastX = 0;
/** Radians of yaw per horizontal pixel while orbit-dragging (≈0.52°/px). */
const ISO_ORBIT_SENS = 0.009;

const canvasEl = document.getElementById('game-canvas');
canvasEl.addEventListener('contextmenu', (e) => {
    if (state.viewMode === 'inside' || state.viewMode === 'exterior') e.preventDefault();
});
canvasEl.addEventListener('wheel', (e) => {
    if (state.viewMode === 'firstperson' || state.viewMode === 'manager') return;
    if (e.shiftKey) {
        e.preventDefault();
        state.isoYaw = (state.isoYaw || 0) + (e.deltaY > 0 ? -0.08 : 0.08);
        return;
    }
    e.preventDefault();
    const vz = CONSTANTS.viewZoom;
    const dir = e.deltaY > 0 ? -1 : 1;
    state.zoom = Math.min(vz.max, Math.max(vz.min, state.zoom + dir * vz.stepWheel));
}, { passive: false });
canvasEl.addEventListener('mousedown', (e) => {
    if (state.viewMode === 'firstperson' || state.viewMode === 'manager') return;
    const wantOrbit = e.button === 2 || (e.button === 0 && e.altKey);
    if (wantOrbit) {
        isOrbitDragging = true;
        orbitLastX = e.clientX;
        isDragging = false;
        e.preventDefault();
        return;
    }
    if (e.button !== 0) return;
    isDragging = true;
    isOrbitDragging = false;
    startX = e.clientX - state.panX;
    startY = e.clientY - state.panY;
});
window.addEventListener('mousemove', (e) => {
    if (isOrbitDragging && (state.viewMode === 'inside' || state.viewMode === 'exterior')) {
        const dx = e.clientX - orbitLastX;
        orbitLastX = e.clientX;
        state.isoYaw = (state.isoYaw || 0) + dx * ISO_ORBIT_SENS;
        return;
    }
    if (isDragging && state.viewMode !== 'firstperson' && state.viewMode !== 'manager') {
        state.panX = e.clientX - startX;
        state.panY = e.clientY - startY;
    }
});
window.addEventListener('mouseup', () => {
    isDragging = false;
    isOrbitDragging = false;
});

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

// Reset to default starting state (no staff — hire from Management)
window.startNewGame = function (silent = false) {
    deleteSave();
    state.cash = STARTING_CASH;
    state.materials = { concrete: 50, wood: 35, steel: 15 };
    state.marketPrices = { concrete: 20, wood: 12, steel: 60 };
    state.staff = { housekeeper: 0, receptionist: 0, builder: 0, chef: 0, valet: 0 };
    state.walkers = [];
    state.particles = [];
    state.gameSpeed = 1;
    state.campaignActive = false;
    state.campaignTimer = 0;
    state.fpFloor = 1;
    state.fpRoom = null;
    state.viewMode = 'inside';
    state.managerWalk = { f: 1, x: 0.55, z: 0.45, yaw: 0 };
    state.isoYaw = 0;
    state.zoom = CONSTANTS.viewZoom.reset;
    state.panX = 0;
    state.panY = 0;
    state.fun = { checkouts: 0, tipsTotal: 0, rushHourTicks: 0, lastCheckoutAt: 0 };
    state.staffTrainingLevels = { housekeeper: 0, builder: 0, receptionist: 0, chef: 0, valet: 0 };
    state.hotelOwner = { name: 'Jordan Blake', title: 'Proprietor', animFrame: 0 };
    initHotel();
    // Spawn owner as a walkable entity (click-to-move in Inside view)
    spawnOwnerWalker(0, 0.5, 0.5);
    populateUpgradeSelect();
    updateUI();
    if (!silent) showToast('New Game', 'Your hotel has been reset. Good luck!', 'success');
};

window.saveHotelOwnerProfile = function () {
    const n = document.getElementById('owner-name-input');
    const t = document.getElementById('owner-title-input');
    if (!state.hotelOwner) state.hotelOwner = { name: 'Jordan Blake', title: 'Proprietor', animFrame: 0 };
    const name = (n && n.value.trim()) || 'Jordan Blake';
    const title = (t && t.value.trim()) || 'Proprietor';
    state.hotelOwner.name = name.slice(0, 32);
    state.hotelOwner.title = title.slice(0, 32);
    updateUI();
    showToast('Proprietor updated', `${state.hotelOwner.name} — ${state.hotelOwner.title}`, 'success');
};

document.getElementById('btn-owner-save')?.addEventListener('click', () => window.saveHotelOwnerProfile());

// Save / Load / New Game button handlers
document.getElementById('btn-save')?.addEventListener('click', () => saveGame());
document.getElementById('btn-load')?.addEventListener('click', () => {
    if (loadGame()) {
        // loadGame() already re-spawns all staff walkers from state.staff counts
        populateUpgradeSelect();
        updateUI();
    }
});
document.getElementById('btn-new-game')?.addEventListener('click', () => {
    if (!confirm('Start a new game? Your current progress will be lost.')) return;
    window.startNewGame(false);
});

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
window.setGameSpeed = setGameSpeed;
window.initHotel    = initHotel;

// Manager walk — keyboard (game-canvas should be focusable: tabindex="0")
// ── Owner WASD movement (inside view) ──────────────────────────────────────
window.addEventListener('keydown', (e) => {
    if (state.viewMode !== 'inside') return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    const dirKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD'];
    const floorKeys = ['BracketLeft', 'BracketRight'];
    if (!dirKeys.includes(e.code) && !floorKeys.includes(e.code)) return;
    e.preventDefault();

    const ownerW = state.walkers.find(w => w.id === 'owner');
    if (!ownerW || typeof window.moveOwnerTo !== 'function') return;

    const curFloor = ownerW.targetF !== undefined ? ownerW.targetF : ownerW.f;
    const curX = ownerW.targetGridX !== undefined ? ownerW.targetGridX : (ownerW.c + ownerW.v);
    const curY = ownerW.targetGridY !== undefined ? ownerW.targetGridY : (ownerW.r + ownerW.u);

    if (e.code === 'BracketLeft'  && !e.repeat) { window.moveOwnerTo(Math.max(0, curFloor - 1), curX, curY); return; }
    if (e.code === 'BracketRight' && !e.repeat) { window.moveOwnerTo(Math.min(state.hotel.length - 1, curFloor + 1), curX, curY); return; }

    let dx = 0, dy = 0;
    if (e.code === 'ArrowUp'    || e.code === 'KeyW') dy = -1;
    if (e.code === 'ArrowDown'  || e.code === 'KeyS') dy = +1;
    if (e.code === 'ArrowLeft'  || e.code === 'KeyA') dx = -1;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') dx = +1;

    const newX = Math.max(0, Math.min(GRID_COLS - 0.5, curX + dx));
    const newY = Math.max(0, Math.min(GRID_ROWS - 0.5, curY + dy));
    window.moveOwnerTo(curFloor, newX, newY);
});

window.addEventListener('keydown', (e) => {
    if (state.viewMode !== 'manager') return;
    if (e.code === 'Escape' && state.fpRoom) {
        state.fpRoom = null;
        Room3DRenderer.hide();
        e.preventDefault();
        return;
    }
    if (state.fpRoom) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(e.code)) {
        e.preventDefault();
    }
    window._mgrKeys[e.code] = true;
    if (e.code === 'KeyE' && !e.repeat) tryManagerEnterSuite();
    if (e.code === 'BracketLeft' && !e.repeat) tryManagerElevatorFloor(-1);
    if (e.code === 'BracketRight' && !e.repeat) tryManagerElevatorFloor(1);
});
window.addEventListener('keyup', (e) => {
    if (state.viewMode !== 'manager') return;
    window._mgrKeys[e.code] = false;
});
