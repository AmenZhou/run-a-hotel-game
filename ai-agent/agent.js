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

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const HEADLESS  = args.includes('--headless');
const TICK_MS   = parseInt(args[args.indexOf('--tick')  + 1]  || '4000');
const MAX_TURNS = parseInt(args[args.indexOf('--turns') + 1]  || '0');   // 0 = unlimited
const MODEL_ARG = args[args.indexOf('--model') + 1] || 'claude';         // claude | openai | openai-mini

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
  housekeeper  $500, $4/sec  — auto-cleans dirty rooms; without one dirty rooms never rebook
  builder      $800, $6/sec  — speeds up room construction
  receptionist $400, $3/sec  — +20% guest check-in rate per hire

**Material base prices:** concrete $20, wood $12, steel $60. Buy when below base = good deal.

## Money-maximization priorities

1. **Dirty rooms are lost income.** Hire a housekeeper the moment any room goes dirty. A dirty room that can't rebook costs you more than the wage.
2. **Room upgrades are the best ROI.** Lvl 4 earns 12× more than Lvl 1. Upgrade every room as soon as you can afford it.
3. **Build rooms to fill capacity.** More rooms = more simultaneous guests = more income.
4. **Receptionist multiplies income.** Each one boosts check-in rate 20% — hire early.
5. **Builder shortens dead time.** Rooms earn nothing while building — a builder pays back fast.
6. **Buy materials when cheap.** Concrete/wood/steel below base price = buy in bulk.
7. **Set speed to 4×** as soon as the hotel is stable — idle time is lost money.
8. **Never go bankrupt.** If net/sec is deeply negative and cash is low, wait. Otherwise invest aggressively.

## Output format

Return ONLY a valid JSON object — no markdown, no explanation outside the JSON:
{
  "action": "buy_material" | "hire_staff" | "build_room" | "upgrade_room" | "set_speed" | "wait",
  "params": {
    "material": "concrete"|"wood"|"steel",              (buy_material only)
    "amount": <integer>,                                 (buy_material only)
    "type": "housekeeper"|"builder"|"receptionist",     (hire_staff only)
    "f": <floor>, "r": <row>, "c": <col>,               (upgrade_room only)
    "speed": 1|2|4                                       (set_speed only)
  },
  "reasoning": "<one sentence — what income/cost problem does this solve>"
}`;

// ─── Read game state from the live page ──────────────────────────────────────
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

        return {
            cash: Math.round(s.cash),
            materials: s.materials,
            marketPrices: s.marketPrices,
            marketTrends: s.marketTrends,
            staff: s.staff,
            gameSpeed: s.gameSpeed,
            guestFloors: s.hotel.length - 1,
            maxRooms: s.maxRooms,
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
            costs: {
                buildRoom: C.buildRoomCost,
                upgradeRoom: C.upgradeRoomCost,
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

// ─── One agent tick ───────────────────────────────────────────────────────────
async function tick(page, turn, logger, session) {
    const gs = await readState(page);
    if (!gs) { console.warn('[agent] State unavailable, skipping'); return; }

    const cashDelta = session.lastCash !== null ? gs.cash - session.lastCash : 0;
    session.lastCash = gs.cash;
    if (gs.cash > session.peakCash) session.peakCash = gs.cash;
    if (cashDelta > 0) session.totalEarned += cashDelta;
    if (cashDelta < 0) session.totalSpent  += Math.abs(cashDelta);

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

    // ── Ask LLM ──
    const raw = await askLLM(
        SYSTEM_PROMPT,
        `Game state:\n${JSON.stringify(gs, null, 2)}\n\nWhat single action maximizes my cash? Reply with one JSON action.`
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

    await execute(page, action);

    // Track rooms built / upgraded from action type
    if (action.action === 'build_room')   session.roomsBuilt++;
    if (action.action === 'upgrade_room') session.roomsUpgraded++;
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

    await page.goto(`file://${GAME_PATH}`);
    await page.waitForFunction(
        () => window.state && Array.isArray(window.state.hotel) && window.state.hotel.length > 0,
        { timeout: 15_000 }
    );
    console.log('[agent] Game loaded. Starting in 2s...\n');
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.setGameSpeed(2));

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
