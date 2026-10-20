/**
 * MARKET POLARIS — 3D Financial Data Universe & Cinematic Intro
 * 
 * 0.0–0.6s:  Genesis — Multi-depth financial cosmos awakens (#020508)
 * 0.6–3.4s:  Deep High-Speed Star Travel — Fast, immersive flight through vast 3D starfield tunnel
 * 2.4–3.4s:  Smooth Progressive Deceleration — Flight eases seamlessly into focal station
 * 2.8–4.2s:  Authoritative Brand Solidification — 100% clean, razor-sharp vector M/P & rising blue arrow (ZERO dotted lines)
 * 4.2–4.7s:  Tactile Micro-Settle & ambient backlight bloom
 * 4.4–5.4s:  MARKET POLARIS wordmark reveal with typography tracking
 * 5.2–6.4s:  High-frequency data pulse races through the blue market arrow
 * 6.4s+:     Living interactive universe with fluid spring mouse parallax
 */

import * as THREE from 'three';

// ═══════════════════════════════════════════════════════════
// EXACT AUTHORITATIVE BRAND GEOMETRY (Normalized coordinates)
// Subpixel precision extracted from official_logo.png
// ═══════════════════════════════════════════════════════════

const WHITE_POLYS = [
  // 0: Middle M stroke + Outer P loop
  [
    [0.33179, -0.14787], [0.3817, -0.14603], [0.40388, -0.13863], [0.43161, -0.12384],
    [0.47043, -0.08503], [0.48336, -0.06285], [0.49261, -0.03882], [0.5, 0.00185],
    [0.5, 0.02218], [0.49076, 0.06839], [0.47597, 0.09982], [0.46303, 0.1183],
    [0.4464, 0.13678], [0.42052, 0.15712], [0.39094, 0.1719], [0.36322, 0.1793],
    [0.27819, 0.18115], [0.27819, 0.14787], [0.35028, 0.14787], [0.36876, 0.14418],
    [0.39834, 0.13124], [0.41497, 0.12015], [0.43715, 0.09797], [0.45194, 0.07579],
    [0.46118, 0.0536], [0.46673, 0.02957], [0.46673, -0.00555], [0.45933, -0.03512],
    [0.4427, -0.06654], [0.42237, -0.08872], [0.40388, -0.10166], [0.37616, -0.11275],
    [0.33549, -0.1146], [0.3207, -0.11091], [0.30037, -0.09982], [0.26525, -0.0647],
    [0.01941, 0.19224], [-0.10628, 0.07024], [-0.36691, 0.36784], [-0.41128, 0.36784],
    [-0.10813, 0.02033], [0.01941, 0.14418], [0.27449, -0.122], [0.30407, -0.14048],
    [0.33179, -0.14787]
  ],
  // 1: Inner M stroke + Inner P loop
  [
    [0.34104, -0.08503], [0.36876, -0.08318], [0.40203, -0.06654], [0.42421, -0.04067],
    [0.4353, -0.01294], [0.43715, 0.02588], [0.42976, 0.0536], [0.41867, 0.07394],
    [0.39279, 0.09982], [0.37616, 0.10906], [0.35213, 0.11645], [0.27819, 0.11645],
    [0.27819, 0.08318], [0.34843, 0.08318], [0.35952, 0.07948], [0.37431, 0.07209],
    [0.39094, 0.05545], [0.40018, 0.03882], [0.40388, 0.02588], [0.40388, -0.00185],
    [0.39464, -0.02588], [0.3854, -0.03697], [0.36876, -0.04806], [0.35028, -0.05176],
    [0.33364, -0.04806], [0.28189, 0.00185], [0.01941, 0.27911], [-0.09889, 0.16266],
    [-0.27819, 0.36784], [-0.3244, 0.36784], [-0.10259, 0.11275], [0.01941, 0.23105],
    [0.30776, -0.07209], [0.3207, -0.07948], [0.34104, -0.08503]
  ],
  // 2: Outer-left M stroke
  [
    [-0.11553, -0.07394], [0.00462, 0.04436], [-0.00462, 0.05545], [-0.01756, 0.06839],
    [-0.10998, -0.02403], [-0.44455, 0.36044], [-0.45194, 0.36784], [-0.5, 0.36784],
    [-0.11553, -0.07394]
  ],
  // 3: Outer vertical stem
  [
    [0.25416, 0.08688], [0.25601, 0.36599], [0.22274, 0.36784], [0.22274, 0.122],
    [0.25416, 0.08688]
  ],
  // 4: Inner vertical stem
  [
    [0.19316, 0.15157], [0.19316, 0.36784], [0.15989, 0.36784], [0.15989, 0.18669],
    [0.19316, 0.15157]
  ]
];

// Blue checkmark & rising market arrow with arrowhead
const BLUE_POLY = [
  [0.38725, -0.36414], [0.39279, -0.36414], [0.39279, -0.36044], [0.36137, -0.20702],
  [0.35767, -0.20702], [0.33734, -0.22736], [0.33364, -0.22736], [0.01756, 0.10351],
  [-0.00462, 0.07948], [0.31146, -0.25139], [0.29852, -0.26433], [0.29298, -0.26433],
  [0.01756, 0.02403], [-0.09889, -0.08872], [-0.09889, -0.09427], [-0.08041, -0.1146],
  [-0.07671, -0.1146], [0.01571, -0.02218], [0.26895, -0.28651], [0.24307, -0.31423],
  [0.38725, -0.36414]
];

// Blue path centerline for Phase 5 data pulse
const BLUE_PULSE_PATH = [
  [-0.088, -0.104],
  [ 0.017,  0.064],
  [ 0.160, -0.085],
  [ 0.280, -0.210],
  [ 0.387, -0.364]
];

// ═══════════════════════════════════════════════════════════
// TIMING CHOREOGRAPHY (ms) — Fast, Deep Travel & Fluid Reveal
// ═══════════════════════════════════════════════════════════

const T = {
  // Phase 1: Deep Universe Awakening
  genesisStart: 0,
  genesisEnd: 600,

  // Phase 2: Deep High-Speed Star Travel
  travelStart: 600,
  travelCruise: 1400,
  decelStart: 2300,
  travelEnd: 3300,

  // Phase 3: Authoritative Brand Solidification (Clean, razor-sharp vector shapes)
  vectorMStart: 2700,
  vectorMEnd: 3400,
  vectorPStart: 3100,
  vectorPEnd: 3700,
  vectorStemsStart: 3300,
  vectorStemsEnd: 3800,
  vectorBlueStart: 3400,
  vectorBlueEnd: 4100,
  arrowSnap: 4100,

  // Phase 4: Tactile Micro-Settle & Wordmark Reveal
  settleStart: 4150,
  settleEnd: 4600,
  wordStart: 4300,
  wordEnd: 5300,

  // Phase 5: High-Frequency Blue Arrow Pulse
  pulseStart: 5100,
  pulseEnd: 6300,

  // Living Interactive Ambient Cosmos
  introComplete: 6400
};

// Math helpers
function clamp01(t) { return Math.max(0, Math.min(1, t)); }
function easeOutCubic(t) { return 1 - Math.pow(1 - clamp01(t), 3); }
function easeInCubic(t) { t = clamp01(t); return t * t * t; }
function easeInOutCubic(t) {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function easeOutQuart(t) {
  t = clamp01(t);
  return 1 - Math.pow(1 - t, 4);
}
function easeInOutQuart(t) {
  t = clamp01(t);
  return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
}

// ═══════════════════════════════════════════════════════════
// 3D FINANCIAL DATA UNIVERSE (Three.js Engine)
// ═══════════════════════════════════════════════════════════

class MarketDataUniverse3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.w = window.innerWidth;
    this.h = window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(this.w, this.h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x020508, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x020508, 250, 1800);

    // Camera at optimal distance for intense star streaming past viewport
    this.camera = new THREE.PerspectiveCamera(56, this.w / this.h, 1, 1800);
    this.camera.position.set(0, 0, 480);
    this.initialCameraZ = 480;

    // Mouse spring dynamics
    this.mouse = { x: 0, y: 0, targetX: 0, targetY: 0, vx: 0, vy: 0 };
    this.fieldBend = { x: 0, y: 0 };

    this.initSignals();
    this.initFinancialTopology();
    this.initPerspectiveGrid();
  }

  // 9,500 Multi-depth financial market signals in a deep 1,400-unit continuous tunnel
  initSignals() {
    this.signalCount = 9500;
    this.tunnelDepth = 1400;
    const positions = new Float32Array(this.signalCount * 3);
    const colors = new Float32Array(this.signalCount * 3);
    const sizes = new Float32Array(this.signalCount);

    this.originalSignalPos = [];
    this.signalVelocities = [];

    const cPlatinum = new THREE.Color(0xF1F5F9);  // 45% silver-white
    const cCyan = new THREE.Color(0x00E5FF);      // 32% electric cyan
    const cBlue = new THREE.Color(0x3B82F6);      // 16% financial blue
    const cHyper = new THREE.Color(0xFFFFFF);     // 7% radiant pulse core

    for (let i = 0; i < this.signalCount; i++) {
      // Wide volume with deep frustum tunnel
      const x = (Math.random() - 0.5) * 960;
      const y = (Math.random() - 0.5) * 600;
      const z = (Math.random() - 0.5) * this.tunnelDepth - 100;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      this.originalSignalPos.push({ x, y, z });
      this.signalVelocities.push({
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        depthFactor: 0.6 + Math.random() * 1.5
      });

      const r = Math.random();
      let col, sz;
      if (r < 0.45) {
        col = cPlatinum;
        sz = 1.8 + Math.random() * 1.2;
      } else if (r < 0.77) {
        col = cCyan;
        sz = 2.6 + Math.random() * 1.5;
      } else if (r < 0.93) {
        col = cBlue;
        sz = 3.2 + Math.random() * 1.8;
      } else {
        col = cHyper;
        sz = 5.0 + Math.random() * 2.2;
      }

      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
      sizes[i] = sz;
    }

    this.signalsGeometry = new THREE.BufferGeometry();
    this.signalsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.signalsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.signalsGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // High-dynamic-range radial glow texture
    const pCanvas = document.createElement('canvas');
    pCanvas.width = 64; pCanvas.height = 64;
    const pCtx = pCanvas.getContext('2d');
    const rad = pCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
    rad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    rad.addColorStop(0.2, 'rgba(255, 255, 255, 0.95)');
    rad.addColorStop(0.45, 'rgba(0, 229, 255, 0.55)');
    rad.addColorStop(0.75, 'rgba(41, 121, 255, 0.18)');
    rad.addColorStop(1, 'rgba(0, 229, 255, 0)');
    pCtx.fillStyle = rad;
    pCtx.fillRect(0, 0, 64, 64);
    const pTex = new THREE.CanvasTexture(pCanvas);

    this.signalsMaterial = new THREE.PointsMaterial({
      size: 4.2,
      vertexColors: true,
      map: pTex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    });

    this.signalsMesh = new THREE.Points(this.signalsGeometry, this.signalsMaterial);
    this.scene.add(this.signalsMesh);

    // High-speed flight streaks (2,400 active speed trails)
    this.streakCount = 2400;
    const streakPos = new Float32Array(this.streakCount * 6);
    const streakCol = new Float32Array(this.streakCount * 6);

    for (let i = 0; i < this.streakCount; i++) {
      const orig = this.originalSignalPos[i];
      streakPos[i * 6] = orig.x;
      streakPos[i * 6 + 1] = orig.y;
      streakPos[i * 6 + 2] = orig.z;
      streakPos[i * 6 + 3] = orig.x;
      streakPos[i * 6 + 4] = orig.y;
      streakPos[i * 6 + 5] = orig.z;

      const isCyan = Math.random() > 0.45;
      const c = isCyan ? new THREE.Color(0x00E5FF) : new THREE.Color(0xF1F5F9);
      for (let v = 0; v < 2; v++) {
        streakCol[i * 6 + v * 3] = c.r;
        streakCol[i * 6 + v * 3 + 1] = c.g;
        streakCol[i * 6 + v * 3 + 2] = c.b;
      }
    }

    this.streakGeometry = new THREE.BufferGeometry();
    this.streakGeometry.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
    this.streakGeometry.setAttribute('color', new THREE.BufferAttribute(streakCol, 3));

    this.streakMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.streakMesh = new THREE.LineSegments(this.streakGeometry, this.streakMaterial);
    this.scene.add(this.streakMesh);
  }

  // Financial Constellation: Market Trajectory Channels & Liquidity Hubs
  initFinancialTopology() {
    const lineCoords = [];
    const lineColors = [];

    const cCyan = new THREE.Color(0x00E5FF);
    const cBlue = new THREE.Color(0x2979FF);
    const cDim = new THREE.Color(0x183860);

    // Continuous 3D Market Trajectory Channels
    this.trendPaths = [
      [
        new THREE.Vector3(-320, -90, -550),
        new THREE.Vector3(-180, -40, -380),
        new THREE.Vector3(-50, 10, -220),
        new THREE.Vector3(90, 70, -100),
        new THREE.Vector3(260, 130, -20)
      ],
      [
        new THREE.Vector3(-240, 110, -450),
        new THREE.Vector3(-100, 50, -320),
        new THREE.Vector3(30, -30, -200),
        new THREE.Vector3(160, 40, -90),
        new THREE.Vector3(290, -10, 30)
      ],
      [
        new THREE.Vector3(240, -100, -500),
        new THREE.Vector3(120, -50, -350),
        new THREE.Vector3(-20, 20, -210),
        new THREE.Vector3(-160, 80, -90),
        new THREE.Vector3(-280, 130, 20)
      ]
    ];

    this.trendPaths.forEach((path, pIdx) => {
      for (let i = 0; i < path.length - 1; i++) {
        const p1 = path[i];
        const p2 = path[i + 1];
        lineCoords.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        const col = (pIdx % 2 === 0) ? cCyan : cBlue;
        for (let v = 0; v < 2; v++) lineColors.push(col.r, col.g, col.b);
      }
    });

    // Subtle Liquidity Hubs
    const hubs = [
      new THREE.Vector3(-160, 60, -120),
      new THREE.Vector3(140, -40, -220),
      new THREE.Vector3(-60, -80, -340),
      new THREE.Vector3(180, 70, -110)
    ];

    hubs.forEach(hub => {
      for (let s = 0; s < 5; s++) {
        const angle = (s / 5) * Math.PI * 2;
        const dist = 32;
        const sat = new THREE.Vector3(
          hub.x + Math.cos(angle) * dist,
          hub.y + Math.sin(angle) * dist * 0.7,
          hub.z + ((s % 2) - 0.5) * 35
        );
        lineCoords.push(hub.x, hub.y, hub.z, sat.x, sat.y, sat.z);
        for (let v = 0; v < 2; v++) lineColors.push(cDim.r, cDim.g, cDim.b);
      }
    });

    const topoGeom = new THREE.BufferGeometry();
    topoGeom.setAttribute('position', new THREE.Float32BufferAttribute(lineCoords, 3));
    topoGeom.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));

    this.constellationMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.constellationLines = new THREE.LineSegments(topoGeom, this.constellationMaterial);
    this.scene.add(this.constellationLines);
  }

  // 3D Perspective Digital Floor Grid
  initPerspectiveGrid() {
    const gridLines = [];
    const gridSize = 500;
    const step = 36;
    const floorY = -140;

    for (let x = -gridSize; x <= gridSize; x += step) {
      gridLines.push(x, floorY, -900, x, floorY, 450);
    }
    for (let z = -900; z <= 450; z += step) {
      gridLines.push(-gridSize, floorY, z, gridSize, floorY, z);
    }

    const gridGeom = new THREE.BufferGeometry();
    gridGeom.setAttribute('position', new THREE.Float32BufferAttribute(gridLines, 3));

    this.gridMaterial = new THREE.LineBasicMaterial({
      color: 0x142845,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.perspectiveGrid = new THREE.LineSegments(gridGeom, this.gridMaterial);
    this.scene.add(this.perspectiveGrid);
  }

  // Update mouse spring physics
  updateMouse(dt) {
    const ax = (this.mouse.targetX - this.mouse.x) * 0.08;
    const ay = (this.mouse.targetY - this.mouse.y) * 0.08;
    this.mouse.vx = (this.mouse.vx + ax) * 0.82;
    this.mouse.vy = (this.mouse.vy + ay) * 0.82;
    this.mouse.x += this.mouse.vx;
    this.mouse.y += this.mouse.vy;

    this.fieldBend.x += (this.mouse.x * 24 - this.fieldBend.x) * 0.05;
    this.fieldBend.y += (this.mouse.y * 16 - this.fieldBend.y) * 0.05;
  }

  // Main 3D update per frame
  update(elapsed, dt) {
    this.updateMouse(dt);

    // ── STAGE 1: GENESIS (0 - 0.6s) ──
    const genAlpha = clamp01(elapsed / T.genesisEnd);
    this.signalsMaterial.opacity = easeOutCubic(genAlpha) * 0.95;
    this.constellationMaterial.opacity = (elapsed >= 350) ? clamp01((elapsed - 350) / 350) * 0.65 : 0;
    this.gridMaterial.opacity = (elapsed >= 400) ? clamp01((elapsed - 400) / 350) * 0.40 : 0;

    // ── STAGE 2: HIGH-SPEED DEEP STAR TRAVEL (0.6s - 3.3s) ──
    let flightSpeed = 0;

    if (elapsed >= T.travelStart && elapsed < T.travelEnd) {
      if (elapsed < T.travelCruise) {
        // Smooth progressive acceleration
        const aT = (elapsed - T.travelStart) / (T.travelCruise - T.travelStart);
        flightSpeed = easeInCubic(aT) * 54.0;
      } else if (elapsed < T.decelStart) {
        // High-speed cruise through deep space tunnel
        flightSpeed = 54.0;
      } else {
        // Continuous, smooth deceleration into station
        const dT = (elapsed - T.decelStart) / (T.travelEnd - T.decelStart);
        flightSpeed = 54.0 * (1 - easeOutCubic(dT));
      }
    } else {
      flightSpeed = 0;
    }

    // Stream particles through 3D space with continuous wrapping
    const sPos = this.signalsGeometry.attributes.position.array;
    const strPos = this.streakGeometry.attributes.position.array;

    const streakLen = flightSpeed * 3.2;
    const streakOpacity = Math.min(0.95, (flightSpeed / 30) * 0.95);
    this.streakMaterial.opacity = streakOpacity;

    const frontZ = this.camera.position.z + 40;

    for (let i = 0; i < this.signalCount; i++) {
      if (flightSpeed > 0.01) {
        // Advance particle toward/past camera along +Z
        sPos[i * 3 + 2] += flightSpeed * (dt * 60) * this.signalVelocities[i].depthFactor;
        // Continuous wrapping to maintain infinite deep tunnel
        if (sPos[i * 3 + 2] > frontZ) {
          sPos[i * 3 + 2] -= this.tunnelDepth;
        }

        // Slight dynamic field bend from mouse
        sPos[i * 3] += this.fieldBend.x * 0.035;
        sPos[i * 3 + 1] -= this.fieldBend.y * 0.035;

        // Update streaks for fast moving particles
        if (i < this.streakCount) {
          const px = sPos[i * 3];
          const py = sPos[i * 3 + 1];
          const pz = sPos[i * 3 + 2];

          strPos[i * 6] = px;
          strPos[i * 6 + 1] = py;
          strPos[i * 6 + 2] = pz;
          // Tail stretches backward into depth
          strPos[i * 6 + 3] = px;
          strPos[i * 6 + 4] = py;
          strPos[i * 6 + 5] = pz - streakLen * this.signalVelocities[i].depthFactor;
        }
      } else {
        // Settle smoothly to ambient cosmic drift around logo
        const orig = this.originalSignalPos[i];
        sPos[i * 3] += (orig.x - sPos[i * 3]) * 0.08;
        sPos[i * 3 + 1] += (orig.y - sPos[i * 3 + 1]) * 0.08;
        sPos[i * 3 + 2] += (orig.z - sPos[i * 3 + 2]) * 0.08;
      }
    }

    this.signalsGeometry.attributes.position.needsUpdate = true;
    if (this.streakMaterial.opacity > 0.01) {
      this.streakGeometry.attributes.position.needsUpdate = true;
    }

    // ── STAGE 5: LIVING UNIVERSE PARALLAX ──
    this.camera.position.x = this.mouse.x * 18;
    this.camera.position.y = -this.mouse.y * 14;
    this.camera.lookAt(0, 0, this.camera.position.z - 300);

    if (elapsed >= T.introComplete) {
      this.constellationMaterial.opacity = 0.55;
      this.gridMaterial.opacity = 0.32;
      this.signalsMaterial.opacity = 0.85;
    }

    this.renderer.render(this.scene, this.camera);
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  }
}

// ═══════════════════════════════════════════════════════════
// 2D VECTOR LOGO RENDERER (Authoritative Brand Identity)
// ZERO dotted lines — 100% razor-sharp, solid vector precision
// ═══════════════════════════════════════════════════════════

class MarketPulseLogoRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.wordmarkEl = document.getElementById('wordmark');
    this.subtitleEl = document.getElementById('subtitle');

    this.w = 0;
    this.h = 0;
    this.cx = 0;
    this.cy = 0;
    this.scale = 1;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.palette = {
      white: '#F0F3F7',
      blue: '#2979FF',
      blueBright: '#448AFF',
      blueCyan: '#27C8FF'
    };
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.cx = w * 0.5;
    this.cy = h * 0.45; // Optically balanced center with wordmark
    this.scale = Math.min(w * 0.52, h * 0.48, 440);

    // Position wordmark beneath logo baseline
    if (this.wordmarkEl) {
      const baselineY = this.cy + 0.368 * this.scale;
      this.wordmarkEl.style.left = `${this.cx}px`;
      this.wordmarkEl.style.top = `${baselineY + 46}px`;
    }
    if (this.subtitleEl) {
      const baselineY = this.cy + 0.368 * this.scale;
      this.subtitleEl.style.left = `${this.cx}px`;
      this.subtitleEl.style.top = `${baselineY + 86}px`;
    }
  }

  lx(x, ox = 0) { return this.cx + x * this.scale + ox; }
  ly(y, oy = 0) { return this.cy + y * this.scale + oy; }

  // Draw clean solid vector polygon
  drawPolygon(ctx, poly, color, opacity, ox = 0, oy = 0) {
    if (opacity <= 0.005 || poly.length < 3) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;

    ctx.beginPath();
    ctx.moveTo(this.lx(poly[0][0], ox), this.ly(poly[0][1], oy));
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(this.lx(poly[i][0], ox), this.ly(poly[i][1], oy));
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Progressive reveal for Outer-Left M stroke (poly 2)
  drawOuterM(ctx, progress, opacity, ox, oy) {
    if (progress <= 0 || opacity <= 0) return;
    const poly = WHITE_POLYS[2];
    if (progress >= 0.98) {
      this.drawPolygon(ctx, poly, this.palette.white, opacity, ox, oy);
      return;
    }

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = this.palette.white;

    ctx.beginPath();
    const curX = -0.52 + (0.02 - -0.52) * easeOutCubic(progress);
    ctx.rect(this.lx(-0.55, ox), this.ly(-0.15, oy), (curX - -0.55) * this.scale, 0.6 * this.scale);
    ctx.clip();

    ctx.beginPath();
    ctx.moveTo(this.lx(poly[0][0], ox), this.ly(poly[0][1], oy));
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(this.lx(poly[i][0], ox), this.ly(poly[i][1], oy));
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Progressive reveal for Middle M + Outer P (poly 0)
  drawMiddleMAndP(ctx, progress, opacity, ox, oy) {
    if (progress <= 0 || opacity <= 0) return;
    const poly = WHITE_POLYS[0];
    if (progress >= 0.98) {
      this.drawPolygon(ctx, poly, this.palette.white, opacity, ox, oy);
      return;
    }

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = this.palette.white;

    ctx.beginPath();
    if (progress < 0.5) {
      const t = progress / 0.5;
      const curX = -0.43 + (0.05 - -0.43) * easeOutCubic(t);
      ctx.rect(this.lx(-0.45, ox), this.ly(-0.20, oy), (curX - -0.45) * this.scale, 0.65 * this.scale);
    } else if (progress < 0.82) {
      const t = (progress - 0.5) / 0.32;
      const curX = 0.05 + (0.52 - 0.05) * easeOutCubic(t);
      ctx.rect(this.lx(-0.45, ox), this.ly(-0.20, oy), (curX - -0.45) * this.scale, 0.65 * this.scale);
    } else {
      const t = (progress - 0.82) / 0.18;
      const curY = 0.18 + (0.38 - 0.18) * easeOutCubic(t);
      ctx.rect(this.lx(-0.45, ox), this.ly(-0.20, oy), 0.98 * this.scale, (curY - -0.20) * this.scale);
    }
    ctx.clip();

    ctx.beginPath();
    ctx.moveTo(this.lx(poly[0][0], ox), this.ly(poly[0][1], oy));
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(this.lx(poly[i][0], ox), this.ly(poly[i][1], oy));
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Progressive reveal for Inner M + Inner P (poly 1)
  drawInnerMAndP(ctx, progress, opacity, ox, oy) {
    if (progress <= 0 || opacity <= 0) return;
    const poly = WHITE_POLYS[1];
    if (progress >= 0.98) {
      this.drawPolygon(ctx, poly, this.palette.white, opacity, ox, oy);
      return;
    }

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = this.palette.white;

    ctx.beginPath();
    if (progress < 0.5) {
      const t = progress / 0.5;
      const curX = -0.34 + (0.05 - -0.34) * easeOutCubic(t);
      ctx.rect(this.lx(-0.36, ox), this.ly(-0.15, oy), (curX - -0.36) * this.scale, 0.60 * this.scale);
    } else if (progress < 0.82) {
      const t = (progress - 0.5) / 0.32;
      const curX = 0.05 + (0.46 - 0.05) * easeOutCubic(t);
      ctx.rect(this.lx(-0.36, ox), this.ly(-0.15, oy), (curX - -0.36) * this.scale, 0.60 * this.scale);
    } else {
      const t = (progress - 0.82) / 0.18;
      const curY = 0.12 + (0.38 - 0.12) * easeOutCubic(t);
      ctx.rect(this.lx(-0.36, ox), this.ly(-0.15, oy), 0.85 * this.scale, (curY - -0.15) * this.scale);
    }
    ctx.clip();

    ctx.beginPath();
    ctx.moveTo(this.lx(poly[0][0], ox), this.ly(poly[0][1], oy));
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(this.lx(poly[i][0], ox), this.ly(poly[i][1], oy));
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Progressive reveal for vertical stems (polys 3 & 4)
  drawStems(ctx, progress, opacity, ox, oy) {
    if (progress <= 0 || opacity <= 0) return;
    for (const idx of [3, 4]) {
      const poly = WHITE_POLYS[idx];
      if (progress >= 0.98) {
        this.drawPolygon(ctx, poly, this.palette.white, opacity, ox, oy);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.fillStyle = this.palette.white;

      const curY = 0.08 + (0.38 - 0.08) * easeOutCubic(progress);
      ctx.beginPath();
      ctx.rect(this.lx(0.14, ox), this.ly(0.06, oy), 0.14 * this.scale, (curY - 0.06) * this.scale);
      ctx.clip();

      ctx.beginPath();
      ctx.moveTo(this.lx(poly[0][0], ox), this.ly(poly[0][1], oy));
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(this.lx(poly[i][0], ox), this.ly(poly[i][1], oy));
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Progressive reveal for Blue Market Arrow & Checkmark
  drawBlueArrow(ctx, progress, snapProgress, opacity, ox, oy) {
    if (progress <= 0 || opacity <= 0) return;
    const poly = BLUE_POLY;

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = this.palette.blue;
    ctx.shadowColor = this.palette.blue;
    ctx.shadowBlur = 10;

    if (progress >= 0.98) {
      // Full solid vector shape — clean, sharp, vivid
      ctx.beginPath();
      ctx.moveTo(this.lx(poly[0][0], ox), this.ly(poly[0][1], oy));
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(this.lx(poly[i][0], ox), this.ly(poly[i][1], oy));
      }
      ctx.closePath();
      ctx.fill();

      // Arrowhead snap flare
      if (snapProgress > 0 && snapProgress < 1) {
        const tipX = this.lx(0.387, ox);
        const tipY = this.ly(-0.364, oy);
        const flareR = 28 * (1 - snapProgress);
        const grad = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, flareR);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        grad.addColorStop(0.3, 'rgba(39, 200, 255, 0.85)');
        grad.addColorStop(0.6, 'rgba(41, 121, 255, 0.3)');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(tipX, tipY, flareR, 0, Math.PI * 2); ctx.fill();
      }

      ctx.shadowBlur = 0;
      ctx.restore();
      return;
    }

    // Progressive reveal clipping
    ctx.beginPath();
    if (progress < 0.30) {
      // Lower checkmark forming left to right
      const t = progress / 0.30;
      const curX = -0.12 + (0.02 - -0.12) * easeOutCubic(t);
      ctx.rect(this.lx(-0.14, ox), this.ly(-0.15, oy), (curX - -0.14) * this.scale, 0.30 * this.scale);
    } else {
      // Full checkmark + rising market shaft up to curY
      const t = (progress - 0.30) / 0.70;
      const curY = 0.12 + (-0.38 - 0.12) * easeInOutCubic(t);
      // Checkmark box
      ctx.rect(this.lx(-0.14, ox), this.ly(-0.15, oy), 0.18 * this.scale, 0.30 * this.scale);
      // Rising shaft box
      ctx.rect(this.lx(-0.02, ox), this.ly(curY, oy), 0.45 * this.scale, (0.15 - curY) * this.scale);
    }
    ctx.clip();

    ctx.beginPath();
    ctx.moveTo(this.lx(poly[0][0], ox), this.ly(poly[0][1], oy));
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(this.lx(poly[i][0], ox), this.ly(poly[i][1], oy));
    }
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // High-energy data pulse along the blue market path
  drawPulse(ctx, progress, ox, oy) {
    if (progress < 0 || progress > 1) return;
    const path = BLUE_PULSE_PATH;
    const totalSegs = path.length - 1;
    const pos = progress * totalSegs;
    const segI = Math.min(Math.floor(pos), totalSegs - 1);
    const segT = pos - segI;

    const [x1, y1] = path[segI];
    const [x2, y2] = path[Math.min(segI + 1, path.length - 1)];
    const px = this.lx(x1 + (x2 - x1) * segT, ox);
    const py = this.ly(y1 + (y2 - y1) * segT, oy);

    ctx.save();
    const haloR = 26;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, haloR);
    grad.addColorStop(0, 'rgba(39, 200, 255, 0.80)');
    grad.addColorStop(0.4, 'rgba(41, 121, 255, 0.30)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(px, py, haloR, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = this.palette.blueCyan;
    ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(px, py, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // Subtle ambient backlight bloom on settle
  drawSettleGlow(ctx, intensity, ox, oy) {
    if (intensity < 0.01) return;
    ctx.save();
    const r = this.scale * 0.75;
    const grad = ctx.createRadialGradient(this.cx + ox, this.cy + oy, 0, this.cx + ox, this.cy + oy, r);
    grad.addColorStop(0, `rgba(39, 200, 255, ${0.08 * intensity})`);
    grad.addColorStop(0.4, `rgba(41, 121, 255, ${0.03 * intensity})`);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(this.cx + ox - r, this.cy + oy - r, r * 2, r * 2);
    ctx.restore();
  }

  // Render 2D vector frame
  render(elapsed, ox, oy) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    if (elapsed < T.vectorMStart) return;

    // Settle bounce calculation
    let settleIntensity = 0;
    let settleOy = oy;
    if (elapsed >= T.settleStart && elapsed < T.settleEnd) {
      const st = (elapsed - T.settleStart) / (T.settleEnd - T.settleStart);
      const damping = Math.sin(st * Math.PI * 2.5) * (1 - st);
      settleOy += damping * 2.0;
      settleIntensity = Math.sin(st * Math.PI);
    }

    this.drawSettleGlow(ctx, settleIntensity, ox, settleOy);

    // Vector progression factors
    const mProgress = clamp01((elapsed - T.vectorMStart) / (T.vectorMEnd - T.vectorMStart));
    const mEase = easeInOutCubic(mProgress);

    const pProgress = clamp01((elapsed - T.vectorPStart) / (T.vectorPEnd - T.vectorPStart));
    const pEase = easeInOutCubic(pProgress);

    const stemsProgress = clamp01((elapsed - T.vectorStemsStart) / (T.vectorStemsEnd - T.vectorStemsStart));
    const stemsEase = easeInOutCubic(stemsProgress);

    const blueProgress = clamp01((elapsed - T.vectorBlueStart) / (T.vectorBlueEnd - T.vectorBlueStart));
    const blueEase = easeInOutCubic(blueProgress);

    const snapProgress = clamp01((elapsed - T.arrowSnap) / 180);

    // Render authoritative vector shapes — pristine, solid, zero dotted lines
    this.drawOuterM(ctx, mEase, easeOutCubic(mProgress * 2), ox, settleOy);
    this.drawMiddleMAndP(ctx, pEase > 0 ? (0.5 + pEase * 0.5) : (mEase * 0.5), easeOutCubic(mProgress * 1.5), ox, settleOy);
    this.drawInnerMAndP(ctx, pEase > 0 ? (0.5 + pEase * 0.5) : (mEase * 0.5), easeOutCubic(mProgress * 1.5), ox, settleOy);
    this.drawStems(ctx, stemsEase, easeOutCubic(stemsProgress * 2), ox, settleOy);
    this.drawBlueArrow(ctx, blueEase, snapProgress, easeOutCubic(blueProgress * 1.5), ox, settleOy);

    // Wordmark reveal
    if (elapsed >= T.wordStart) {
      const wordRaw = clamp01((elapsed - T.wordStart) / (T.wordEnd - T.wordStart));
      const wordP = easeOutCubic(wordRaw);
      if (this.wordmarkEl) {
        this.wordmarkEl.style.opacity = wordP;
        this.wordmarkEl.style.transform = `translate(-50%, ${(1 - wordP) * 8}px)`;
      }
      if (this.subtitleEl) {
        const subD = clamp01((wordRaw - 0.25) / 0.75);
        const subP = easeOutCubic(subD);
        this.subtitleEl.style.opacity = subP * 0.45;
        this.subtitleEl.style.transform = `translate(-50%, ${(1 - subP) * 5}px)`;
      }
    }

    // Blue Arrow Data Pulse
    if (elapsed >= T.pulseStart && elapsed <= T.pulseEnd) {
      const pulseRaw = (elapsed - T.pulseStart) / (T.pulseEnd - T.pulseStart);
      const pulseP = easeInOutQuart(pulseRaw);
      this.drawPulse(ctx, pulseP, ox, settleOy);
    }

    // Periodic ambient pulse after intro
    if (elapsed > T.introComplete) {
      const loopT = (performance.now() % 6000) / 1400;
      if (loopT >= 0 && loopT <= 1) {
        this.drawPulse(ctx, easeInOutQuart(loopT), ox, settleOy);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
// ORCHESTRATOR & LIFECYCLE
// ═══════════════════════════════════════════════════════════

class MarketPulseExperience {
  constructor() {
    this.webglCanvas = document.getElementById('webgl-canvas');
    this.introCanvas = document.getElementById('intro-canvas');

    this.universe = new MarketDataUniverse3D(this.webglCanvas);
    this.logo = new MarketPulseLogoRenderer(this.introCanvas);

    this.t0 = performance.now();
    this.lastTime = performance.now();

    this.smx = 0;
    this.smy = 0;
    this.rafId = null;

    this.bindEvents();
    this.resize();

    this.rafId = requestAnimationFrame(this.loop.bind(this));
  }

  destroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  restart() {
    this.t0 = performance.now();
    this.lastTime = performance.now();
    if (this.logo.wordmarkEl) {
      this.logo.wordmarkEl.style.opacity = '0';
      this.logo.wordmarkEl.style.transform = 'translate(-50%, 8px)';
    }
    if (this.logo.subtitleEl) {
      this.logo.subtitleEl.style.opacity = '0';
      this.logo.subtitleEl.style.transform = 'translate(-50%, 5px)';
    }
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('mousemove', (e) => {
      const nx = (e.clientX / window.innerWidth - 0.5) * 2;
      const ny = (e.clientY / window.innerHeight - 0.5) * 2;
      this.universe.mouse.targetX = nx;
      this.universe.mouse.targetY = ny;
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.key === 'r' || e.key === 'R') {
        this.restart();
      }
    });
    window.addEventListener('click', () => {
      if (performance.now() - this.t0 > T.introComplete) {
        this.restart();
      }
    });
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.universe.resize(w, h);
    this.logo.resize(w, h);
  }

  loop(now) {
    const elapsed = now - this.t0;
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    // Smooth mouse coordinates for 2D parallax
    this.smx += (this.universe.mouse.x - this.smx) * 0.06;
    this.smy += (this.universe.mouse.y - this.smy) * 0.06;

    const ox = this.smx * 6;
    const oy = this.smy * 4;

    // 1. Update 3D Universe
    this.universe.update(elapsed, dt);

    // 2. Update 2D Logo Overlay
    this.logo.render(elapsed, ox, oy);

    this.rafId = requestAnimationFrame(this.loop.bind(this));
  }
}

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════

if (window.MarketPulse && typeof window.MarketPulse.destroy === 'function') {
  window.MarketPulse.destroy();
}

function boot() {
  window.MarketPulse = new MarketPulseExperience();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
