// ui-handlers.js — depends on: constants.js, state.js, simulation.js, simulation-walkers.js, ui.js

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
    state.fun = { checkouts: 0, tipsTotal: 0, rushHourTicks: 0, lastCheckoutAt: 0, recentCheckoutTimes: [] };
    state.staffTrainingLevels = { housekeeper: 0, builder: 0, receptionist: 0, chef: 0, valet: 0 };
    state.hotelOwner = { name: 'Jordan Blake', title: 'Proprietor', animFrame: 0 };
    initHotel();
    // Spawn owner as a walkable entity (click-to-move in Inside view)
    spawnOwnerWalker(0, 0.5, 0.5);
    populateUpgradeSelect();
    updateUI();
    if (!silent) showToast('New Game', 'Your hotel has been reset. Good luck!', 'success');
};

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

        if (!cell || cell.level >= CONSTANTS.roomLevels.length) {
            showToast("Already Max Level", "This room is at the highest tier.", "warning");
            return;
        }
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

// Save / Load / Export / Import / New Game button handlers
document.getElementById('btn-save')?.addEventListener('click', () => saveGame());
document.getElementById('btn-load')?.addEventListener('click', () => {
    if (loadGame()) {
        // loadGame() already re-spawns all staff walkers from state.staff counts
        populateUpgradeSelect();
        updateUI();
    }
});
document.getElementById('btn-export')?.addEventListener('click', () => exportSave());
document.getElementById('btn-import')?.addEventListener('click', () => {
    document.getElementById('import-file').value = '';
    document.getElementById('import-file').click();
});
document.getElementById('import-file')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) importSave(file);
});
document.getElementById('btn-new-game')?.addEventListener('click', () => {
    if (!confirm('Start a new game? Your current progress will be lost.')) return;
    window.startNewGame(false);
});

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

// Expose for AI agent
window.setGameSpeed = setGameSpeed;
