/**
 * Grand Hotel Blueprint — AI Agent
 *
 * Supports both Anthropic and OpenAI providers. OpenAI gpt-4.1-nano is
 * ~10× cheaper than Claude Haiku for this workload.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node agent.js                        # Claude Haiku (default)
 *   OPENAI_API_KEY=sk-...       node agent.js --model openai          # GPT-4.1 nano (cheapest)
 *   OPENAI_API_KEY=sk-...       node agent.js --model openai-mini     # GPT-4o mini
 *   node agent.js --headless --tick 6000 --turns 30                   # options
 */

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_PATH  = path.resolve(__dirname, '../grand_hotel_blueprint.html');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const HEADLESS  = args.includes('--headless');
const TICK_MS   = parseInt(args[args.indexOf('--tick')  + 1]  || '4000');
const MAX_TURNS = parseInt(args[args.indexOf('--turns') + 1]  || '0');   // 0 = unlimited
const MODEL_ARG = args[args.indexOf('--model') + 1] || 'claude';         // claude | openai | openai-mini

// ─── Provider setup ───────────────────────────────────────────────────────────
let askLLM; // set below

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
            response_format: { type: 'json_object' }, // enforces JSON output
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
You are an expert AI agent playing a hotel tycoon simulation. Your goal is to maximize cash and hotel star rating.

## Game mechanics

**Resources:** cash, concrete, wood, steel.

**Room lifecycle:**
  empty → build ($1500 + 25 concrete + 15 wood) → building (~33s) → ready → occupied (guest pays on checkout) → dirty → housekeeper cleans (~3s) → ready

**Room levels & rent per checkout:**
  Lvl 1 Standard  = $15   (×5 for VIP guests)
  Lvl 2 Deluxe    = $35
  Lvl 3 Executive = $75
  Lvl 4 Penthouse = $180

**Upgrade a room:** costs $800 + 12 wood + 6 steel. Room must be vacant (occupied=false) and status=ready.

**Staff (hire cost + ongoing wage/sec):**
  housekeeper  $500, $4/sec  — auto-cleans dirty rooms in ~3 seconds
  builder      $800, $6/sec  — speeds up room construction
  receptionist $400, $3/sec  — +20% guest check-in rate per hire

**Material base prices:** concrete $20, wood $12, steel $60. Buy below base = good deal.

## Strategy priorities

1. Never let wages exceed income — staff burn cash every second.
2. Build rooms first so guests can arrive.
3. Hire one housekeeper immediately once any room goes dirty — without cleaning, rooms can never rebook.
4. Hire one receptionist to improve check-in rate.
5. Upgrade rooms to higher levels for more rent per checkout.
6. Buy materials only when affordable and below base price.
7. Prefer "wait" over any action that would risk going bankrupt.

## Output format

Return ONLY a valid JSON object — no markdown, no explanation outside the JSON:
{
  "action": "buy_material" | "hire_staff" | "build_room" | "upgrade_room" | "set_speed" | "wait",
  "params": {
    "material": "concrete"|"wood"|"steel",   (buy_material only)
    "amount": <integer>,                      (buy_material only)
    "type": "housekeeper"|"builder"|"receptionist",  (hire_staff only)
    "f": <floor>, "r": <row>, "c": <col>,    (upgrade_room only)
    "speed": 1|2|4                            (set_speed only)
  },
  "reasoning": "<one sentence>"
}`;

// ─── Read game state from the live page ──────────────────────────────────────
async function readState(page) {
    return page.evaluate(() => {
        const s = window.state;
        const C = window.CONSTANTS;
        if (!s?.hotel || !C) return null;

        const rooms = [];
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

        return {
            cash: Math.round(s.cash),
            materials: s.materials,
            marketPrices: s.marketPrices,
            staff: s.staff,
            gameSpeed: s.gameSpeed,
            guestFloors: s.hotel.length - 1,
            maxFloors: s.maxFloors,
            rooms,
            upgradeTargets,
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
async function tick(page, turn) {
    const gs = await readState(page);
    if (!gs) { console.warn('[agent] State unavailable, skipping'); return; }

    const ready = gs.rooms.filter(r => r.status === 'ready' && !r.occupied).length;
    const occ   = gs.rooms.filter(r => r.occupied).length;
    const dirty = gs.rooms.filter(r => r.status === 'dirty').length;
    const build = gs.rooms.filter(r => r.status === 'building').length;

    console.log(
        `[T${String(turn).padStart(3)}] $${gs.cash.toLocaleString().padStart(7)}` +
        ` | net ${String(gs.financials.netPerSec).padStart(5)}/s` +
        ` | ready:${ready} occ:${occ} dirty:${dirty} bldg:${build}` +
        ` | rec:${gs.staff.receptionist} hk:${gs.staff.housekeeper} bld:${gs.staff.builder}`
    );

    const raw = await askLLM(
        SYSTEM_PROMPT,
        `Game state:\n${JSON.stringify(gs, null, 2)}\n\nWhat single action should I take?`
    );

    // Strip any accidental markdown fences
    const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();

    let action;
    try {
        action = JSON.parse(clean);
    } catch {
        console.error('[agent] Bad JSON:', clean);
        return;
    }

    const paramsStr = Object.keys(action.params || {}).length
        ? ' ' + JSON.stringify(action.params)
        : '';
    console.log(`         → ${action.action}${paramsStr}`);
    console.log(`           ${action.reasoning}`);

    await execute(page, action);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('Grand Hotel AI Agent');
    console.log(`  Headless : ${HEADLESS}`);
    console.log(`  Tick     : ${TICK_MS}ms`);
    console.log(`  Max turns: ${MAX_TURNS || '∞'}`);
    console.log('');

    const browser = await chromium.launch({ headless: HEADLESS });
    const page    = await browser.newPage();

    await page.goto(`file://${GAME_PATH}`);
    await page.waitForFunction(
        () => window.state && Array.isArray(window.state.hotel) && window.state.hotel.length > 0,
        { timeout: 15_000 }
    );
    console.log('[agent] Game loaded. Starting in 2s...\n');
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.setGameSpeed(2)); // run at 2× by default

    let turn = 1;
    while (MAX_TURNS === 0 || turn <= MAX_TURNS) {
        try { await tick(page, turn++); }
        catch (err) { console.error('[agent] Tick error:', err.message); }
        await page.waitForTimeout(TICK_MS);
    }

    console.log('\n[agent] Done.');
    await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
