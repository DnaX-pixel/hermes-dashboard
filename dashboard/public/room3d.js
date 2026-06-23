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

    // chest panel (per agent)
    const chest = new THREE.Group();
    if (agent.id === "expensepilot") {
      const panel = boxMesh(0.5, 0.42, 0.08, mat("#1f3322"), 0, 0.9, 0.36);
      chest.add(panel);
      for (let i = 0; i < 3; i++) {
        chest.add(boxMesh(0.36 - i * 0.04, 0.05, 0.02, mat("#e8e4d8"), 0, 1.0 - i * 0.1, 0.41));
      }
    } else {
      // vents
      for (let i = 0; i < 3; i++) {
        chest.add(boxMesh(0.28, 0.05, 0.04, mat("#1b212b"), 0, 1.0 - i * 0.12, 0.38));
      }
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
    // door inset
    grp.add(boxMesh(1.1, 1.15, 0.08, mat("#8b97a8", { metalness: 0.6, roughness: 0.4 }), 0, 0.78, 0.6));
    // round door
    const door = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.12, 32), mat("#c4cdda", { metalness: 0.8, roughness: 0.25 }));
    door.rotation.x = Math.PI / 2;
    door.position.set(0, 0.78, 0.64);
    grp.add(door);
    // dial ring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.045, 12, 28), mat("#6b7686", { metalness: 0.7 }));
    ring.position.set(0, 0.78, 0.72);
    grp.add(ring);
    const dialDot = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 14), mat("#22c55e", { emissive: "#22c55e", emissiveIntensity: 0.7 }));
    dialDot.position.set(0, 0.78, 0.75);
    grp.add(dialDot);
    // handle (cross spokes)
    const spoke = mat("#5b6675", { metalness: 0.6 });
    grp.add(boxMesh(0.52, 0.08, 0.08, spoke, 0, 0.78, 0.74));
    grp.add(boxMesh(0.08, 0.52, 0.08, spoke, 0, 0.78, 0.74));
    // hinges on the side
    grp.add(boxMesh(0.1, 0.2, 0.1, mat("#6b7686", { metalness: 0.7 }), -0.6, 1.1, 0.5));
    grp.add(boxMesh(0.1, 0.2, 0.1, mat("#6b7686", { metalness: 0.7 }), -0.6, 0.45, 0.5));
    return grp;
  }

  function buildCalculator() {
    const grp = new THREE.Group();
    grp.add(boxMesh(0.34, 0.06, 0.44, mat("#475569", { roughness: 0.5 }), 0, 0.89, 0));
    grp.add(boxMesh(0.26, 0.02, 0.13, mat("#86efac", { emissive: "#22c55e", emissiveIntensity: 0.5 }), 0, 0.93, -0.13)); // display
    // button grid
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      grp.add(boxMesh(0.05, 0.02, 0.05, mat("#94a3b8"), -0.08 + c * 0.08, 0.93, 0.02 + r * 0.08));
    }
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
    if (agent.id === "expensepilot") {
      const vault = buildVault();
      vault.position.set(-1.9, 0, -1.4); // back-left, against the wall, clear of the desk
      furniture.add(vault);
      const calc = buildCalculator();
      calc.position.set(0.3, 0, 0); // on the desk top
      furniture.add(calc);
    } else {
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

    scene.add(rig);
    agentRigs[agent.id] = { group: rig, robot, state: "idle", selected: false, baseColor: agent.color };
  }

  function setAgentState(id, state, selected) {
    const rig = agentRigs[id];
    if (!rig) return;
    rig.state = state;
    rig.selected = selected;
  }

  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    Object.values(agentRigs).forEach((rig) => {
      const active = rig.state !== "idle" && rig.state !== "unavailable";
      const robot = rig.robot;
      const parts = robot.userData.parts;

      // bob
      const targetY = active ? Math.sin(t * 2.4) * 0.06 + 0.06 : 0;
      robot.position.y += (targetY - robot.position.y) * 0.1;

      // visor glow intensity
      if (parts && parts.visorGlow) {
        const target = rig.state === "unavailable" ? 0.05 : active ? 0.7 + Math.sin(t * 3) * 0.25 : 0.35;
        parts.visorGlow.material.emissiveIntensity += (target - parts.visorGlow.material.emissiveIntensity) * 0.1;
      }
      // antenna pulse when logging/working/thinking
      if (parts && parts.tip) {
        const pulsing = rig.state === "logging" || rig.state === "working" || rig.state === "thinking";
        const target = pulsing ? 0.4 + Math.abs(Math.sin(t * 5)) * 0.9 : 0.4;
        parts.tip.material.emissiveIntensity += (target - parts.tip.material.emissiveIntensity) * 0.15;
      }

      // selected: gentle full-rig spin offset (subtle yaw wobble)
      const baseYaw = rig.selected ? Math.sin(t * 1.5) * 0.08 : 0;
      robot.rotation.y += (((rig.group.userData.face || 0) + baseYaw) - robot.rotation.y) * 0.1;
    });

    if (controls) controls.update();
    renderer.render(scene, camera);
  }

  function start() {
    animate();
  }

  return { init, addAgent, setAgentState, start };
})();
