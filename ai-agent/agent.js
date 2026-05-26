/**
 * Grand Hotel Blueprint — AI Agent
 *
 * Goal: maximize cash as fast as possible.
 * Logs structured JSONL to logs/run-<timestamp>.jsonl for game balancing analysis.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node agent.js                        # Claude Haiku (default)
 *   OPENAI_API_KEY=sk-...       node agent.js --model openai          # GPT-4.1 nano (cheapest)
 *   OPENAI_API_KEY=sk-...       node agent.js --model openai-mini     # GPT-4o mini
 *   node agent.js --headless --tick 6000 --turns 30                   # options
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_PATH  = path.resolve(__dirname, '../grand_hotel_blueprint.html');
const GAME_URL   = process.env.GAME_URL || `file://${GAME_PATH}`;

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const HEADLESS  = args.includes('--headless');
const TICK_MS   = parseInt(args[args.indexOf('--tick')  + 1]) || 4000;
const MAX_TURNS = parseInt(args[args.indexOf('--turns') + 1]) || 0;   // 0 = unlimited
const MODEL_ARG = args[args.indexOf('--model') + 1] || 'claude';         // claude | openai | openai-mini
const NEW_GAME  = !args.includes('--continue-save');                     // default: fresh game each run

// ─── Structured logger ────────────────────────────────────────────────────────
class Logger {
    constructor() {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        this.logDir = path.resolve(__dirname, 'logs');
        this.logPath = path.join(this.logDir, `run-${ts}.jsonl`);
        fs.mkdirSync(this.logDir, { recursive: true });
        this.stream = fs.createWriteStream(this.logPath, { flags: 'a' });
        this.startTime = Date.now();
        console.log(`[logger] Writing to ${this.logPath}`);
    }

    write(obj) {
        const line = JSON.stringify({
            ...obj,
            ts: new Date().toISOString(),
            elapsed_s: Math.round((Date.now() - this.startTime) / 1000),
        });
        this.stream.write(line + '\n');
    }

    close() {
        return new Promise(resolve => this.stream.end(resolve));
    }
}

// ─── Provider setup ───────────────────────────────────────────────────────────
let askLLM;

if (MODEL_ARG === 'claude') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    askLLM = async (systemPrompt, userContent) => {
        const msg = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 300,
            system: systemPrompt,
            messages: [{ role: 'user', content: userContent }]
        });
        return msg.content[0].text.trim();
    };
    console.log('Provider: Anthropic — claude-haiku-4-5');
} else {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI();
    const model  = MODEL_ARG === 'openai-mini' ? 'gpt-4o-mini' : 'gpt-4.1-nano';
    askLLM = async (systemPrompt, userContent) => {
        const res = await client.chat.completions.create({
            model,
            max_tokens: 300,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: userContent  }
            ]
        });
        return res.choices[0].message.content.trim();
    };
    console.log(`Provider: OpenAI — ${model}`);
}

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `\
You are an expert AI agent playing a hotel tycoon simulation. Your ONLY goal is to maximize total cash accumulated as fast as possible.

## Game mechanics

**Resources:** cash, concrete, wood, steel.

**Room lifecycle:**
  empty → build ($1500 + 25 concrete + 15 wood) → building (~33s) → ready → occupied (guest pays on checkout) → dirty → housekeeper cleans (~3s) → ready

**Room levels & rent per checkout:**
  Lvl 1 Standard  = $15   (×5 for VIP guests)
  Lvl 2 Deluxe    = $35
  Lvl 3 Executive = $75
  Lvl 4 Penthouse = $180

**Upgrade a room:** costs $800 + 12 wood + 6 steel. Room must be status=ready and not occupied.

**Staff (one-time hiring fee only — no per-second wages):**
  housekeeper  $30  — auto-cleans dirty rooms; without one dirty rooms never rebook
  builder      $75  — speeds up room construction
  receptionist $40  — +20% guest check-in rate per hire
  chef         $60  — unlocks full restaurant income; each chef adds +25% (cap 3 per hotel)
  valet        $45  — unlocks full parking income; each valet adds +25% (cap 3 per hotel)

**Material base prices:** concrete $20, wood $12, steel $60. Buy when below base = good deal.

## Money-maximization priorities

1. **Materials first — buy before you build.** Check \`materialShortfall.forRoom\`; if wood or concrete is short, buy_material NOW regardless of price — do not wait for a deal.
2. **Standing stockpile.** Keep ≥ 20 wood, ≥ 30 concrete, ≥ 5 steel. Buy to refill. **Hard cap: never exceed 50 wood / 80 concrete / 20 steel — excess wastes cash that should go toward builds.** Never buy materials if it would leave cash < $800 (unless buying specifically to cover a materialShortfall).
3. **Housekeeper discipline.** Hire 1 housekeeper when \`roomSummary.dirty > 0\`. Never fire-then-rehire; only fire if dirty = 0 for 2+ consecutive turns. Cap: 1 per 2 dirty rooms.
4. **Receptionist cap.** 1 per 2 ready rooms, max 3 total. Do not hire beyond this — extra receptionists waste cash.
5. **Builder cap.** 1 per room currently building, max 2. Fire ALL builders the turn \`roomSummary.building = 0\`.
6. **Room upgrades after materials stocked.** Lvl 4 earns 12× Lvl 1 — upgrade rooms once wood ≥ 15 and concrete ≥ 25 and steel ≥ 3.
7. **Build rooms to fill capacity.** More rooms = more simultaneous guests = more income.
8. **Set speed to 4×** on turn 1 — idle time is wasted money.
9. **Build 1 restaurant after 3+ guest rooms.** $0.80/s passive income beats a Lvl-1 room. Hire 1 chef right after — unlocks full rate, pays back in ~3 min at 4× speed.
10. **Build 1 parking lot after you have a restaurant.** $0.50/s stacks with restaurant income. Hire 1 valet immediately.
11. **Stack up to 3 chefs / 3 valets** once you have the facilities — each pays back quickly.

## Affordability rule

The state snapshot includes an \`affordability\` object. Each turn the user message ends with **Valid actions this turn:** listing what you are allowed to output. NEVER output an action not in that list — if nothing is affordable except \`wait\`, output \`wait\`.

## Output format

Return ONLY a valid JSON object — no markdown, no explanation outside the JSON:
{
  "action": "buy_material" | "hire_staff" | "fire_staff" | "build_room" | "build_restaurant" | "build_parking" | "upgrade_room" | "set_speed" | "wait",
  "params": {
    "material": "concrete"|"wood"|"steel",              (buy_material only)
    "amount": <integer>,                                 (buy_material only)
    "type": "housekeeper"|"builder"|"receptionist"|"chef"|"valet",  (hire_staff / fire_staff)
    "f": <floor>, "r": <row>, "c": <col>,               (upgrade_room only)
    "speed": 1|2|4                                       (set_speed only)
  },
  "reasoning": "<one sentence — what income/cost problem does this solve>"
}

Notes:
- build_room: takes no params — builds the next guest suite (respects max room cap).
- build_restaurant / build_parking: no params — amenities on the next empty guest-floor cell (or new floor).
  Restaurant earns $0.80/s passive income (only $0.40/s without a chef). Each chef adds +25% (max 3).
  Parking earns $0.50/s passive income (only $0.25/s without a valet). Each valet adds +25% (max 3).
  Both also improve walk-in booking odds. ROI beats a Lvl-1 room — build after you have 3+ guest rooms.
- fire_staff: dismisses one staff of the given type (frees a slot; there is no ongoing wage to remove).
- set_speed 4: do this on turn 1 or as soon as the hotel is stable — idle time is wasted money.`;

// ─── Read game state from the live page ──────────────────────────────────────
/**
 * Pull a JSON snapshot from the browser via Playwright's page.evaluate().
 * The callback runs in the page (access to window.state, DOM, etc.); the
 * returned object is serialized and deserialized in Node — must be plain data.
 */
async function readState(page) {
    return page.evaluate(() => {
        const s = window.state;
        const C = window.CONSTANTS;
        if (!s?.hotel || !C) return null;

        const rooms = [];
        const byLevel = {};
        for (let f = 1; f < s.hotel.length; f++) {
            for (let r = 0; r < s.hotel[f].length; r++) {
                for (let c = 0; c < s.hotel[f][r].length; c++) {
                    const cell = s.hotel[f][r][c];
                    if (cell.type === 'guest') {
                        rooms.push({ f, r, c,
                            level: cell.level,
                            status: cell.status,
                            buildProgress: Math.round(cell.buildProgress),
                            occupied: !!cell.guestId,
                            cleanliness: Math.round(cell.cleanliness)
                        });
                        const lk = String(cell.level);
                        byLevel[lk] = (byLevel[lk] || 0) + 1;
                    } else if (cell.type === 'restaurant' || cell.type === 'parking') {
                        rooms.push({
                            f, r, c,
                            type: cell.type,
                            status: cell.status,
                            buildProgress: Math.round(cell.buildProgress)
                        });
                    } else if (cell.type === 'empty') {
                        rooms.push({ f, r, c, status: 'empty' });
                    }
                }
            }
        }

        const upgradeTargets = rooms.filter(
            rm => rm.level != null && rm.status === 'ready' && !rm.occupied && rm.level < 4
        ).map(({ f, r, c, level }) => ({ f, r, c, level }));

        const totalWages = 0; // Game uses hire-fee-only staff — no wagesPerSec drain

        let estRentPerSec = 0;
        for (const rm of rooms) {
            if (rm.occupied && rm.level) {
                estRentPerSec += C.roomLevels[rm.level - 1].rent / 25;
            }
        }

        // Walker breakdown for guest/staff counts
        const walkerCounts = { total: 0, guest: 0, vip: 0, housekeeper: 0, builder: 0, receptionist: 0, chef: 0, valet: 0 };
        for (const w of (s.walkers || [])) {
            walkerCounts.total++;
            walkerCounts[w.type] = (walkerCounts[w.type] || 0) + 1;
        }

        // Facility counts and passive income estimate
        const facilityCount = { restaurant: 0, parking: 0, restaurantReady: 0, parkingReady: 0 };
        for (const rm of rooms) {
            if (rm.type === 'restaurant') { facilityCount.restaurant++; if (rm.status === 'ready') facilityCount.restaurantReady++; }
            if (rm.type === 'parking')    { facilityCount.parking++;    if (rm.status === 'ready') facilityCount.parkingReady++;    }
        }
        const chefCount  = Math.min(3, s.staff.chef  || 0);
        const valetCount = Math.min(3, s.staff.valet || 0);
        const unstaffed  = C.facilityUnstaffedFactor || 0.5;
        const restaurantPassive = facilityCount.restaurantReady * C.restaurantIncome * (chefCount  > 0 ? 1 : unstaffed) * (1 + chefCount  * 0.25);
        const parkingPassive    = facilityCount.parkingReady    * C.parkingIncome    * (valetCount > 0 ? 1 : unstaffed) * (1 + valetCount * 0.25);

        const gs_cash = Math.round(s.cash);
        const materials = s.materials;
        const costs = {
            buildRoom: C.buildRoomCost,
            buildRestaurant: C.buildRestaurantCost,
            buildParking: C.buildParkingCost,
            upgradeRoom: C.upgradeRoomCost
        };
        const dirtyCount = rooms.filter(r => r.status === 'dirty').length;

        let builtCount = 0;
        let emptySlots = 0;
        for (const rm of rooms) {
            if (rm.status === 'empty') emptySlots++;
            else if (rm.level != null) builtCount++;
        }
        const guestFloors = s.hotel.length - 1;
        const canAddFloor = guestFloors < s.maxFloors;
        const canPlaceRoom = emptySlots > 0 || canAddFloor;
        const btnBuild = document.getElementById('btn-build-room');
        const buildButtonEnabled = !!(btnBuild && !btnBuild.disabled);
        const btnRestaurant = document.getElementById('btn-build-restaurant');
        const btnParking = document.getElementById('btn-build-parking');
        const restaurantButtonEnabled = !!(btnRestaurant && !btnRestaurant.disabled);
        const parkingButtonEnabled = !!(btnParking && !btnParking.disabled);

        return {
            cash: gs_cash,
            materials,
            marketPrices: s.marketPrices,
            marketTrends: s.marketTrends,
            staff: s.staff,
            gameSpeed: s.gameSpeed,
            guestFloors,
            maxRooms: s.maxRooms,
            builtCount,
            emptySlots,
            rooms,
            roomSummary: {
                total: rooms.filter(r => r.status !== 'empty').length,
                empty: rooms.filter(r => r.status === 'empty').length,
                ready: rooms.filter(r => r.status === 'ready' && !r.occupied).length,
                occupied: rooms.filter(r => r.occupied).length,
                dirty: rooms.filter(r => r.status === 'dirty').length,
                building: rooms.filter(r => r.status === 'building').length,
                byLevel,
            },
            upgradeTargets,
            walkers: walkerCounts,
            facilityCount,
            facilityPassiveIncome: {
                restaurantPerSec: Math.round(restaurantPassive * 100) / 100,
                parkingPerSec:    Math.round(parkingPassive    * 100) / 100,
                totalPerSec:      Math.round((restaurantPassive + parkingPassive) * 100) / 100,
            },
            financials: {
                wagesPerSec: totalWages,
                estRentPerSec: Math.round(estRentPerSec * 10) / 10,
                facilityPerSec: Math.round((restaurantPassive + parkingPassive) * 10) / 10,
                netPerSec: Math.round((estRentPerSec + restaurantPassive + parkingPassive - totalWages) * 10) / 10,
            },
            costs,
            buildButtonEnabled,
            restaurantButtonEnabled,
            parkingButtonEnabled,
            staffTrainingLevels: {
                housekeeper: Math.min(C.staffTraining.maxLevel, Math.max(0, (s.staffTrainingLevels && s.staffTrainingLevels.housekeeper) | 0)),
                builder: Math.min(C.staffTraining.maxLevel, Math.max(0, (s.staffTrainingLevels && s.staffTrainingLevels.builder) | 0)),
                receptionist: Math.min(C.staffTraining.maxLevel, Math.max(0, (s.staffTrainingLevels && s.staffTrainingLevels.receptionist) | 0))
            },
            affordability: {
                canBuildRoom: buildButtonEnabled &&
                    builtCount < s.maxRooms &&
                    canPlaceRoom &&
                    gs_cash >= costs.buildRoom.cash &&
                    materials.concrete >= costs.buildRoom.concrete &&
                    materials.wood >= costs.buildRoom.wood,
                canBuildRestaurant: restaurantButtonEnabled &&
                    canPlaceRoom &&
                    gs_cash >= costs.buildRestaurant.cash &&
                    materials.concrete >= costs.buildRestaurant.concrete &&
                    materials.wood >= costs.buildRestaurant.wood &&
                    materials.steel >= costs.buildRestaurant.steel,
                canBuildParking: parkingButtonEnabled &&
                    canPlaceRoom &&
                    gs_cash >= costs.buildParking.cash &&
                    materials.concrete >= costs.buildParking.concrete &&
                    materials.steel >= costs.buildParking.steel,
                canUpgradeRoom: upgradeTargets.length > 0 && gs_cash >= costs.upgradeRoom.cash && materials.wood >= costs.upgradeRoom.wood && materials.steel >= costs.upgradeRoom.steel,
                canHireHousekeeper: dirtyCount > 0 &&
                    gs_cash >= C.staff.housekeeper.cost &&
                    s.staff.housekeeper < Math.min(3, dirtyCount),
                canHireBuilder: gs_cash >= C.staff.builder.cost &&
                    rooms.filter(r => r.status === 'building').length > 0 &&
                    s.staff.builder < Math.min(2, Math.max(1, rooms.filter(r => r.status === 'building').length)),
                canHireReceptionist: gs_cash >= C.staff.receptionist.cost &&
                    s.staff.receptionist < Math.min(3, Math.max(1, Math.floor(builtCount / 2))),
                canFireHousekeeper: s.staff.housekeeper > 0,
                canFireBuilder: s.staff.builder > 0 && rooms.filter(r => r.status === 'building').length === 0,
                canFireReceptionist: s.staff.receptionist > 0 &&
                    s.staff.receptionist > Math.min(3, Math.max(1, Math.floor(builtCount / 2))),
                canHireChef:  facilityCount.restaurant > 0 && gs_cash >= C.staff.chef.cost  && (s.staff.chef  || 0) < 3,
                canHireValet: facilityCount.parking    > 0 && gs_cash >= C.staff.valet.cost && (s.staff.valet || 0) < 3,
                canFireChef:  (s.staff.chef  || 0) > 0,
                canFireValet: (s.staff.valet || 0) > 0,
            },
            materialShortfall: {
                forRoom: {
                    wood:     Math.max(0, costs.buildRoom.wood     - materials.wood),
                    concrete: Math.max(0, costs.buildRoom.concrete - materials.concrete),
                },
                forRestaurant: {
                    wood:     Math.max(0, (costs.buildRestaurant.wood     || 0) - materials.wood),
                    concrete: Math.max(0, (costs.buildRestaurant.concrete || 0) - materials.concrete),
                    steel:    Math.max(0, (costs.buildRestaurant.steel    || 0) - materials.steel),
                },
                forParking: {
                    concrete: Math.max(0, (costs.buildParking.concrete || 0) - materials.concrete),
                    steel:    Math.max(0, (costs.buildParking.steel    || 0) - materials.steel),
                },
            }
        };
    });
}

// ─── Execute the chosen action in the live page ───────────────────────────────
async function execute(page, action) {
    const { action: type, params = {} } = action;
    switch (type) {
        case 'buy_material':
            await page.evaluate(({ material, amount }) => window.buyMaterial(material, amount), params);
            break;
        case 'hire_staff':
            await page.evaluate(({ type }) => window.hireStaff(type), params);
            break;
        case 'fire_staff':
            await page.evaluate(({ type }) => window.fireStaff(type), params);
            break;
        case 'build_room':
            await page.evaluate(() => {
                const btn = document.getElementById('btn-build-room');
                if (btn && !btn.disabled) btn.click();
            });
            break;
        case 'build_restaurant':
            await page.evaluate(() => {
                const btn = document.getElementById('btn-build-restaurant');
                if (btn && !btn.disabled) btn.click();
            });
            break;
        case 'build_parking':
            await page.evaluate(() => {
                const btn = document.getElementById('btn-build-parking');
                if (btn && !btn.disabled) btn.click();
            });
            break;
        case 'upgrade_room':
            await page.evaluate(({ f, r, c }) => {
                const sel = document.getElementById('select-upgrade-room');
                if (sel) sel.value = `${f}-${r}-${c}`;
                const btn = document.getElementById('btn-upgrade-room');
                if (btn) { btn.disabled = false; btn.click(); }
            }, params);
            break;
        case 'set_speed':
            await page.evaluate(({ speed }) => window.setGameSpeed(speed), params);
            break;
        case 'wait':
        default:
            break;
    }
}

/** Labels the model may emit this turn (affordability-aware). */
function validActionsThisTurn(gs) {
    const a = gs.affordability;
    const out = ['wait', 'buy_material', 'set_speed'];
    if (a.canBuildRoom) out.push('build_room');
    if (a.canBuildRestaurant) out.push('build_restaurant');
    if (a.canBuildParking) out.push('build_parking');
    if (a.canUpgradeRoom) out.push('upgrade_room');
    if (a.canHireHousekeeper) out.push('hire_staff (housekeeper)');
    if (a.canHireBuilder) out.push('hire_staff (builder)');
    if (a.canHireReceptionist) out.push('hire_staff (receptionist)');
    if (a.canHireChef)  out.push('hire_staff (chef)');
    if (a.canHireValet) out.push('hire_staff (valet)');
    if (a.canFireHousekeeper) out.push('fire_staff (housekeeper)');
    if (a.canFireBuilder) out.push('fire_staff (builder)');
    if (a.canFireReceptionist) out.push('fire_staff (receptionist)');
    if (a.canFireChef)  out.push('fire_staff (chef)');
    if (a.canFireValet) out.push('fire_staff (valet)');
    return out;
}

/** Map mistaken action labels like "hire_staff:receptionist" → proper JSON shape. */
function normalizeActionShape(action) {
    if (!action || typeof action.action !== 'string') return action;
    let act = action.action.trim();
    const m = /^(hire_staff|fire_staff):(\w+)$/.exec(act);
    if (m) {
        return {
            action: m[1],
            params: { ...(action.params || {}), type: m[2] },
            reasoning: action.reasoning,
        };
    }
    return action;
}

/**
 * If the model ignored affordability, coerce to wait so the tick still advances
 * cleanly (logs override instead of spamming blocked_action).
 */
function clampActionToAffordability(action, gs) {
    const af = gs.affordability;
    const orig = action.action;
    const p = action.params || {};

    if (orig === 'buy_material' && (!action.params?.amount || action.params.amount <= 0)) {
        return { action: { action: 'wait', params: {}, reasoning: `${action.reasoning || ''} [clamped: amount ≤ 0]`.trim() }, clamped: true, from: orig };
    }
    if (orig === 'buy_material' && action.params?.amount > 0) {
        const mat = action.params.material;
        const price = (gs.marketPrices && gs.marketPrices[mat]) || (mat === 'steel' ? 60 : mat === 'wood' ? 12 : 20);
        const cost = action.params.amount * price;
        const mats = gs.materials || {};
        const stockpileCap = { concrete: 80, wood: 50, steel: 20 };
        const alreadyEnough = (mats[mat] || 0) >= stockpileCap[mat];
        const shortfallForRoom = gs.materialShortfall?.forRoom?.[mat] > 0;
        const cashAfterBuy = gs.cash - cost;
        if (alreadyEnough) {
            return { action: { action: 'wait', params: {}, reasoning: `[clamped: ${mat} at cap ${stockpileCap[mat]}]` }, clamped: true, from: orig };
        }
        if (!shortfallForRoom && cashAfterBuy < 800) {
            return { action: { action: 'wait', params: {}, reasoning: `[clamped: buy would drop cash below $800 reserve]` }, clamped: true, from: orig };
        }
    }
    if (orig === 'build_room' && !af.canBuildRoom) {
        return { action: { action: 'wait', params: {}, reasoning: `${action.reasoning || ''} [clamped: cannot build]`.trim() }, clamped: true, from: orig };
    }
    if (orig === 'build_restaurant' && !af.canBuildRestaurant) {
        return { action: { action: 'wait', params: {}, reasoning: `${action.reasoning || ''} [clamped: cannot build restaurant]`.trim() }, clamped: true, from: orig };
    }
    if (orig === 'build_parking' && !af.canBuildParking) {
        return { action: { action: 'wait', params: {}, reasoning: `${action.reasoning || ''} [clamped: cannot build parking]`.trim() }, clamped: true, from: orig };
    }
    if (orig === 'upgrade_room' && !af.canUpgradeRoom) {
        return { action: { action: 'wait', params: {}, reasoning: `${action.reasoning || ''} [clamped: cannot upgrade]`.trim() }, clamped: true, from: orig };
    }
    if (orig === 'hire_staff') {
        const t = p.type;
        const ok =
            (t === 'housekeeper' && af.canHireHousekeeper) ||
            (t === 'builder' && af.canHireBuilder) ||
            (t === 'receptionist' && af.canHireReceptionist) ||
            (t === 'chef'  && af.canHireChef) ||
            (t === 'valet' && af.canHireValet);
        if (!ok) {
            return { action: { action: 'wait', params: {}, reasoning: `${action.reasoning || ''} [clamped: cannot hire ${t || '?'}]`.trim() }, clamped: true, from: orig };
        }
    }
    if (orig === 'fire_staff') {
        const t = p.type;
        const ok =
            (t === 'housekeeper' && af.canFireHousekeeper) ||
            (t === 'builder' && af.canFireBuilder) ||
            (t === 'receptionist' && af.canFireReceptionist) ||
            (t === 'chef'  && af.canFireChef) ||
            (t === 'valet' && af.canFireValet);
        if (!ok) {
            return { action: { action: 'wait', params: {}, reasoning: `${action.reasoning || ''} [clamped: cannot fire ${t || '?'}]`.trim() }, clamped: true, from: orig };
        }
    }
    return { action, clamped: false, from: null };
}

// ─── One agent tick ───────────────────────────────────────────────────────────
async function tick(page, turn, logger, session) {
    const gs = await readState(page);
    if (!gs) { console.warn('[agent] State unavailable, skipping'); return; }

    const cashDelta = session.lastCash !== null ? gs.cash - session.lastCash : 0;
    session.lastCash = gs.cash;
    if (gs.cash > session.peakCash) session.peakCash = gs.cash;
    if (cashDelta > 0) session.totalEarned += cashDelta;
    if (cashDelta < 0) session.totalSpent  += Math.abs(cashDelta);

    // Bug 7 fix: estimate gross revenue by adding back wages paid this tick
    const wagesThisTick = gs.financials.wagesPerSec * (TICK_MS / 1000);
    const estimatedGrossRevenue = Math.max(0, cashDelta + wagesThisTick);

    // ── Console summary line ──
    const rs = gs.roomSummary;
    const delta = cashDelta >= 0 ? `+$${cashDelta}` : `-$${Math.abs(cashDelta)}`;
    console.log(
        `[T${String(turn).padStart(3)}] $${gs.cash.toLocaleString().padStart(7)} (${delta.padStart(6)})` +
        ` | net ${String(gs.financials.netPerSec).padStart(5)}/s` +
        ` | rdy:${rs.ready} occ:${rs.occupied} dirty:${rs.dirty} bldg:${rs.building}` +
        ` | lvl:${JSON.stringify(rs.byLevel)}` +
        ` | rec:${gs.staff.receptionist} hk:${gs.staff.housekeeper} bld:${gs.staff.builder}` +
        ` | walkers:${gs.walkers.total}`
    );

    // ── Log tick metrics ──
    logger.write({
        type: 'tick',
        turn,
        cash: gs.cash,
        cash_delta: cashDelta,
        estimated_gross_revenue: Math.round(estimatedGrossRevenue),
        wages_this_tick: Math.round(wagesThisTick),
        peak_cash: session.peakCash,
        financials: gs.financials,
        rooms: gs.roomSummary,
        staff: gs.staff,
        walkers: gs.walkers,
        materials: gs.materials,
        market_prices: gs.marketPrices,
        market_trends: gs.marketTrends,
        game_speed: gs.gameSpeed,
        guest_floors: gs.guestFloors,
        upgrade_targets_count: gs.upgradeTargets.length,
    });

    // ── Pre-LLM override: ensure speed 4 from turn 1 ──
    if (gs.gameSpeed < 4) {
        const override = { action: 'set_speed', params: { speed: 4 }, reasoning: '[auto] set 4× speed for max income' };
        console.log(`         ⚡ override → set_speed {4} (was ${gs.gameSpeed}×)`);
        logger.write({ type: 'override', turn, ...override });
        await execute(page, override);
        // Don't return — continue to LLM for the main action this turn
    }

    // ── Pre-LLM override: auto-upgrade room when affordable and new build is not viable ──
    if (gs.affordability.canUpgradeRoom && gs.upgradeTargets.length > 0 &&
        !gs.affordability.canBuildRoom && gs.builtCount >= 3) {
        const t = gs.upgradeTargets[0];
        const override = { action: 'upgrade_room', params: { f: t.f, r: t.r, c: t.c }, reasoning: `[auto] Upgrade room (${t.f},${t.r},${t.c}) lvl ${t.level} → ${t.level + 1} for higher rent` };
        console.log(`         ⚡ override → upgrade_room (${t.f},${t.r},${t.c}) lvl ${t.level}`);
        logger.write({ type: 'override', turn, ...override });
        session.actionCounts['upgrade_room'] = (session.actionCounts['upgrade_room'] || 0) + 1;
        await execute(page, override);
        return;
    }

    // ── Pre-LLM override: hire housekeeper when dirty rooms are backlogged ──
    if (rs.dirty > 0 && gs.staff.housekeeper === 0 && gs.cash >= gs.costs.buildRoom.cash / 50 && gs.affordability.canHireHousekeeper) {
        const override = { action: 'hire_staff', params: { type: 'housekeeper' }, reasoning: `[auto] ${rs.dirty} dirty room(s), no housekeeper — hiring one` };
        console.log(`         ⚡ override → hire_staff {housekeeper} (${rs.dirty} dirty, 0 hk)`);
        logger.write({ type: 'override', turn, ...override });
        session.actionCounts['hire_staff'] = (session.actionCounts['hire_staff'] || 0) + 1;
        await execute(page, override);
        return;
    }

    // ── Pre-LLM override: auto-fire builders when no building rooms ──
    if (gs.staff.builder > 0 && rs.building === 0) {
        const override = { action: 'fire_staff', params: { type: 'builder' }, reasoning: '[auto] No building rooms — firing idle builder' };
        console.log(`         ⚡ override → fire_staff {builder} (building=0)`);
        logger.write({ type: 'override', turn, ...override });
        session.actionCounts['fire_staff'] = (session.actionCounts['fire_staff'] || 0) + 1;
        await execute(page, override);
        return;
    }

    // ── Pre-LLM override: fire staff if cash runway < 20s ──
    const wages = gs.financials.wagesPerSec;
    const runway = wages > 0 ? gs.cash / wages : Infinity;
    const hkCap = Math.min(3, rs.dirty);
    if (gs.staff.housekeeper > hkCap) {
        const override = { action: 'fire_staff', params: { type: 'housekeeper' }, reasoning: `[auto] ${gs.staff.housekeeper} housekeepers > cap ${hkCap} for ${rs.dirty} dirty room(s)` };
        console.log(`         ⚡ override → fire_staff {housekeeper} (over cap)`);
        logger.write({ type: 'override', turn, ...override });
        session.actionCounts['fire_staff'] = (session.actionCounts['fire_staff'] || 0) + 1;
        await execute(page, override);
        return;
    }

    if (runway < 20 && wages > 0) {
        // Fire the most expensive dispensable staff type
        const fireOrder = ['builder', 'housekeeper', 'receptionist'];
        const target = fireOrder.find(t => gs.staff[t] > 0);
        if (target) {
            const override = { action: 'fire_staff', params: { type: target }, reasoning: `[auto] Runway ${Math.round(runway)}s < 20s — firing ${target} to prevent bankruptcy` };
            console.log(`         ⚡ override → fire_staff {${target}} (runway ${Math.round(runway)}s)`);
            logger.write({ type: 'override', turn, ...override });
            session.actionCounts['fire_staff'] = (session.actionCounts['fire_staff'] || 0) + 1;
            await execute(page, override);
            return;
        }
    }

    // ── Ask LLM ──
    const allowed = validActionsThisTurn(gs);
    const raw = await askLLM(
        SYSTEM_PROMPT,
        `Game state:\n${JSON.stringify(gs, null, 2)}\n\n` +
            `Valid actions this turn (output JSON with \"action\" exactly one of: wait, buy_material, set_speed, build_room, build_restaurant, build_parking, upgrade_room, hire_staff, fire_staff — use params as in the system prompt):\n` +
            `${allowed.join(', ')}\n\n` +
            `What single action maximizes my cash? Reply with one JSON action.`
    );

    const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();

    let action;
    try {
        action = JSON.parse(clean);
    } catch {
        console.error('[agent] Bad JSON:', clean);
        logger.write({ type: 'error', turn, error: 'bad_json', raw: clean });
        return;
    }

    action = normalizeActionShape(action);
    const { action: actionAfterClamp, clamped, from: clampedFrom } = clampActionToAffordability(action, gs);
    action = actionAfterClamp;
    if (clamped) {
        console.log(`         ⚡ clamped ${clampedFrom} → wait (affordability)`);
        logger.write({ type: 'override', turn, from: clampedFrom, to: 'wait', reason: 'affordability_clamp' });
    }

    const paramsStr = Object.keys(action.params || {}).length
        ? ' ' + JSON.stringify(action.params)
        : '';
    console.log(`         → ${action.action}${paramsStr}`);
    console.log(`           ${action.reasoning}`);

    // ── Log action ──
    logger.write({
        type: 'action',
        turn,
        action: action.action,
        params: action.params || {},
        reasoning: action.reasoning,
        cash_before: gs.cash,
    });

    session.actionCounts[action.action] = (session.actionCounts[action.action] || 0) + 1;

    const roomsTotalBefore = gs.roomSummary.total;
    const buildingBefore = gs.roomSummary.building;
    await execute(page, action);

    // Verify build/upgrade actually changed state (log silent no-ops)
    if (action.action === 'build_room' || action.action === 'build_restaurant' || action.action === 'build_parking' || action.action === 'upgrade_room') {
        const gsAfter = await readState(page);
        if (gsAfter) {
            if (action.action === 'build_room') {
                const progressed = gsAfter.roomSummary.total > roomsTotalBefore ||
                    gsAfter.roomSummary.building > buildingBefore;
                if (progressed) session.roomsBuilt++;
                else {
                    console.log(`         ⛔ build_room had no effect (button disabled or grid full)`);
                    logger.write({ type: 'blocked_action', turn, attempted: 'build_room', params: action.params || {}, reason: 'no_effect' });
                }
            }
            if (action.action === 'build_restaurant' || action.action === 'build_parking') {
                const progressed = gsAfter.roomSummary.total > roomsTotalBefore ||
                    gsAfter.roomSummary.building > buildingBefore;
                if (!progressed) {
                    console.log(`         ⛔ ${action.action} had no effect`);
                    logger.write({ type: 'blocked_action', turn, attempted: action.action, params: action.params || {}, reason: 'no_effect' });
                }
            }
            if (action.action === 'upgrade_room') {
                const levelBefore = JSON.stringify(gs.roomSummary.byLevel);
                const levelAfter  = JSON.stringify(gsAfter.roomSummary.byLevel);
                if (levelAfter !== levelBefore) session.roomsUpgraded++;
                else {
                    console.log(`         ⛔ upgrade_room had no effect`);
                    logger.write({ type: 'blocked_action', turn, attempted: 'upgrade_room', params: action.params || {}, reason: 'no_effect' });
                }
            }
        }
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const logger = new Logger();

    const session = {
        lastCash: null,
        peakCash: 0,
        totalEarned: 0,
        totalSpent: 0,
        actionCounts: {},
        roomsBuilt: 0,
        roomsUpgraded: 0,
    };

    console.log('Grand Hotel AI Agent');
    console.log(`  Headless : ${HEADLESS}`);
    console.log(`  Tick     : ${TICK_MS}ms`);
    console.log(`  Max turns: ${MAX_TURNS || '∞'}`);
    console.log(`  New game : ${NEW_GAME ? 'yes (use --continue-save to keep save)' : 'no'}`);
    console.log('');

    logger.write({
        type: 'session_start',
        model: MODEL_ARG,
        headless: HEADLESS,
        tick_ms: TICK_MS,
        max_turns: MAX_TURNS,
    });

    const browser = await chromium.launch({ headless: HEADLESS });
    const page    = await browser.newPage();

    await page.goto(GAME_URL);
    await page.waitForFunction(
        () => window.state && Array.isArray(window.state.hotel) && window.state.hotel.length > 1,
        { timeout: 30_000 }
    );
    console.log('[agent] Game loaded. Starting in 2s...\n');
    await page.waitForTimeout(2000);

    if (NEW_GAME) {
        await page.evaluate(() => window.startNewGame(true));
        console.log('[agent] New game started — $10,000 cash, 0 staff, 1 starter room\n');
        session.lastCash = null;
    }

    await page.evaluate(() => window.setGameSpeed(4));

    let turn = 1;
    while (MAX_TURNS === 0 || turn <= MAX_TURNS) {
        try { await tick(page, turn++, logger, session); }
        catch (err) {
            console.error('[agent] Tick error:', err.message);
            logger.write({ type: 'error', turn, error: err.message });
        }
        await page.waitForTimeout(TICK_MS);
    }

    // ── Final state snapshot ──
    const finalGs = await readState(page).catch(() => null);

    const summary = {
        type: 'session_end',
        turns: turn - 1,
        final_cash: finalGs?.cash ?? session.lastCash,
        peak_cash: session.peakCash,
        total_earned: session.totalEarned,
        total_spent: session.totalSpent,
        net_gain: session.totalEarned - session.totalSpent,
        action_counts: session.actionCounts,
        rooms_built: session.roomsBuilt,
        rooms_upgraded: session.roomsUpgraded,
        final_rooms: finalGs?.roomSummary ?? null,
        final_staff: finalGs?.staff ?? null,
        final_financials: finalGs?.financials ?? null,
    };

    logger.write(summary);
    await logger.close();

    console.log('\n── Session Summary ──────────────────────────────');
    console.log(`  Turns       : ${summary.turns}`);
    console.log(`  Final cash  : $${summary.final_cash?.toLocaleString()}`);
    console.log(`  Peak cash   : $${summary.peak_cash?.toLocaleString()}`);
    console.log(`  Total earned: $${summary.total_earned?.toLocaleString()}`);
    console.log(`  Total spent : $${summary.total_spent?.toLocaleString()}`);
    console.log(`  Net gain    : $${summary.net_gain?.toLocaleString()}`);
    console.log(`  Rooms built : ${summary.rooms_built}`);
    console.log(`  Rooms upg'd : ${summary.rooms_upgraded}`);
    console.log(`  Actions     : ${JSON.stringify(summary.action_counts)}`);
    console.log('─────────────────────────────────────────────────');

    await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
