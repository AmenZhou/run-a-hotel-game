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

**Staff (hire cost + ongoing wage/sec):**
  housekeeper  $500, $2/sec  — auto-cleans dirty rooms; without one dirty rooms never rebook
  builder      $800, $3/sec  — speeds up room construction
  receptionist $400, $3/sec  — +20% guest check-in rate per hire

**Material base prices:** concrete $20, wood $12, steel $60. Buy when below base = good deal.

## Money-maximization priorities

1. **Dirty rooms are lost income.** Hire a housekeeper only when \`roomSummary.dirty > 0\` — never hire preemptively. Cap at 1 housekeeper per 3 dirty rooms.
2. **Room upgrades are the best ROI.** Lvl 4 earns 12× more than Lvl 1. Upgrade every room as soon as you can afford it.
3. **Build rooms to fill capacity.** More rooms = more simultaneous guests = more income.
4. **Receptionist multiplies income.** Each one boosts check-in rate 20% — hire early.
5. **Builder shortens dead time.** Rooms earn nothing while building — a builder pays back fast.
6. **Buy materials when cheap.** Concrete/wood/steel below base price = buy in bulk.
7. **Set speed to 4×** as soon as the hotel is stable — idle time is lost money.
8. **Never go bankrupt.** If net/sec is deeply negative and cash is low, wait. Otherwise invest aggressively.

## Affordability rule

The state snapshot includes an \`affordability\` object. Each turn the user message ends with **Valid actions this turn:** listing what you are allowed to output. NEVER output an action not in that list — if nothing is affordable except \`wait\`, output \`wait\`.

## Output format

Return ONLY a valid JSON object — no markdown, no explanation outside the JSON:
{
  "action": "buy_material" | "hire_staff" | "fire_staff" | "build_room" | "upgrade_room" | "set_speed" | "wait",
  "params": {
    "material": "concrete"|"wood"|"steel",              (buy_material only)
    "amount": <integer>,                                 (buy_material only)
    "type": "housekeeper"|"builder"|"receptionist",     (hire_staff / fire_staff)
    "f": <floor>, "r": <row>, "c": <col>,               (upgrade_room only)
    "speed": 1|2|4                                       (set_speed only)
  },
  "reasoning": "<one sentence — what income/cost problem does this solve>"
}

Notes:
- build_room: takes no params — builds in the next available empty cell automatically.
- fire_staff: dismisses one staff of the given type, immediately removing their wage. Use when wages exceed income and you cannot recover.
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
                    } else if (cell.type === 'empty') {
                        rooms.push({ f, r, c, status: 'empty' });
                    }
                }
            }
        }

        const upgradeTargets = rooms.filter(
            rm => rm.status === 'ready' && !rm.occupied && (rm.level || 0) < 4
        ).map(({ f, r, c, level }) => ({ f, r, c, level }));

        let totalWages = 0;
        for (const [k, v] of Object.entries(s.staff)) {
            totalWages += v * (C.staff[k]?.wage ?? 0);
        }

        let estRentPerSec = 0;
        for (const rm of rooms) {
            if (rm.occupied && rm.level) {
                estRentPerSec += C.roomLevels[rm.level - 1].rent / 25;
            }
        }

        // Walker breakdown for guest/staff counts
        const walkerCounts = { total: 0, guest: 0, vip: 0, housekeeper: 0, builder: 0, receptionist: 0 };
        for (const w of (s.walkers || [])) {
            walkerCounts.total++;
            walkerCounts[w.type] = (walkerCounts[w.type] || 0) + 1;
        }

        const gs_cash = Math.round(s.cash);
        const materials = s.materials;
        const costs = { buildRoom: C.buildRoomCost, upgradeRoom: C.upgradeRoomCost };
        const dirtyCount = rooms.filter(r => r.status === 'dirty').length;

        let builtCount = 0;
        let emptySlots = 0;
        for (const rm of rooms) {
            if (rm.status === 'empty') emptySlots++;
            else if (rm.status !== 'empty') builtCount++;
        }
        const guestFloors = s.hotel.length - 1;
        const canAddFloor = guestFloors < s.maxFloors;
        const canPlaceRoom = emptySlots > 0 || canAddFloor;
        const btnBuild = document.getElementById('btn-build-room');
        const buildButtonEnabled = !!(btnBuild && !btnBuild.disabled);

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
            financials: {
                wagesPerSec: totalWages,
                estRentPerSec: Math.round(estRentPerSec * 10) / 10,
                netPerSec: Math.round((estRentPerSec - totalWages) * 10) / 10,
            },
            costs,
            buildButtonEnabled,
            affordability: {
                canBuildRoom: buildButtonEnabled &&
                    builtCount < s.maxRooms &&
                    canPlaceRoom &&
                    gs_cash >= costs.buildRoom.cash &&
                    materials.concrete >= costs.buildRoom.concrete &&
                    materials.wood >= costs.buildRoom.wood,
                canUpgradeRoom: upgradeTargets.length > 0 && gs_cash >= costs.upgradeRoom.cash && materials.wood >= costs.upgradeRoom.wood && materials.steel >= costs.upgradeRoom.steel,
                canHireHousekeeper: dirtyCount > 0 &&
                    gs_cash >= C.staff.housekeeper.cost &&
                    s.staff.housekeeper < Math.max(1, Math.ceil(dirtyCount / 3)),
                canHireBuilder: gs_cash >= C.staff.builder.cost,
                canHireReceptionist: gs_cash >= C.staff.receptionist.cost,
                canFireHousekeeper: s.staff.housekeeper > 0,
                canFireBuilder: s.staff.builder > 0,
                canFireReceptionist: s.staff.receptionist > 0,
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
    if (a.canUpgradeRoom) out.push('upgrade_room');
    if (a.canHireHousekeeper) out.push('hire_staff:housekeeper');
    if (a.canHireBuilder) out.push('hire_staff:builder');
    if (a.canHireReceptionist) out.push('hire_staff:receptionist');
    if (a.canFireHousekeeper) out.push('fire_staff:housekeeper');
    if (a.canFireBuilder) out.push('fire_staff:builder');
    if (a.canFireReceptionist) out.push('fire_staff:receptionist');
    return out;
}

/**
 * If the model ignored affordability, coerce to wait so the tick still advances
 * cleanly (logs override instead of spamming blocked_action).
 */
function clampActionToAffordability(action, gs) {
    const af = gs.affordability;
    const orig = action.action;
    const p = action.params || {};

    if (orig === 'build_room' && !af.canBuildRoom) {
        return { action: { action: 'wait', params: {}, reasoning: `${action.reasoning || ''} [clamped: cannot build]`.trim() }, clamped: true, from: orig };
    }
    if (orig === 'upgrade_room' && !af.canUpgradeRoom) {
        return { action: { action: 'wait', params: {}, reasoning: `${action.reasoning || ''} [clamped: cannot upgrade]`.trim() }, clamped: true, from: orig };
    }
    if (orig === 'hire_staff') {
        const t = p.type;
        const ok =
            (t === 'housekeeper' && af.canHireHousekeeper) ||
            (t === 'builder' && af.canHireBuilder) ||
            (t === 'receptionist' && af.canHireReceptionist);
        if (!ok) {
            return { action: { action: 'wait', params: {}, reasoning: `${action.reasoning || ''} [clamped: cannot hire ${t || '?'}]`.trim() }, clamped: true, from: orig };
        }
    }
    if (orig === 'fire_staff') {
        const t = p.type;
        const ok =
            (t === 'housekeeper' && af.canFireHousekeeper) ||
            (t === 'builder' && af.canFireBuilder) ||
            (t === 'receptionist' && af.canFireReceptionist);
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

    // ── Pre-LLM override: fire staff if cash runway < 20s ──
    const wages = gs.financials.wagesPerSec;
    const runway = wages > 0 ? gs.cash / wages : Infinity;
    const hkCap = Math.max(1, Math.ceil(rs.dirty / 3));
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
            `Valid actions this turn (choose exactly one name; for hire_staff/fire_staff use params.type matching the suffix after the colon):\n` +
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
    if (action.action === 'build_room' || action.action === 'upgrade_room') {
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
