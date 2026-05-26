// simulation.js — depends on: constants.js, state.js

// Particle Engine Implementation
const MAX_PARTICLES = 120;
function addParticle(x, y, text, color, vx = 0, vy = -1, size = 10, type = 'text') {
    if (state.particles.length >= MAX_PARTICLES) return;
    state.particles.push({
        x, y, text, color, vx, vy, size, type,
        life: 1.0,
        decay: 0.02 + Math.random() * 0.015
    });
}

function updateParticles() {
    for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.x += p.vx * state.gameSpeed;
        p.y += p.vy * state.gameSpeed;
        p.life -= p.decay * state.gameSpeed;
        if (p.life <= 0) {
            state.particles.splice(i, 1);
        }
    }
}

// Convert 3D projection array to screen pixels
function isoToScreen(col, row, floor, canvasWidth, canvasHeight) {
    const cx = canvasWidth / 2 + state.panX;
    const cy = canvasHeight / 2 + state.panY + 120; // Lower down to fit height

    const x = (col - row) * TILE_WIDTH * state.zoom;
    const y = (col + row) * TILE_HEIGHT * state.zoom;
    const z = floor * FLOOR_HEIGHT * state.zoom;

    return { x: cx + x, y: cy + y - z };
}

/** Pivot used by iso projection and overlook rotation (must match renderer). */
function getIsoViewPivot(canvasWidth, canvasHeight) {
    return {
        x: canvasWidth / 2 + state.panX,
        y: canvasHeight / 2 + state.panY + 120
    };
}

/** Map screen coords back to pre-rotation space (inverse of canvas rotate around pivot). */
function screenToIsoUnrotated(mx, my, canvasWidth, canvasHeight) {
    const yaw = state.isoYaw || 0;
    if (Math.abs(yaw) < 1e-6) return { x: mx, y: my };
    const piv = getIsoViewPivot(canvasWidth, canvasHeight);
    const dx = mx - piv.x;
    const dy = my - piv.y;
    const c = Math.cos(-yaw);
    const s = Math.sin(-yaw);
    return { x: piv.x + dx * c - dy * s, y: piv.y + dx * s + dy * c };
}

/**
 * When stacked floors share a grid column, iso diamonds overlap on screen.
 * Pick the tile whose center is closest to the cursor; on ties prefer the lower floor
 * so mid-levels stay reachable after a third floor is built.
 */
function pickHoveredIsoTile(mx, my, canvasWidth, canvasHeight) {
    const p = screenToIsoUnrotated(mx, my, canvasWidth, canvasHeight);
    const ux = p.x;
    const uy = p.y;
    let best = null;
    for (let f = state.hotel.length - 1; f >= 0; f--) {
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const cell = state.hotel[f][r][c];
                if (cell.type === 'empty') continue;
                if (!isPointInIsometricTile(ux, uy, c, r, f, canvasWidth, canvasHeight)) continue;
                const center = isoToScreen(c, r, f, canvasWidth, canvasHeight);
                const dx = ux - center.x;
                const dy = uy - center.y;
                const d = dx * dx + dy * dy;
                if (!best || d < best.d - 0.25 || (Math.abs(d - best.d) <= 0.25 && f < best.f)) {
                    best = { f, r, c, cell, d };
                }
            }
        }
    }
    return best;
}

// Coordinate helper for precise room detailing
function getIsoLoc(cx, cy, u, v, h_level) {
    const tw = TILE_WIDTH * state.zoom;
    const th = TILE_HEIGHT * state.zoom;
    const d = FLOOR_HEIGHT * state.zoom;

    const rx = (v - u) * tw;
    const ry = (u + v) * th;
    const rz = h_level * d;
    return { x: cx + rx, y: cy + ry - rz };
}

// Check if mouse is hovering room
function isPointInIsometricTile(px, py, col, row, floor, canvasWidth, canvasHeight) {
    const center = isoToScreen(col, row, floor, canvasWidth, canvasHeight);
    const tw = TILE_WIDTH * state.zoom;
    const th = TILE_HEIGHT * state.zoom;

    const dx = Math.abs(px - center.x);
    const dy = Math.abs(py - center.y);

    return (dx / tw + dy / th) <= 1.0;
}

function updateMarketPrices() {
    for (const key in state.marketPrices) {
        const config = CONSTANTS.materials[key];
        const pctChange = (Math.random() * 0.4 - 0.2); // -20% to +20%
        const priceDiff = Math.round(config.basePrice * pctChange);
        let newPrice = state.marketPrices[key] + priceDiff;

        if (newPrice < config.min) newPrice = config.min;
        if (newPrice > config.max) newPrice = config.max;

        state.marketTrends[key] = Math.round(((newPrice - state.marketPrices[key]) / state.marketPrices[key]) * 100);
        state.marketPrices[key] = newPrice;
    }
}

// Find vacant room matching requirement
function getVacantRoom() {
    for (let f = 1; f < state.hotel.length; f++) {
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const room = state.hotel[f][r][c];
                if (room.type === 'guest' && room.status === 'ready' && !room.guestId) {
                    return room;
                }
            }
        }
    }
    return null;
}

// Checkin trigger logic
function triggerGuestBooking() {
    const vacant = getVacantRoom();
    if (!vacant) return;

    // Checkin odds boost from star rating + receptionists (+ rush hour)
    const baseChance = 0.32;
    const recBonus = state.staff.receptionist * 0.2 * getReceptionistBookingMultiplier();
    const ratingBonus = Number(getHotelRating()) * 0.1;
    let finalChance = baseChance + recBonus + ratingBonus;

    let restaurants = 0;
    let parking = 0;
    for (let f = 1; f < state.hotel.length; f++) {
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const cell = state.hotel[f][r][c];
                if (cell.status !== 'ready') continue;
                if (cell.type === 'restaurant') restaurants++;
                if (cell.type === 'parking') parking++;
            }
        }
    }
    finalChance += Math.min(0.14, restaurants * 0.07);
    finalChance += Math.min(0.1, parking * 0.05);

    // Apply Gemini-powered marketing boost
    if (state.campaignActive) {
        finalChance *= 2.0;
    }
    if (state.fun && state.fun.rushHourTicks > 0) {
        finalChance *= 1.6;
    }

    finalChance = Math.min(0.95, finalChance);

    const roll = Math.random();
    if (roll < finalChance) {
        // Amenities attract VIPs: restaurant +8%, parking +5% on top of base 14%
        const amenityVipBonus = (restaurants > 0 ? 0.08 : 0) + (parking > 0 ? 0.05 : 0);
        const wantVip = vacant.level >= 2 && Math.random() < (0.14 + amenityVipBonus);
        const guestId = spawnWalker(wantVip ? 'vip' : 'guest', vacant);
        vacant.guestId = guestId;
        if (wantVip) {
            showToast('VIP inquiry!', 'A high-roller wants your upgraded suite.', 'success');
        }
    }
}
