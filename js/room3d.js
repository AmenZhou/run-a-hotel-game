// room3d.js — Three.js powered hotel room interior (replaces raycaster)
// Assumes THREE is loaded from CDN before this script.

const Room3DRenderer = (() => {
    let scene, camera, renderer, threeCanvas, uiOverlay;
    let currentRoomKey = null;
    let roomObjects = [];

    // Camera orbit state
    let azimuth = Math.PI;   // default: looking south (toward door)
    let elevation = 0.18;
    let isDragging = false, lastX = 0, lastY = 0;
    const CAM_R = 1.7;
    const RW = 5, RD = 4, RH = 3;

    const api = {
        init() {
            if (typeof THREE === 'undefined') {
                console.warn('[Room3D] THREE not loaded — 3D room view disabled');
                return;
            }

            // ── WebGL canvas overlay ──────────────────────────────────────────
            threeCanvas = document.createElement('canvas');
            threeCanvas.id = 'room3d-canvas';
            Object.assign(threeCanvas.style, {
                position: 'absolute', top: '0', left: '0',
                width: '100%', height: '100%',
                display: 'none', cursor: 'grab', zIndex: '5'
            });
            const parent = document.getElementById('game-canvas').parentElement;
            parent.appendChild(threeCanvas);

            // ── HTML UI overlay (back button + badge) ─────────────────────────
            uiOverlay = document.createElement('div');
            uiOverlay.id = 'room3d-ui';
            Object.assign(uiOverlay.style, {
                position: 'absolute', top: '0', left: '0',
                width: '100%', height: '100%',
                display: 'none', pointerEvents: 'none', zIndex: '6'
            });
            uiOverlay.innerHTML = `
                <button id="room3d-back" style="
                    pointer-events:auto;position:absolute;bottom:20px;left:16px;
                    background:rgba(15,23,42,0.88);border:1px solid rgba(100,116,139,0.4);
                    color:#e2e8f0;font:bold 13px/1 Inter,sans-serif;padding:11px 20px;
                    border-radius:10px;cursor:pointer;backdrop-filter:blur(6px);
                    transition:background 0.15s;">← Back to Corridor</button>
                <div id="room3d-badge" style="
                    position:absolute;top:16px;left:16px;
                    background:rgba(15,23,42,0.78);border:1px solid rgba(100,116,139,0.3);
                    font:bold 13px/1 Inter,sans-serif;padding:9px 15px;
                    border-radius:8px;backdrop-filter:blur(5px);"></div>
                <div style="
                    position:absolute;top:16px;right:16px;
                    background:rgba(15,23,42,0.68);border:1px solid rgba(100,116,139,0.25);
                    color:#64748b;font:10px/1 Inter,sans-serif;padding:7px 12px;
                    border-radius:8px;backdrop-filter:blur(4px);">Drag to rotate</div>`;
            parent.appendChild(uiOverlay);
            document.getElementById('room3d-back').addEventListener('click', () => { state.fpRoom = null; });

            // ── Three.js renderer ─────────────────────────────────────────────
            renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.15;
            if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;

            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x0a0a14);

            camera = new THREE.PerspectiveCamera(72, 1, 0.04, 50);

            this._resize();
            window.addEventListener('resize', () => this._resize());

            // ── Orbit drag ────────────────────────────────────────────────────
            threeCanvas.addEventListener('mousedown', e => {
                isDragging = true; lastX = e.clientX; lastY = e.clientY;
                threeCanvas.style.cursor = 'grabbing';
            });
            window.addEventListener('mouseup', () => {
                isDragging = false;
                if (threeCanvas && threeCanvas.style.display !== 'none') threeCanvas.style.cursor = 'grab';
            });
            window.addEventListener('mousemove', e => {
                if (!isDragging) return;
                azimuth   -= (e.clientX - lastX) * 0.005;
                elevation  = Math.max(-0.35, Math.min(0.55, elevation + (e.clientY - lastY) * 0.004));
                lastX = e.clientX; lastY = e.clientY;
            });

            // Touch
            let tx = 0, ty = 0;
            threeCanvas.addEventListener('touchstart', e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
            threeCanvas.addEventListener('touchmove', e => {
                e.preventDefault();
                azimuth   -= (e.touches[0].clientX - tx) * 0.005;
                elevation  = Math.max(-0.35, Math.min(0.55, elevation + (e.touches[0].clientY - ty) * 0.004));
                tx = e.touches[0].clientX; ty = e.touches[0].clientY;
            }, { passive: false });
        },

        _resize() {
            if (!renderer) return;
            const p = threeCanvas.parentElement;
            if (!p) return;
            const W = p.clientWidth, H = p.clientHeight;
            renderer.setSize(W, H);
            camera.aspect = W / H;
            camera.updateProjectionMatrix();
        },

        ensureShowing(cell, f, r, c) {
            if (!renderer) return;
            const key = `${f}-${r}-${c}-${cell.level}-${cell.status}-${!!cell.guestId}`;
            threeCanvas.style.display = 'block';
            uiOverlay.style.display = 'block';
            if (key !== currentRoomKey) { currentRoomKey = key; this._buildRoom(cell, f, r, c); }
        },

        hide() {
            if (!threeCanvas) return;
            threeCanvas.style.display = 'none';
            if (uiOverlay) uiOverlay.style.display = 'none';
            currentRoomKey = null;
        },

        renderFrame() {
            if (!renderer || !threeCanvas || threeCanvas.style.display === 'none') return;
            const cosEl = Math.cos(elevation);
            camera.position.set(
                CAM_R * Math.sin(azimuth) * cosEl,
                RH * 0.44 + CAM_R * Math.sin(elevation),
                CAM_R * Math.cos(azimuth) * cosEl
            );
            camera.lookAt(0, RH * 0.42, 0);
            renderer.render(scene, camera);
        },

        // ── Room builder ──────────────────────────────────────────────────────
        _clear() {
            for (const obj of roomObjects) {
                scene.remove(obj);
                obj.traverse(ch => {
                    ch.geometry?.dispose();
                    if (ch.material) {
                        (Array.isArray(ch.material) ? ch.material : [ch.material]).forEach(m => m.dispose());
                    }
                });
            }
            roomObjects = [];
        },

        _add(obj) { scene.add(obj); roomObjects.push(obj); return obj; },

        _mat(color, rough = 0.8, metal = 0.0, extra = {}) {
            return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
        },

        _box(w, h, d, col, x, y, z, rough = 0.8, metal = 0.0) {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this._mat(col, rough, metal));
            m.position.set(x, y, z);
            m.castShadow = true; m.receiveShadow = true;
            return this._add(m);
        },

        _buildRoom(cell, f, r, c) {
            this._clear();

            const W = RW, D = RD, H = RH, hw = W / 2, hd = D / 2;
            const lvl = Math.max(1, Math.min(cell.level || 1, 4));

            const PAL = [
                { wall: 0xe8dfd0, floor: 0x7c5a3e, ceil: 0xf5efeb, bed: 0x2563eb, accent: 0xd97706, name: 'Standard Room' },
                { wall: 0xc5e4d3, floor: 0x1f5c42, ceil: 0xe6f4ee, bed: 0x059669, accent: 0x10b981, name: 'Deluxe Suite' },
                { wall: 0xd8d3f0, floor: 0x1e1b4b, ceil: 0xeeeaf8, bed: 0xd97706, accent: 0x7c3aed, name: 'Executive Suite' },
                { wall: 0xf0dff5, floor: 0x2d0d3b, ceil: 0xfaf5ff, bed: 0xa855f7, accent: 0xec4899, name: 'Penthouse Suite' },
            ];
            const pal = PAL[lvl - 1];
            const bedCol = cell.status === 'dirty' ? 0x64748b : pal.bed;

            // Update badge
            const badge = document.getElementById('room3d-badge');
            if (badge) {
                badge.textContent = '★'.repeat(lvl) + ' ' + pal.name + ' · Floor ' + f;
                badge.style.color = '#' + pal.accent.toString(16).padStart(6, '0');
            }

            const add = o => this._add(o);
            const box = (w, h, d, col, x, y, z, rg = 0.8, mt = 0.0) => this._box(w, h, d, col, x, y, z, rg, mt);
            const mat = (col, rg = 0.8, mt = 0.0, ex = {}) => this._mat(col, rg, mt, ex);
            const mesh = (geo, mat2) => { const m = new THREE.Mesh(geo, mat2); m.castShadow = true; m.receiveShadow = true; return add(m); };

            // ── Floor ─────────────────────────────────────────────────────────
            const floorMesh = mesh(new THREE.PlaneGeometry(W, D), mat(pal.floor, 0.92));
            floorMesh.rotation.x = -Math.PI / 2;
            // Wood plank lines (levels 1-2 only)
            if (lvl <= 2) {
                for (let i = -hw + 0.25; i < hw; i += 0.5) {
                    const plank = mesh(new THREE.PlaneGeometry(0.48, D), mat(i % 1 === 0 ? pal.floor : pal.floor - 0x060606, 0.93));
                    plank.rotation.x = -Math.PI / 2;
                    plank.position.set(i, 0.001, 0);
                }
            }

            // ── Ceiling ───────────────────────────────────────────────────────
            const ceilMesh = mesh(new THREE.PlaneGeometry(W, D), mat(pal.ceil, 0.88));
            ceilMesh.rotation.x = Math.PI / 2;
            ceilMesh.position.y = H;

            // ── Walls ─────────────────────────────────────────────────────────
            const wallMat = mat(pal.wall, 0.87);
            const wallN = mesh(new THREE.PlaneGeometry(W, H), wallMat); wallN.position.set(0, H / 2, -hd);
            const wallE = mesh(new THREE.PlaneGeometry(D, H), wallMat.clone()); wallE.rotation.y = -Math.PI / 2; wallE.position.set(hw, H / 2, 0);
            const wallW = mesh(new THREE.PlaneGeometry(D, H), wallMat.clone()); wallW.rotation.y = Math.PI / 2; wallW.position.set(-hw, H / 2, 0);
            // South wall split around door opening (1.1m wide door)
            const dw = 1.1, dh = 2.2;
            const sideW = (W - dw) / 2;
            const wallSL = mesh(new THREE.PlaneGeometry(sideW, H), wallMat.clone());
            wallSL.rotation.y = Math.PI; wallSL.position.set(-(sideW / 2 + dw / 2), H / 2, hd);
            const wallSR = mesh(new THREE.PlaneGeometry(sideW, H), wallMat.clone());
            wallSR.rotation.y = Math.PI; wallSR.position.set(sideW / 2 + dw / 2, H / 2, hd);
            const wallSTop = mesh(new THREE.PlaneGeometry(dw, H - dh), wallMat.clone());
            wallSTop.rotation.y = Math.PI; wallSTop.position.set(0, dh + (H - dh) / 2, hd);

            // ── Trim ──────────────────────────────────────────────────────────
            const whiteMat = mat(0xfafafa, 0.5);
            const trimMat = mat(0x5c3d1e, 0.62, 0.08);
            const wainMat = mat(pal.accent, 0.68, 0.1);
            const BH = 0.12, BD = 0.05, CH = 0.10, CD = 0.07;
            // Baseboard & crown — north/south walls
            [[-hd, 1], [hd, -1]].forEach(([z, sign]) => {
                box(W, BH, BD, 0xfafafa, 0, BH / 2, z + sign * BD / 2, 0.5);
                box(W, CH, CD, 0xfafafa, 0, H - CH / 2, z + sign * CD / 2, 0.5);
                box(W, 0.03, BD, pal.accent, 0, 0.88, z + sign * BD / 2, 0.65, 0.1);
            });
            // East/West walls
            [[-hw, 1], [hw, -1]].forEach(([x, sign]) => {
                box(BD, BH, D, 0xfafafa, x + sign * BD / 2, BH / 2, 0, 0.5);
                box(CD, CH, D, 0xfafafa, x + sign * CD / 2, H - CH / 2, 0, 0.5);
                box(BD, 0.03, D, pal.accent, x + sign * BD / 2, 0.88, 0, 0.65, 0.1);
            });

            // ── Window (North wall) ───────────────────────────────────────────
            const wW = 2.4, wHh = 1.45, wY = 1.9;
            const glassMesh = mesh(new THREE.PlaneGeometry(wW, wHh), mat(0x8ec8f0, 0.05, 0.12, { transparent: true, opacity: 0.32 }));
            glassMesh.position.set(0, wY, -hd + 0.01);
            // Frame bars
            const fm = mat(0x3d2a14, 0.62, 0.06);
            [[wW + 0.1, 0.065, 0.08, 0, wY + wHh / 2 + 0.032, -hd + 0.04],
             [wW + 0.1, 0.065, 0.08, 0, wY - wHh / 2 - 0.032, -hd + 0.04],
             [0.065, wHh + 0.07, 0.08, -wW / 2 - 0.032, wY, -hd + 0.04],
             [0.065, wHh + 0.07, 0.08,  wW / 2 + 0.032, wY, -hd + 0.04],
             [0.052, wHh, 0.052, 0, wY, -hd + 0.042],
             [wW, 0.052, 0.052, 0, wY + 0.08, -hd + 0.042],
            ].forEach(([w, h, d, x, y, z]) => { box(w, h, d, 0x3d2a14, x, y, z, 0.62, 0.06); });
            // Sill
            box(wW + 0.22, 0.06, 0.18, 0x6b4226, 0, wY - wHh / 2 - 0.03, -hd + 0.09, 0.72);
            // Curtains
            const curtainMat = mat(pal.accent, 0.96, 0.0, { transparent: true, opacity: 0.78, side: THREE.DoubleSide });
            [-wW / 2 - 0.22, wW / 2 + 0.22].forEach(cx => {
                const c = mesh(new THREE.PlaneGeometry(0.6, H * 0.88), curtainMat);
                c.position.set(cx, H * 0.44, -hd + 0.07);
            });
            // Curtain rod
            const rod = mesh(new THREE.CylinderGeometry(0.015, 0.015, wW + 0.6, 8), mat(0xd4af37, 0.2, 0.8));
            rod.rotation.z = Math.PI / 2; rod.position.set(0, H * 0.88, -hd + 0.07);

            // ── Door (South wall) ─────────────────────────────────────────────
            const doorMesh = mesh(new THREE.BoxGeometry(dw, dh, 0.06), mat(0x5c3d1e, 0.76));
            doorMesh.position.set(0, dh / 2, hd - 0.03);
            // Door frame
            const dfm = mat(0x3d2710, 0.62, 0.1);
            [[dw + 0.14, 0.08, 0.1, 0, dh + 0.04, hd - 0.05],
             [0.08, dh + 0.1, 0.1, -dw / 2 - 0.04, dh / 2, hd - 0.05],
             [0.08, dh + 0.1, 0.1,  dw / 2 + 0.04, dh / 2, hd - 0.05],
            ].forEach(([w, h, d, x, y, z]) => { const b = mesh(new THREE.BoxGeometry(w, h, d), dfm); b.position.set(x, y, z); });
            // Door inset panels
            [[dw * 0.84, dh * 0.38, 0.02, 0, dh * 0.77, hd - 0.065],
             [dw * 0.84, dh * 0.38, 0.02, 0, dh * 0.33, hd - 0.065],
            ].forEach(([w, h, d, x, y, z]) => { const b = mesh(new THREE.BoxGeometry(w, h, d), mat(0x4a2f14, 0.82)); b.position.set(x, y, z); });
            // Knob
            const knobMat = mat(0xca8a04, 0.12, 0.92);
            const knob = mesh(new THREE.SphereGeometry(0.046, 14, 14), knobMat);
            knob.position.set(0.38, 1.12, hd - 0.09);
            const kplate = mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.022, 12), knobMat.clone());
            kplate.rotation.x = Math.PI / 2; kplate.position.set(0.38, 1.12, hd - 0.056);
            // Light slit under door when occupied
            if (cell.guestId) {
                const slit = mesh(new THREE.PlaneGeometry(dw * 0.88, 0.038),
                    mat(0xfef3c7, 0.0, 0.0, { emissive: 0xfef3c7, emissiveIntensity: 0.65, transparent: true, opacity: 0.55 }));
                slit.rotation.x = -Math.PI / 2; slit.position.set(0, 0.002, hd - 0.018);
            }

            // ── Bed ───────────────────────────────────────────────────────────
            const bX = -hw + 1.05, bZ = 0.15;
            box(1.62, 0.28, 2.35, 0x5c2a0a, bX, 0.14, bZ, 0.82);        // frame
            box(1.5,  0.23, 2.15, bedCol,   bX, 0.40, bZ, 0.92);         // mattress
            box(0.55, 0.10, 0.52, cell.status === 'dirty' ? 0x94a3b8 : 0xfafafa, bX - 0.3, 0.57, bZ - 0.74, 0.95); // pillow L
            box(0.55, 0.10, 0.52, cell.status === 'dirty' ? 0x94a3b8 : 0xfafafa, bX + 0.3, 0.57, bZ - 0.74, 0.95); // pillow R
            // Headboard
            const hbMesh = mesh(new THREE.BoxGeometry(1.62, 1.05, 0.13), mat(0x3d1a08, 0.76, 0.06));
            hbMesh.position.set(bX, 0.78, bZ - 1.20);
            const hbPad = mesh(new THREE.BoxGeometry(1.44, 0.82, 0.06), mat(bedCol, 0.94, 0.0, { transparent: true, opacity: 0.88 }));
            hbPad.position.set(bX, 0.78, bZ - 1.14);
            box(1.62, 0.35, 0.13, 0x3d1a08, bX, 0.175, bZ + 1.20, 0.76); // footboard
            // Legs
            [[-0.72, -1.08], [0.72, -1.08], [-0.72, 1.08], [0.72, 1.08]].forEach(([dx, dz]) =>
                box(0.08, 0.28, 0.08, 0x2a1006, bX + dx, 0.14, bZ + dz, 0.7, 0.12)
            );

            // ── Canopy (Level 4) ──────────────────────────────────────────────
            if (lvl >= 4) {
                const postMat2 = mat(0xca8a04, 0.18, 0.75);
                [[-0.72, -1.08], [0.72, -1.08], [-0.72, 1.08], [0.72, 1.08]].forEach(([dx, dz]) => {
                    const p = mesh(new THREE.CylinderGeometry(0.036, 0.036, 2.45, 10), postMat2);
                    p.position.set(bX + dx, 1.52, bZ + dz);
                });
                [[1.44, 0.04, 0.04, bX, 2.76, bZ - 1.08],
                 [1.44, 0.04, 0.04, bX, 2.76, bZ + 1.08],
                 [0.04, 0.04, 2.16, bX - 0.72, 2.76, bZ],
                 [0.04, 0.04, 2.16, bX + 0.72, 2.76, bZ],
                ].forEach(([w, h, d, x, y, z]) => { const b = mesh(new THREE.BoxGeometry(w, h, d), postMat2); b.position.set(x, y, z); });
                const dm = mat(bedCol, 0.96, 0.0, { transparent: true, opacity: 0.28, side: THREE.DoubleSide });
                [{ r: [0, 0, 0], p: [bX, 1.9, bZ - 1.08] },
                 { r: [0, 0, 0], p: [bX, 1.9, bZ + 1.08] },
                 { r: [0, Math.PI / 2, 0], p: [bX - 0.72, 1.9, bZ] },
                 { r: [0, Math.PI / 2, 0], p: [bX + 0.72, 1.9, bZ] },
                ].forEach(({ r, p }) => {
                    const drape = mesh(new THREE.PlaneGeometry(1.44, 1.68), dm);
                    drape.rotation.set(...r); drape.position.set(...p);
                });
            }

            // ── Nightstand + Lamp (Level 2+) ──────────────────────────────────
            if (lvl >= 2) {
                const nsX = bX, nsZ = bZ + 1.52;
                box(0.52, 0.56, 0.52, 0x78350f, nsX, 0.28, nsZ, 0.82);
                // Lamp base
                const lb = mesh(new THREE.CylinderGeometry(0.038, 0.072, 0.34, 10), mat(0xd97706, 0.28, 0.65));
                lb.position.set(nsX, 0.73, nsZ);
                // Shade
                const ls = mesh(new THREE.ConeGeometry(0.17, 0.22, 12, 1, true),
                    mat(0xfef3c7, 0.92, 0.0, { transparent: true, opacity: 0.86, side: THREE.DoubleSide }));
                ls.rotation.x = Math.PI; ls.position.set(nsX, 1.00, nsZ);
                // Emissive bulb
                const lb2 = mesh(new THREE.SphereGeometry(0.026, 8, 8),
                    mat(0xfefce8, 0.0, 0.0, { emissive: 0xfefce8, emissiveIntensity: 3.2 }));
                lb2.position.set(nsX, 0.89, nsZ);
                const ll = new THREE.PointLight(0xfef9c3, 0.9, 2.6, 1.6);
                ll.position.set(nsX, 0.92, nsZ); add(ll);
            }

            // ── Desk + Chair (Level 3+) ───────────────────────────────────────
            if (lvl >= 3) {
                const dkX = hw - 0.65, dkZ = -hd + 0.92;
                const dkSurf = mesh(new THREE.BoxGeometry(1.14, 0.06, 0.72), mat(0x1e293b, 0.52, 0.22));
                dkSurf.position.set(dkX, 0.80, dkZ);
                [[-0.50, -0.32], [0.50, -0.32], [-0.50, 0.32], [0.50, 0.32]].forEach(([dx, dz]) =>
                    box(0.05, 0.78, 0.05, 0x0f172a, dkX + dx, 0.39, dkZ + dz, 0.28, 0.32)
                );
                // Monitor
                const mon = mesh(new THREE.BoxGeometry(0.78, 0.46, 0.045), mat(0x111827, 0.38, 0.42));
                mon.position.set(dkX, 1.23, dkZ - 0.31);
                box(0.08, 0.21, 0.08, 0x1f2937, dkX, 0.90, dkZ - 0.31, 0.28, 0.52); // stand
                const screen = mesh(new THREE.PlaneGeometry(0.70, 0.38),
                    mat(0x38bdf8, 0.08, 0.0, { emissive: 0x0284c7, emissiveIntensity: 0.65 }));
                screen.position.set(dkX, 1.23, dkZ - 0.29);
                // Chair
                box(0.60, 0.065, 0.58, 0x312e81, dkX, 0.535, dkZ + 0.55, 0.82);
                const cb = mesh(new THREE.BoxGeometry(0.60, 0.62, 0.065), mat(0x312e81, 0.82));
                cb.position.set(dkX, 0.88, dkZ + 0.26);
                [[-0.26, -0.25], [0.26, -0.25], [-0.26, 0.79], [0.26, 0.79]].forEach(([dx, dz]) =>
                    box(0.04, 0.52, 0.04, 0x1e1b4b, dkX + dx, 0.26, dkZ + dz, 0.3, 0.4)
                );
            }

            // ── Rug (Level 2+) ────────────────────────────────────────────────
            if (lvl >= 2) {
                const rugCols = [null, 0x1e3a8a, 0x312e81, 0x4c1d95];
                const rug = mesh(new THREE.PlaneGeometry(3.0, 2.2), mat(rugCols[lvl - 1] || 0x1e3a8a, 1.0));
                rug.rotation.x = -Math.PI / 2; rug.position.set(hw - 1.3, 0.003, 0.6);
            }

            // ── TV on east wall ───────────────────────────────────────────────
            {
                const tvX = hw - 0.055, tvY = 1.48, tvZ = 0.6;
                box(0.055, 0.68, 1.15, 0x111827, tvX, tvY, tvZ, 0.3, 0.5);
                const tvScr = mesh(new THREE.PlaneGeometry(1.02, 0.58),
                    mat(0x0a0a18, 0.08, 0.12, {
                        emissive: cell.guestId ? 0x1a3a5c : 0x020202,
                        emissiveIntensity: cell.guestId ? 0.45 : 0.04
                    }));
                tvScr.rotation.y = -Math.PI / 2; tvScr.position.set(tvX - 0.04, tvY, tvZ);
                // Mount arm
                box(0.04, 0.09, 0.28, 0x374151, tvX - 0.04, tvY, tvZ, 0.2, 0.6);
            }

            // ── Wall art (Level 3+) ───────────────────────────────────────────
            if (lvl >= 3) {
                const artX = hw - 0.5, artY = 1.78, artZ = -hd + 0.016;
                const paintMat = mat(pal.accent, 0.72, 0.0, { emissive: pal.accent, emissiveIntensity: 0.14 });
                const painting = mesh(new THREE.BoxGeometry(0.80, 0.58, 0.032), paintMat);
                painting.position.set(artX, artY, artZ);
                // Gold frame
                const gm = mat(0xca8a04, 0.18, 0.72);
                [[0.88, 0.042, 0.02, 0,  0.32, artZ],
                 [0.88, 0.042, 0.02, 0, -0.32, artZ],
                 [0.042, 0.66, 0.02, -0.44, 0, artZ],
                 [0.042, 0.66, 0.02,  0.44, 0, artZ],
                ].forEach(([w, h, d, dx, dy, z]) => {
                    const fr = mesh(new THREE.BoxGeometry(w, h, d), gm);
                    fr.position.set(artX + dx, artY + dy, z);
                });
                const pl = new THREE.PointLight(0xffe4a0, 0.55, 2.0, 2.2);
                pl.position.set(artX, artY + 0.45, artZ + 0.35); add(pl);
            }

            // ── Mini-bar (Level 2+) ───────────────────────────────────────────
            if (lvl >= 2) {
                box(0.56, 0.84, 0.46, 0x1e293b, hw - 0.34, 0.42, hd - 0.33, 0.5, 0.18);
                if (lvl >= 3) {
                    [-0.09, 0.06].forEach(dx => {
                        const bot = mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.24, 8), mat(0x15803d, 0.28, 0.32));
                        bot.position.set(hw - 0.34 + dx, 0.97, hd - 0.33);
                    });
                }
            }

            // ── Luggage rack ──────────────────────────────────────────────────
            if (lvl >= 2 || cell.guestId) {
                const rX = hw - 0.44, rZ = hd - 0.65;
                [[-0.3, -0.16], [0.3, -0.16], [-0.3, 0.16], [0.3, 0.16]].forEach(([dx, dz]) =>
                    box(0.04, 0.52, 0.04, 0x92400e, rX + dx, 0.26, rZ + dz, 0.72, 0.1)
                );
                [0.1, 0.22, 0.34].forEach(y => box(0.64, 0.022, 0.35, 0x78350f, rX, y, rZ, 0.72, 0.1));
                if (cell.guestId) {
                    box(0.58, 0.33, 0.23, 0x1e3a8a, rX, 0.52, rZ, 0.72);
                    box(0.53, 0.29, 0.19, 0x1e40af, rX, 0.52, rZ, 0.82);
                }
            }

            // ── Ceiling fixture ───────────────────────────────────────────────
            const fix = mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.065, 16), mat(0xc8c8d0, 0.28, 0.62));
            fix.position.set(0, H - 0.032, 0);
            const cord = mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.22, 6), mat(0x1e293b, 0.85));
            cord.position.set(0, H - 0.22, 0);
            const bulb = mesh(new THREE.SphereGeometry(0.088, 12, 12),
                mat(0xfef9c3, 0.0, 0.0, { emissive: 0xfef9c3, emissiveIntensity: 2.6 }));
            bulb.position.set(0, H - 0.1, 0);

            // ── Lighting ──────────────────────────────────────────────────────
            const ambient2 = new THREE.AmbientLight(0xfff8e1, 0.48); add(ambient2);
            const mainLight = new THREE.PointLight(0xfff8e1, 3.2, 14, 1.9);
            mainLight.position.set(0, H - 0.14, 0);
            mainLight.castShadow = true;
            mainLight.shadow.mapSize.width = 1024;
            mainLight.shadow.mapSize.height = 1024;
            mainLight.shadow.radius = 5;
            add(mainLight);
            const winFill = new THREE.DirectionalLight(0xb8d4ff, 0.58);
            winFill.position.set(0, H * 0.55, -8);
            winFill.target.position.set(0, 1.0, 0);
            add(winFill); add(winFill.target);
            const hemi = new THREE.HemisphereLight(0xfff8e1, 0x4a2a18, 0.28); add(hemi);

            // ── Reset camera toward door ───────────────────────────────────────
            azimuth = Math.PI; elevation = 0.18;
        }
    };

    return api;
})();
