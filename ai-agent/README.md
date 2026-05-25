# Grand Hotel AI Agent

A Claude Haiku-powered agent that plays **Grand Hotel Blueprint** autonomously.

## How it works

```
loop every 4 seconds:
  1. page.evaluate()     → read full state JSON (cash, rooms, staff, materials)
  2. Claude Haiku        → return one action as JSON
  3. page.evaluate()     → execute the action in the live game
```

## Browser bridge: how data gets in and out

Playwright runs the game in real Chromium. **`page.evaluate(fn)`** is the RPC boundary:

1. **Node → browser** — Playwright sends your function into the **page’s JavaScript world** (same realm as the game). There it can read **`window.state`**, **`window.CONSTANTS`**, **`document.getElementById(...)`**, etc.
2. **Browser → Node** — Whatever you **`return`** from that function must be **JSON-serializable** (plain objects, arrays, numbers, strings, booleans, `null`). Playwright copies that value back to Node. Do not return DOM nodes, functions, or circular structures.

**Reading state** — `readState()` in `agent.js` runs one big `page.evaluate(() => { ... })` that walks `state.hotel`, aggregates room/staff/financial summaries, and checks the Build button’s `disabled` flag so `affordability` matches the UI.

**Acting on the game** — `execute()` uses the same mechanism: e.g. `page.evaluate(() => document.getElementById('btn-build-room').click())` or `page.evaluate(({ material, amount }) => window.buyMaterial(material, amount), params)` so mutations happen in the **live** game, not a stub.

**Not used for core state** — The agent does not scrape the canvas or OCR; it reads the same in-memory model the UI uses. (You *could* add screenshots later for a vision-based agent.)

## Setup

```bash
cd ai-agent
npm install
npx playwright install chromium   # one-time browser download
```

## Run

```bash
# Watch it play (browser window opens)
ANTHROPIC_API_KEY=sk-... npm start

# Headless (no window, faster)
ANTHROPIC_API_KEY=sk-... node agent.js --headless

# Slower ticks (easier to watch)
ANTHROPIC_API_KEY=sk-... node agent.js --tick 8000

# Limited run (50 turns then quit)
ANTHROPIC_API_KEY=sk-... node agent.js --turns 50
```

## Actions the agent can take

| Action | Effect |
|--------|--------|
| `buy_material` | Buys concrete / wood / steel at market price |
| `build_room` | Builds the next available empty room |
| `hire_staff` | Hires housekeeper, builder, or receptionist |
| `upgrade_room` | Upgrades a vacant ready room (level 1→4) |
| `set_speed` | Sets game speed (1×, 2×, 4×) |
| `wait` | Does nothing (used when no good action exists) |

## Sample console output

```
[T1]  $10,000 | net -0/s | rooms: 1 ready, 0 occ, 0 dirty, 0 bldg | staff: rec=0 hk=0 bld=0
[T1]  → buy_material {"material":"concrete","amount":25} | Need concrete to build first room
[T2]  $4,500 | net -3/s | rooms: 1 ready, 0 occ, 0 dirty, 0 bldg
[T2]  → build_room {} | Building first room to start earning rent
...
[T12] $3,200 | net 0.2/s | rooms: 0 ready, 1 occ, 1 dirty, 0 bldg
[T12] → hire_staff {"type":"housekeeper"} | Dirty room needs cleaning to rebook
```

## Extending the agent

The agent is intentionally simple — one Claude call per tick, one action per tick.
Ideas to extend it:
- **Multi-action turns**: let Claude return an array of actions
- **Memory**: keep a rolling log of past decisions so Claude learns from outcomes
- **Vision mode**: add `page.screenshot()` and send as base64 to Claude's vision API
- **Scoring**: track cash over time and plot an improvement curve
