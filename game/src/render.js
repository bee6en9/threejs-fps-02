// Rendering: the three.js scene, the actor meshes, tracers, impact sparks,
// the weapon viewmodel and the sky. The simulation never touches three.js
// objects directly; this module reads the central state once per frame and
// moves the meshes to match it.
import * as THREE from 'three';

const TRACER_POOL = 24;
const PARTICLE_MAX = 240;

function skyDome(scene) {
  const geo = new THREE.SphereGeometry(160, 16, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x2e415a) },
      mid: { value: new THREE.Color(0x5d7186) },
      low: { value: new THREE.Color(0xd98a3a) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 low; void main(){ float h = normalize(vP).y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.65, h)) : mix(low, mid, smoothstep(-0.08, 0.12, h)); gl_FragColor = vec4(c, 1.0); }',
  });
  const dome = new THREE.Mesh(geo, mat);
  scene.add(dome);
}

function nameSprite(name, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(name.toUpperCase(), 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(1.7, 0.42, 1);
  return sprite;
}

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x2e415a, 34, 110);
  const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 220);
  scene.add(camera);
  skyDome(scene);

  const hemi = new THREE.HemisphereLight(0x9db4cc, 0x3a2f22, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe8c0, 2.6);
  sun.position.set(28, 34, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 100;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  // Cool fill from the north-west so the shadow sides of the yard still read.
  const fill = new THREE.DirectionalLight(0x9ab8d8, 0.55);
  fill.position.set(-24, 20, -28);
  scene.add(fill);

  // Tracer pool: fading lines from muzzle to hit point.
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }

  // Impact sparks: one Points cloud, particles recycled by index.
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PARTICLE_MAX * 3);
  const pCol = new Float32Array(PARTICLE_MAX * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95 }));
  points.frustumCulled = false;
  for (let i = 0; i < PARTICLE_MAX; i += 1) pPos[i * 3 + 1] = -100;
  scene.add(points);
  const particles = [];
  for (let i = 0; i < PARTICLE_MAX; i += 1) particles.push({ life: 0, vx: 0, vy: 0, vz: 0 });
  let pNext = 0;

  // Muzzle flash light, shared and moved to whoever just fired.
  const flashLight = new THREE.PointLight(0xffc06a, 0, 9, 2);
  scene.add(flashLight);
  let flashLife = 0;

  // Bomb mesh: a charge box with a blinking beacon.
  const bombGroup = new THREE.Group();
  const bombBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.28, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.5 }),
  );
  bombBox.position.y = 0.14;
  bombBox.castShadow = true;
  const bombLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 3 }),
  );
  bombLamp.position.y = 0.34;
  bombGroup.add(bombBox, bombLamp);
  bombGroup.visible = false;
  scene.add(bombGroup);

  // Grenade meshes, one per live grenade.
  const grenadeMeshes = [];
  for (let i = 0; i < 4; i += 1) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.4, metalness: 0.7 }),
    );
    m.visible = false;
    scene.add(m);
    grenadeMeshes.push(m);
  }

  // Weapon viewmodel: boxes on the camera, kicked back by recoil.
  const viewmodel = new THREE.Group();
  const vmMat = new THREE.MeshStandardMaterial({ color: 0x4a5158, roughness: 0.5, metalness: 0.35 });
  const vmAccent = new THREE.MeshStandardMaterial({ color: 0x9a7a35, roughness: 0.5, metalness: 0.4 });
  const vmBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.5), vmMat);
  const vmBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.34), vmMat);
  vmBarrel.position.set(0, 0.02, -0.4);
  const vmGrip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.09), vmAccent);
  vmGrip.position.set(0, -0.13, 0.12);
  const vmMag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.1), vmMat);
  vmMag.position.set(0, -0.14, -0.05);
  viewmodel.add(vmBody, vmBarrel, vmGrip, vmMag);
  viewmodel.position.set(0.28, -0.24, -0.5);
  camera.add(viewmodel);

  const actorMeshes = new Map();
  const torsoMat = { us: 0x1f7a6e, them: 0xb3541e };
  const legMat = { us: 0x2c343c, them: 0x3a2f28 };

  function createActorMesh(actor) {
    const group = new THREE.Group();
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.62, 0.3),
      new THREE.MeshStandardMaterial({ color: torsoMat[actor.team], roughness: 0.8 }),
    );
    torso.position.y = 1.05;
    torso.castShadow = true;
    const vest = new THREE.Mesh(
      new THREE.BoxGeometry(0.54, 0.3, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x1a1e22, roughness: 0.85 }),
    );
    vest.position.y = 1.08;
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.3, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.8 }),
    );
    head.position.y = 1.52;
    head.castShadow = true;
    const helmet = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.14, 0.34),
      new THREE.MeshStandardMaterial({ color: actor.team === 'us' ? 0x2dd4bf : 0xfb923c, roughness: 0.5, metalness: 0.3 }),
    );
    helmet.position.y = 1.66;
    const legL = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.72, 0.22),
      new THREE.MeshStandardMaterial({ color: legMat[actor.team], roughness: 0.85 }),
    );
    legL.position.set(-0.14, 0.36, 0);
    const legR = legL.clone();
    legR.position.x = 0.14;
    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.1, 0.62),
      new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.4, metalness: 0.6 }),
    );
    gun.position.set(0.2, 1.18, -0.3);
    const tag = nameSprite(actor.name, actor.team === 'us' ? '#2dd4bf' : '#fb923c');
    tag.position.y = 1.95;
    group.add(torso, vest, head, helmet, legL, legR, gun, tag);
    group.userData = { legL, legR, gun, tag };
    scene.add(group);
    return group;
  }

  function spawnSparks(pos, n, color, speed) {
    for (let k = 0; k < n; k += 1) {
      const i = pNext;
      pNext = (pNext + 1) % PARTICLE_MAX;
      const p = particles[i];
      p.life = 0.35 + Math.random() * 0.25;
      pPos[i * 3] = pos.x;
      pPos[i * 3 + 1] = pos.y;
      pPos[i * 3 + 2] = pos.z;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * speed;
      p.vx = Math.cos(a) * speed * (0.4 + Math.random() * 0.6);
      p.vy = up;
      p.vz = Math.sin(a) * speed * (0.4 + Math.random() * 0.6);
      pCol[i * 3] = color[0];
      pCol[i * 3 + 1] = color[1];
      pCol[i * 3 + 2] = color[2];
    }
    pGeo.attributes.color.needsUpdate = true;
  }

  function addTracer(from, to) {
    let slot = tracers[0];
    for (const t of tracers) if (t.life <= 0) { slot = t; break; }
    const attr = slot.line.geometry.attributes.position;
    attr.array[0] = from.x; attr.array[1] = from.y; attr.array[2] = from.z;
    attr.array[3] = to.x; attr.array[4] = to.y; attr.array[5] = to.z;
    attr.needsUpdate = true;
    slot.line.material.opacity = 0.9;
    slot.life = 0.09;
  }

  function step(dt, state, player) {
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
      }
    }
    for (let i = 0; i < PARTICLE_MAX; i += 1) {
      const p = particles[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy -= 9 * dt;
      pPos[i * 3] += p.vx * dt;
      pPos[i * 3 + 1] += p.vy * dt;
      pPos[i * 3 + 2] += p.vz * dt;
      if (pPos[i * 3 + 1] < 0.02) { pPos[i * 3 + 1] = 0.02; p.vy *= -0.3; }
      if (p.life <= 0) pPos[i * 3 + 1] = -100;
    }
    pGeo.attributes.position.needsUpdate = true;
    if (flashLife > 0) {
      flashLife -= dt;
      flashLight.intensity = Math.max(0, flashLife * 60);
    }
    // Actors
    for (const actor of state.actors) {
      if (actor === player) continue;
      let mesh = actorMeshes.get(actor);
      if (!mesh) {
        mesh = createActorMesh(actor);
        actorMeshes.set(actor, mesh);
      }
      mesh.visible = actor.hp > 0 || actor.deadAt > state.phaseTime - 8;
      if (actor.hp <= 0) {
        mesh.position.set(actor.pos.x, 0.25, actor.pos.z);
        mesh.rotation.set(0, actor.yaw, Math.PI / 2);
        continue;
      }
      mesh.position.set(actor.pos.x, actor.pos.y, actor.pos.z);
      mesh.rotation.set(0, actor.yaw, 0);
      const crouchScale = actor.crouch ? 0.78 : 1;
      mesh.scale.set(1, crouchScale, 1);
      const phase = actor.stepPhase + state.phaseTime * (actor.moving ? 9 : 0);
      const swing = actor.moving ? Math.sin(phase) * 0.45 : 0;
      mesh.userData.legL.rotation.x = swing;
      mesh.userData.legR.rotation.x = -swing;
    }
    // Bomb
    if (state.bomb.state === 'planted' && state.bomb.position) {
      bombGroup.visible = true;
      bombGroup.position.set(state.bomb.position.x, 0, state.bomb.position.z);
      bombLamp.material.emissiveIntensity = (Math.sin(state.phaseTime * 8) > 0 ? 3 : 0.4);
    } else {
      bombGroup.visible = false;
    }
    // Grenades are synced by the caller through grenadeMeshes.
  }

  function flashAt(pos) {
    flashLight.position.set(pos.x, pos.y, pos.z);
    flashLife = 0.06;
    flashLight.intensity = 5;
  }

  function syncCamera(camera, player) {
    camera.position.set(player.pos.x, player.pos.y + (player.crouch ? 1.08 : 1.62), player.pos.z);
    camera.rotation.set(player.pitch + (player.recoilPitch ?? 0), player.yaw, 0, 'YXZ');
    const kick = (player.recoilPitch ?? 0) * 2;
    viewmodel.position.z = -0.5 + kick;
    viewmodel.position.y = -0.24 - (player.reloadDip ?? 0) * 0.12;
    viewmodel.rotation.x = kick * 0.6 + (player.reloadDip ?? 0) * 0.5;
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function clearActors() {
    for (const mesh of actorMeshes.values()) {
      scene.remove(mesh);
    }
    actorMeshes.clear();
  }

  return {
    renderer, scene, camera, step, syncCamera, onResize, clearActors,
    spawnSparks: (pos, n, color, speed) => spawnSparks(pos, n, color, speed),
    addTracer, flashAt,
    grenadeMeshes,
  };
}
