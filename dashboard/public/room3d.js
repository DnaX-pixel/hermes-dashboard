// room3d.js
//
// Scene 3D sebenar guna Three.js (gantikan room.js SVG isometric).
// Bina robot, meja, vault, kerusi, monitor, dinding dari primitive geometry
// (box/sphere/cylinder/capsule) dengan lighting + shadow betul.
//
// API yang didedahkan (dipanggil oleh app.js):
//   ROOM3D.init(mountEl)                  -> setup scene, camera, renderer, lights, walls/floor
//   ROOM3D.addAgent(agent, onClick)       -> bina furniture + robot untuk satu agent, letak di slot
//   ROOM3D.setAgentState(id, state, sel)  -> update visual (glow, bob, ring) ikut state
//   ROOM3D.start()                        -> mula render loop
//
// Robot dibina dalam THREE.Group supaya boleh animate (bob, rotate antenna) per-frame.

const ROOM3D = (() => {
  let THREE, scene, camera, renderer, controls;
  let clock;
  const agentRigs = {}; // id -> { group, robot, parts..., state, selected }
  const SLOTS = [
    { x: -3.2, z: -1.0, face: 0.5 },
    { x: 3.2, z: -1.0, face: -0.5 },
    { x: -3.2, z: 2.4, face: 0.5 },
    { x: 3.2, z: 2.4, face: -0.5 },
  ];
  let slotIndex = 0;

  // ---- color helpers ----
  function lighten(hex, amt) {
    const c = new THREE.Color(hex);
    c.lerp(new THREE.Color("#ffffff"), amt);
    return c;
  }
  function darken(hex, amt) {
    const c = new THREE.Color(hex);
    c.lerp(new THREE.Color("#000000"), amt);
    return c;
  }

  function mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: opts.roughness ?? 0.65,
      metalness: opts.metalness ?? 0.1,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color("#000000"),
      emissiveIntensity: opts.emissiveIntensity ?? 0,
    });
  }

  function boxMesh(w, h, d, material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  // ---- robot builder (returns a THREE.Group) ----
  function buildRobot(agent) {
    const g = new THREE.Group();
    const base = agent.color;
    const bodyMat = mat(base, { roughness: 0.45, metalness: 0.25 });
    const headMat = mat(lighten(base, 0.08), { roughness: 0.4, metalness: 0.3 });
    const darkMat = mat(darken(base, 0.35), { roughness: 0.5 });

    // base / pelvis (rounded cylinder)
    const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.34, 24), darkMat);
    pelvis.position.y = 0.2;
    pelvis.castShadow = true;
    g.add(pelvis);

    // torso (rounded box via slightly beveled cylinder + box hybrid: use a capsule)
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.5, 8, 20), bodyMat);
    torso.position.y = 0.85;
    torso.castShadow = true;
    g.add(torso);

    // chest panel (generic vents untuk semua agent)
    const chest = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      chest.add(boxMesh(0.28, 0.05, 0.04, mat("#1b212b"), 0, 1.0 - i * 0.12, 0.38));
    }
    g.add(chest);

    // arms (capsules)
    const armGeo = new THREE.CapsuleGeometry(0.12, 0.4, 6, 12);
    const armL = new THREE.Mesh(armGeo, bodyMat);
    armL.position.set(-0.5, 0.9, 0);
    armL.rotation.z = 0.28;
    armL.castShadow = true;
    g.add(armL);
    const armR = new THREE.Mesh(armGeo, bodyMat);
    armR.position.set(0.5, 0.9, 0);
    armR.rotation.z = -0.28;
    armR.castShadow = true;
    g.add(armR);

    // head (sphere)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 28, 28), headMat);
    head.position.y = 1.62;
    head.castShadow = true;
    g.add(head);

    // visor (curved dark band with emissive glow inset)
    const visorBand = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.12, 16, 32, Math.PI), mat("#10151c", { roughness: 0.3 }));
    visorBand.position.set(0, 1.64, 0.18);
    visorBand.rotation.x = Math.PI / 2;
    visorBand.rotation.z = Math.PI;
    g.add(visorBand);

    const visorGlow = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.05, 0.34, 4, 12),
      mat("#bff0ff", { emissive: "#7fd8ff", emissiveIntensity: 0.9, roughness: 0.2 })
    );
    visorGlow.rotation.z = Math.PI / 2;
    visorGlow.position.set(0, 1.66, 0.34);
    g.add(visorGlow);

    // antenna
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), bodyMat);
    stalk.position.y = 2.12;
    g.add(stalk);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 16, 16),
      mat(lighten(base, 0.2), { emissive: base, emissiveIntensity: 0.5 })
    );
    tip.position.y = 2.26;
    g.add(tip);

    g.userData.parts = { visorGlow, tip, head };
    return g;
  }

  // ---- furniture builders (enhanced, light-mode tones) ----
  function buildDesk() {
    const grp = new THREE.Group();
    const topMat = mat("#c8a87e", { roughness: 0.6, metalness: 0.05 }); // warm wood top
    const legMat = mat("#9aa6b5", { roughness: 0.4, metalness: 0.6 }); // brushed metal legs
    const top = boxMesh(2.0, 0.14, 1.1, topMat, 0, 0.8, 0);
    grp.add(top);
    // thin darker edge band under the top for depth
    grp.add(boxMesh(2.02, 0.04, 1.12, mat("#a8895f"), 0, 0.72, 0));
    const lx = 0.9, lz = 0.45;
    [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]].forEach(([x, z]) => {
      grp.add(boxMesh(0.1, 0.78, 0.1, legMat, x, 0.39, z));
    });
    return grp;
  }

  function buildChair() {
    const grp = new THREE.Group();
    const cushion = mat("#5b6b82", { roughness: 0.85 });
    const frame = mat("#9aa6b5", { roughness: 0.4, metalness: 0.6 });
    // seat (rounded via cylinder slab)
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.12, 24), cushion);
    seat.position.y = 0.52;
    seat.castShadow = true;
    grp.add(seat);
    // backrest
    const back = boxMesh(0.62, 0.6, 0.12, cushion, 0, 0.9, -0.3);
    grp.add(back);
    // central pole + 5-star base
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 12), frame);
    pole.position.y = 0.26;
    grp.add(pole);
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8), frame);
      leg.rotation.z = Math.PI / 2;
      leg.rotation.y = ang;
      leg.position.set(Math.cos(ang) * 0.16, 0.06, Math.sin(ang) * 0.16);
      grp.add(leg);
    }
    return grp;
  }

  function buildMonitor() {
    const grp = new THREE.Group();
    grp.add(boxMesh(0.08, 0.3, 0.08, mat("#3a4252", { metalness: 0.5 }), 0, 1.0, 0)); // stand
    grp.add(boxMesh(0.5, 0.04, 0.18, mat("#3a4252", { metalness: 0.5 }), 0, 0.86, 0)); // foot
    const bezel = boxMesh(0.95, 0.58, 0.05, mat("#1e293b", { roughness: 0.4 }), 0, 1.4, 0);
    grp.add(bezel);
    const screen = boxMesh(0.86, 0.5, 0.02, mat("#1e293b", { emissive: "#3b82f6", emissiveIntensity: 0.55 }), 0, 1.4, 0.03);
    grp.add(screen);
    // code lines (cyan-ish glow strips)
    grp.add(boxMesh(0.5, 0.03, 0.01, mat("#bfdbfe", { emissive: "#bfdbfe", emissiveIntensity: 0.4 }), -0.12, 1.52, 0.045));
    grp.add(boxMesh(0.62, 0.03, 0.01, mat("#bfdbfe", { emissive: "#bfdbfe", emissiveIntensity: 0.3 }), -0.06, 1.45, 0.045));
    grp.add(boxMesh(0.36, 0.03, 0.01, mat("#bfdbfe", { emissive: "#bfdbfe", emissiveIntensity: 0.4 }), -0.18, 1.38, 0.045));
    // keyboard on the desk
    grp.add(boxMesh(0.7, 0.04, 0.26, mat("#cbd5e1", { roughness: 0.6 }), 0, 0.88, 0.42));
    return grp;
  }

  function buildVault() {
    const grp = new THREE.Group();
    const bodyMat = mat("#aeb8c7", { roughness: 0.35, metalness: 0.7 });
    grp.add(boxMesh(1.4, 1.5, 1.2, bodyMat, 0, 0.76, 0));
    // door inset (frame, tetap - tak berpusing)
    grp.add(boxMesh(1.1, 1.15, 0.08, mat("#8b97a8", { metalness: 0.6, roughness: 0.4 }), 0, 0.78, 0.6));

    // Door dibina dalam sub-group dengan pivot di tepi kiri (hinge side), supaya
    // rotation.y pada group ni berfungsi macam pintu sebenar membuka ke luar.
    // Geometri pintu di-offset +0.46 (radius) ke arah +x relatif pivot, supaya
    // bila pivot tu sendiri diletak di -0.46 dari center asal, visualnya tepat.
    const doorPivot = new THREE.Group();
    doorPivot.position.set(-0.46, 0.78, 0.64); // pivot di tepi kiri pintu
    const door = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.12, 32), mat("#c4cdda", { metalness: 0.8, roughness: 0.25 }));
    door.rotation.x = Math.PI / 2;
    door.position.set(0.46, 0, 0); // offset supaya pusing kat hinge, bukan kat center sendiri
    doorPivot.add(door);
    // dial ring + dot + handle - semua sekali dengan pintu (ikut pusing)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.045, 12, 28), mat("#6b7686", { metalness: 0.7 }));
    ring.position.set(0.46, 0, 0.08);
    doorPivot.add(ring);
    const dialDot = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 14), mat("#22c55e", { emissive: "#22c55e", emissiveIntensity: 0.7 }));
    dialDot.position.set(0.46, 0, 0.11);
    doorPivot.add(dialDot);
    const spoke = mat("#5b6675", { metalness: 0.6 });
    doorPivot.add(boxMesh(0.52, 0.08, 0.08, spoke, 0.46, 0, 0.1));
    doorPivot.add(boxMesh(0.08, 0.52, 0.08, spoke, 0.46, 0, 0.1));
    grp.add(doorPivot);

    // hinges on the side (visual je, tetap di body)
    grp.add(boxMesh(0.1, 0.2, 0.1, mat("#6b7686", { metalness: 0.7 }), -0.6, 1.1, 0.5));
    grp.add(boxMesh(0.1, 0.2, 0.1, mat("#6b7686", { metalness: 0.7 }), -0.6, 0.45, 0.5));

    grp.userData = { doorPivot, dialDot };
    return grp;
  }

  function buildCalculator() {
    const grp = new THREE.Group();
    grp.add(boxMesh(0.34, 0.06, 0.44, mat("#475569", { roughness: 0.5 }), 0, 0.89, 0));
    const display = boxMesh(0.26, 0.02, 0.13, mat("#86efac", { emissive: "#22c55e", emissiveIntensity: 0.5 }), 0, 0.93, -0.13);
    grp.add(display); // display
    // button grid
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      grp.add(boxMesh(0.05, 0.02, 0.05, mat("#94a3b8"), -0.08 + c * 0.08, 0.93, 0.02 + r * 0.08));
    }
    grp.userData = { display };
    return grp;
  }

  // ---- scene scaffold (light mode, enhanced) ----
  function buildRoomShell() {
    // floor with subtle warm tint + soft grid
    const floorMat = mat("#e8edf4", { roughness: 0.95, metalness: 0.0 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 18), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // grid overlay (light)
    const grid = new THREE.GridHelper(20, 20, 0xc7d2e0, 0xdde4ee);
    grid.position.y = 0.015;
    scene.add(grid);

    // back walls (two planes forming a corner) - light
    const wallBackMat = mat("#f1f5fb", { roughness: 1 });
    const wallLeftMat = mat("#e9eef6", { roughness: 1 });
    const wallBack = new THREE.Mesh(new THREE.PlaneGeometry(20, 8), wallBackMat);
    wallBack.position.set(0, 4, -9);
    wallBack.receiveShadow = true;
    scene.add(wallBack);
    const wallLeft = new THREE.Mesh(new THREE.PlaneGeometry(18, 8), wallLeftMat);
    wallLeft.rotation.y = Math.PI / 2;
    wallLeft.position.set(-10, 4, 0);
    wallLeft.receiveShadow = true;
    scene.add(wallLeft);

    // baseboard trims (slim darker strips where wall meets floor)
    const trimMat = mat("#d4dceb", { roughness: 0.8 });
    const trimBack = boxMesh(20, 0.25, 0.1, trimMat, 0, 0.12, -8.95);
    scene.add(trimBack);
    const trimLeft = boxMesh(0.1, 0.25, 18, trimMat, -9.95, 0.12, 0);
    scene.add(trimLeft);

    // whiteboard on the back wall
    const wbFrame = boxMesh(4, 2.4, 0.12, mat("#cbd5e1", { roughness: 0.5, metalness: 0.3 }), 1.5, 4.2, -8.88);
    scene.add(wbFrame);
    const wbSurface = boxMesh(3.7, 2.1, 0.06, mat("#ffffff", { roughness: 0.4 }), 1.5, 4.2, -8.82);
    scene.add(wbSurface);
    // marker scribbles (thin colored boxes)
    scene.add(boxMesh(1.2, 0.04, 0.02, mat("#3b82f6"), 0.6, 4.7, -8.78));
    scene.add(boxMesh(0.8, 0.04, 0.02, mat("#64748b"), 0.4, 4.4, -8.78));
    scene.add(boxMesh(1.5, 0.04, 0.02, mat("#22c55e"), 0.8, 4.1, -8.78));
    scene.add(boxMesh(0.6, 0.04, 0.02, mat("#f97316"), 0.3, 3.8, -8.78));
  }

  function init(mountEl) {
    THREE = window.THREE;
    clock = new THREE.Clock();

    scene = new THREE.Scene();
    scene.background = new THREE.Color("#f1f5fb");
    scene.fog = new THREE.Fog("#f1f5fb", 22, 38);

    const w = mountEl.clientWidth || 760;
    const h = mountEl.clientHeight || 480;
    camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    camera.position.set(9, 8.5, 11);
    camera.lookAt(0, 1, 0.5);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    mountEl.appendChild(renderer.domElement);

    // lighting (light studio setup)
    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambient);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xcdd6e5, 0.5);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(8, 14, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -14;
    key.shadow.camera.right = 14;
    key.shadow.camera.top = 14;
    key.shadow.camera.bottom = -14;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd0ff, 0.25);
    fill.position.set(-7, 6, -5);
    scene.add(fill);

    buildRoomShell();

    // orbit controls (optional - loaded if available)
    if (window.OrbitControls) {
      controls = new window.OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 1, 0.5);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 6;
      controls.maxDistance = 20;
      controls.maxPolarAngle = Math.PI / 2.2;
      controls.update();
    }

    // raycaster for clicks
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    renderer.domElement.addEventListener("click", (ev) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const groups = Object.values(agentRigs).map((r) => r.group);
      const hits = raycaster.intersectObjects(groups, true);
      if (hits.length) {
        let obj = hits[0].object;
        while (obj && !obj.userData.agentId && obj.parent) obj = obj.parent;
        if (obj && obj.userData.agentId && obj.userData.onClick) obj.userData.onClick(obj.userData.agentId);
      }
    });

    window.addEventListener("resize", () => {
      const ww = mountEl.clientWidth, hh = mountEl.clientHeight;
      if (!ww || !hh) return;
      camera.aspect = ww / hh;
      camera.updateProjectionMatrix();
      renderer.setSize(ww, hh);
    });
  }

  function addAgent(agent, onClick) {
    const slot = SLOTS[slotIndex % SLOTS.length];
    slotIndex++;

    const rig = new THREE.Group();
    rig.position.set(slot.x, 0, slot.z);
    rig.userData.agentId = agent.id;
    rig.userData.onClick = onClick;

    // furniture sub-group, placed behind the robot (toward the wall)
    const furniture = new THREE.Group();
    furniture.position.set(0, 0, -0.9);
    furniture.add(buildDesk());
    furniture.add(buildChair());
    let vaultRef = null;
    let calcRef = null;
    if (agent.hasVault) {
      const vault = buildVault();
      vault.position.set(-1.9, 0, -1.4); // back-left, against the wall, clear of the desk
      furniture.add(vault);
      vaultRef = vault;
      const calc = buildCalculator();
      calc.position.set(0.3, 0, 0); // on the desk top
      furniture.add(calc);
      calcRef = calc;
    }
    if (agent.hasMonitor) {
      const mon = buildMonitor();
      mon.position.set(0, 0, 0);
      furniture.add(mon);
    }
    rig.add(furniture);

    // robot in front, facing camera-ish
    const robot = buildRobot(agent);
    robot.position.set(0, 0, 0.4);
    robot.rotation.y = slot.face;
    rig.add(robot);

    // bubble group: child of rig (BUKAN robot), supaya posisi dia ikut robot
    // bergerak tapi TIDAK ikut robot.rotation.y (bubble kena sentiasa "duduk
    // tegak" menghadap kamera, bukan berpusing sekali dengan badan robot)
    const bubbleGroup = new THREE.Group();
    bubbleGroup.position.set(0, 2.55, 0.4); // tinggi atas kepala robot
    rig.add(bubbleGroup);

    scene.add(rig);

    // Waypoint positions (dalam ruang LOKAL rig, sama macam furniture/robot di atas).
    // Furniture group ada offset z:-0.9; vault & calc local pos ditambah offset tu
    // untuk dapat posisi SEBENAR dalam ruang rig.
    // - idle:  posisi standing asal robot (depan sekali, jauh dari furniture)
    // - aisle: titik laluan tengah, SELARI dengan idle tapi sedikit ke belakang -
    //          robot SENTIASA lalu sini dulu sebelum ke vault/desk, supaya tak
    //          terus potong lurus menerusi badan furniture lain.
    // - vault: depan vault
    // - desk:  depan meja/kalkulator
    const waypoints = {
      idle: { x: 0, z: 0.6, face: slot.face },
      aisle: { x: 0, z: 0.1, face: Math.PI }, // lorong selamat depan semua furniture
      // sideAisle: titik di SEBELAH KIRI meja (x lebih negatif dari tepi meja
      // x:-1.0), digunakan sebagai laluan-L supaya robot pusing keluar dulu
      // ke kiri sebelum ke belakang menuju vault - bukan potong diagonal
      // terus menerusi badan meja.
      sideAisle: { x: -1.9, z: 0.1, face: Math.PI },
      vault: { x: -1.9, z: -1.3, face: Math.PI }, // berdiri DEPAN pintu vault (vault occupy z:-2.9 to -1.7), hadap ke dalam
      desk: { x: 0.3, z: -0.05, face: Math.PI }, // berdiri DEPAN meja (meja occupy z:-1.45 to -0.35), hadap meja
    };

    agentRigs[agent.id] = {
      group: rig,
      robot,
      bubbleGroup,
      bubbleSprite: null,
      state: "idle",
      selected: false,
      baseColor: agent.color,
      waypoints,
      vaultRef,
      calcRef,
      actionQueue: [],
      currentStep: null,
      stepStartedAt: 0,
      // posisi & face semasa robot (untuk lerp dalam animate loop)
      currentPos: { x: 0, z: 0.4 },
      currentFace: slot.face,
    };
  }

  // === Speech bubble (Sprite + CanvasTexture, selalu hadap kamera) ===
  // Dipanggil setiap kali nak tunjuk/tukar "fikiran" robot di atas kepala dia.
  // text kosong/null akan sembunyikan bubble.
  const BUBBLE_ICONS = {
    vault: "🔒",
    calc: "🧮",
    debt: "📋",
    payment: "💸",
    think: "💭",
  };

  function makeBubbleTexture(text, iconKey) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 160;
    const ctx = canvas.getContext("2d");

    // bubble background (rounded rect, putih dengan border halus)
    const r = 28;
    const w = canvas.width - 16;
    const h = canvas.height - 16;
    const x = 8, y = 8;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // tail (segitiga kecil di bawah, arah ke robot)
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2 - 18, y + h - 2);
    ctx.lineTo(canvas.width / 2 + 18, y + h - 2);
    ctx.lineTo(canvas.width / 2, y + h + 26);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // icon (emoji simple, render terus guna fillText - tak perlu asset luar)
    const icon = BUBBLE_ICONS[iconKey] || "";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let textX = x + 24;
    if (icon) {
      ctx.font = "56px sans-serif";
      ctx.fillText(icon, x + 16, y + h / 2);
      textX = x + 90;
    }
    ctx.fillStyle = "#1e293b";
    ctx.font = "500 38px Inter, sans-serif";
    ctx.fillText(text, textX, y + h / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  function setSpeechBubble(rig, text, iconKey) {
    if (!text) {
      if (rig.bubbleSprite) rig.bubbleSprite.visible = false;
      return;
    }
    if (rig.bubbleSprite) {
      rig.bubbleGroup.remove(rig.bubbleSprite);
      rig.bubbleSprite.material.map.dispose();
      rig.bubbleSprite.material.dispose();
    }
    const tex = makeBubbleTexture(text, iconKey);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.45, 0.45, 1);
    sprite.position.set(0, 0, 0);
    rig.bubbleGroup.add(sprite);
    rig.bubbleSprite = sprite;
    sprite.visible = true;
  }

  // === Action sequences ===
  // Setiap "action" (dihantar dari watcher via WebSocket) map ke satu siri
  // langkah. Setiap langkah ada waypoint (key dalam rig.waypoints, atau "idle"),
  // durationMs untuk berjalan ke sana, holdMs untuk berhenti sekejap di situ,
  // dan onArrive (efek visual - vault buka, kalkulator flicker, dll).
  //
  // Jumlah lebih kurang 5.5s untuk expense biasa (padan dengan actionDurationMs
  // default di watcher).
  // === Effect mapping ===
  // "effect" string yang datang dari backend (LLM decision atau fallback)
  // di-map ke fungsi visual yang sebenar di sini. Backend cuma hantar NAMA
  // effect (string), frontend yang tentukan macam mana effect tu kelihatan -
  // ini sengaja, supaya LLM tak perlu (dan tak boleh) terus manipulate Three.js
  // internals, cuma pilih dari "menu" effect yang kita sediakan.
  const EFFECT_HANDLERS = {
    vault_open: (rig) => vaultDoor(rig, true),
    vault_close: (rig) => vaultDoor(rig, false),
    calc_flicker: (rig) => calcFlicker(rig),
    dial_pulse: (rig) => dialPulse(rig),
  };

  // Efek: buka/tutup pintu vault (rotate doorPivot). Animator (dalam animate())
  // akan baca rig.vaultDoorTarget dan lerp doorPivot.rotation.y ke arah tu.
  function vaultDoor(rig, open) {
    if (!rig.vaultRef) return;
    rig.vaultDoorTarget = open ? -1.7 : 0; // radian, buka ke luar
  }
  // Efek: kalkulator "kira" - flicker display sekejap (warna berubah-ubah)
  function calcFlicker(rig) {
    if (!rig.calcRef) return;
    rig.calcFlickerUntil = performance.now() + 1200;
  }
  // Efek: visor flash warna tertentu sekejap (cth merah untuk "expense besar",
  // amber untuk "hutang baru"), lepas tu balik ke warna biasa.
  function visorFlash(rig, hexColor) {
    rig.visorFlashColor = hexColor;
    rig.visorFlashUntil = performance.now() + 1500;
  }
  // Efek: dial vault berkedip hijau (anggap "progress/payment")
  function dialPulse(rig) {
    if (!rig.vaultRef) return;
    rig.dialPulseUntil = performance.now() + 1800;
  }

  // === Bina action queue daripada satu "decision" (datang dari LLM via
  // watcher, ATAU fallback deterministic - kedua-dua guna struktur sama). ===
  // decision = { thought, mood, visorColor, moves: [{waypoint,durationMs,holdMs,effect}] }
  //
  // NOTA KESELAMATAN: walaupun backend (llmDecision.js) dah validate/clamp
  // nilai-nilai ni, kita ULANG semak waypoint di sini SEKALI LAGI sebelum
  // animate - defense in depth. Kalau ada waypoint yang frontend tak kenal
  // (cth backend version lama/baru tak sepadan), kita skip step tu dengan
  // selamat, bukan crash atau buat robot teleport ke (undefined, undefined).
  function buildSequenceFromDecision(rig, decision) {
    const sequence = decision.moves
      .filter((m) => rig.waypoints[m.waypoint])
      .map((m, i, arr) => ({
        to: m.waypoint,
        durationMs: m.durationMs,
        holdMs: m.holdMs,
        onArrive: (r) => {
          if (m.effect && EFFECT_HANDLERS[m.effect]) EFFECT_HANDLERS[m.effect](r);
          // Bubble: tunjuk "thought" LLM pada step PERTAMA (bila robot baru
          // mula bergerak), sembunyikan bila sampai balik ke idle (step akhir).
          if (i === 0) setSpeechBubble(r, decision.thought, moodToIcon(decision.mood));
          if (i === arr.length - 1 && m.waypoint === "idle") setSpeechBubble(r, null);
        },
      }));

    // Safety net frontend: kalau semua move kena filter keluar (semua
    // waypoint tak dikenali - sangat jarang berlaku), jangan biarkan sequence
    // kosong; terus letak satu step balik idle supaya robot tak "diam" je.
    if (sequence.length === 0) {
      sequence.push({ to: "idle", durationMs: 700, holdMs: 0 });
    }
    return sequence;
  }

  function moodToIcon(mood) {
    if (mood === "concerned" || mood === "alert") return "vault";
    if (mood === "pleased") return "payment";
    return "calc";
  }

  // Mula satu action sequence (dari decision LLM/fallback) untuk satu agent.
  // Kalau ada sequence lain sedang jalan, ia akan digantikan (decision baru menang).
  function runDecision(id, decision) {
    const rig = agentRigs[id];
    if (!rig || !decision) return;
    rig.actionQueue = buildSequenceFromDecision(rig, decision);
    rig.currentStep = null; // animate loop akan ambil step pertama pada frame seterusnya

    // Visor color pilihan LLM (cth merah utk "concerned", hijau utk "pleased")
    // dipakai sepanjang sequence ni jalan - guna mekanisme visorFlash sedia ada,
    // tapi dengan tempoh = jumlah keseluruhan sequence.
    if (decision.visorColor) {
      const totalMs = decision.moves.reduce((sum, m) => sum + m.durationMs + m.holdMs, 0);
      rig.visorFlashColor = decision.visorColor;
      rig.visorFlashUntil = performance.now() + Math.max(totalMs, 1000);
    }
  }

  function setAgentState(id, state, selected, decision) {
    const rig = agentRigs[id];
    if (!rig) return;
    rig.state = state;
    rig.selected = selected;
    // Bandingkan reference object decision - watcher hantar object BARU setiap
    // kali ada keputusan baru (termasuk null semasa "loading"), jadi
    // perbandingan reference cukup untuk detect "ini decision baru".
    if (decision && decision !== rig.lastDecision) {
      rig.lastDecision = decision;
      runDecision(id, decision);
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    const now = performance.now();

    Object.values(agentRigs).forEach((rig) => {
      const robot = rig.robot;
      const parts = robot.userData.parts;

      // === Action queue: gerakkan robot antara waypoint ikut sequence semasa ===
      if (rig.currentStep === null && rig.actionQueue.length > 0) {
        // Mula step seterusnya dalam queue
        const step = rig.actionQueue.shift();
        rig.currentStep = step;
        rig.stepStartedAt = now;
        rig.stepArrived = false;
      }
      if (rig.currentStep) {
        const step = rig.currentStep;
        const target = rig.waypoints[step.to] || rig.waypoints.idle;
        const elapsed = now - rig.stepStartedAt;
        const moveProgress = Math.min(1, elapsed / step.durationMs);

        if (!rig.moveStartPos) rig.moveStartPos = { x: rig.currentPos.x, z: rig.currentPos.z, face: rig.currentFace };
        if (moveProgress < 1) {
          // ease in-out ringkas
          const ease = moveProgress < 0.5 ? 2 * moveProgress * moveProgress : 1 - Math.pow(-2 * moveProgress + 2, 2) / 2;
          rig.currentPos.x = rig.moveStartPos.x + (target.x - rig.moveStartPos.x) * ease;
          rig.currentPos.z = rig.moveStartPos.z + (target.z - rig.moveStartPos.z) * ease;
        } else {
          rig.currentPos.x = target.x;
          rig.currentPos.z = target.z;
          if (!rig.stepArrived) {
            rig.stepArrived = true;
            rig.arrivedAt = now;
            if (step.onArrive) step.onArrive(rig);
          }
          const holdElapsed = now - rig.arrivedAt;
          if (holdElapsed >= (step.holdMs || 0)) {
            // step ni selesai - bersedia untuk step seterusnya pada frame depan
            rig.currentStep = null;
            rig.moveStartPos = null;
          }
        }
        // muka robot hadap arah waypoint semasa
        rig.currentFace = target.face;
      }

      // Apply posisi/face semasa ke robot mesh sebenar
      robot.position.x = rig.currentPos.x;
      robot.position.z = rig.currentPos.z;

      // Bubble ikut posisi x/z robot (height tetap, sebab bubbleGroup adalah
      // child rig bukan child robot - jadi tak ikut robot.rotation.y, kekal
      // sentiasa "tegak" tak kira robot tengah pusing arah mana)
      rig.bubbleGroup.position.x = rig.currentPos.x;
      rig.bubbleGroup.position.z = rig.currentPos.z;

      const active = rig.state !== "idle" && rig.state !== "unavailable";

      // bob (lebih halus bila tengah bergerak/beraksi, supaya tak clash dengan posisi)
      const targetY = active ? Math.sin(t * 2.4) * 0.05 + 0.05 : 0;
      robot.position.y += (targetY - robot.position.y) * 0.1;

      // visor glow intensity (+ flash warna sementara kalau ada)
      if (parts && parts.visorGlow) {
        const flashing = rig.visorFlashUntil && now < rig.visorFlashUntil;
        if (flashing) {
          parts.visorGlow.material.color.set(rig.visorFlashColor);
          parts.visorGlow.material.emissive.set(rig.visorFlashColor);
          parts.visorGlow.material.emissiveIntensity = 0.9;
        } else {
          if (rig.visorFlashUntil) {
            // baru habis flash - reset balik ke warna asal visor
            parts.visorGlow.material.color.set("#bff0ff");
            parts.visorGlow.material.emissive.set("#7fd8ff");
            rig.visorFlashUntil = null;
          }
          const target = rig.state === "unavailable" ? 0.05 : active ? 0.7 + Math.sin(t * 3) * 0.25 : 0.35;
          parts.visorGlow.material.emissiveIntensity += (target - parts.visorGlow.material.emissiveIntensity) * 0.1;
        }
      }
      // antenna pulse when logging/working/thinking
      if (parts && parts.tip) {
        const pulsing = rig.state === "logging" || rig.state === "working" || rig.state === "thinking";
        const target = pulsing ? 0.4 + Math.abs(Math.sin(t * 5)) * 0.9 : 0.4;
        parts.tip.material.emissiveIntensity += (target - parts.tip.material.emissiveIntensity) * 0.15;
      }

      // selected: gentle full-rig spin offset (subtle yaw wobble)
      const baseYaw = rig.selected ? Math.sin(t * 1.5) * 0.08 : 0;
      robot.rotation.y += ((rig.currentFace + baseYaw) - robot.rotation.y) * 0.12;

      // === Furniture effects ===
      // Vault door: lerp rotation ke target (dibuka/ditutup oleh vaultDoor())
      if (rig.vaultRef && rig.vaultRef.userData.doorPivot) {
        const doorPivot = rig.vaultRef.userData.doorPivot;
        const targetRot = rig.vaultDoorTarget || 0;
        doorPivot.rotation.y += (targetRot - doorPivot.rotation.y) * 0.15;

        // dial pulse hijau (anggap "payment progress")
        if (rig.vaultRef.userData.dialDot) {
          if (rig.dialPulseUntil && now < rig.dialPulseUntil) {
            rig.vaultRef.userData.dialDot.material.emissiveIntensity = 0.5 + Math.abs(Math.sin(now / 120)) * 1.2;
          } else {
            rig.vaultRef.userData.dialDot.material.emissiveIntensity = 0.7;
          }
        }
      }
      // Calculator display flicker (anggap "tengah kira")
      if (rig.calcRef && rig.calcRef.userData.display) {
        const flickering = rig.calcFlickerUntil && now < rig.calcFlickerUntil;
        rig.calcRef.userData.display.material.emissiveIntensity = flickering
          ? 0.3 + Math.abs(Math.sin(now / 70)) * 1.0
          : 0.5;
      }
    });

    if (controls) controls.update();
    renderer.render(scene, camera);
  }

  function start() {
    animate();
  }

  return { init, addAgent, setAgentState, start };
})();
