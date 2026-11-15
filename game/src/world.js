// Pier 9 — the map: a container yard after dark. One data table of boxes builds
// the geometry, the colliders and the ray targets, so the visuals, the movement
// and the shooting all agree about where the walls are. Two sites (Crane Bay
// west, Fuel Depot east), three lanes, a warehouse corridor through the middle.
import * as THREE from 'three';

export const MAP = {
  minX: -24, maxX: 24, minZ: -18, maxZ: 18,
  sites: [
    { id: 'A', name: 'CRANE BAY', x: -17, z: -11, r: 3.2 },
    { id: 'B', name: 'FUEL DEPOT', x: 17, z: -11, r: 3.2 },
  ],
  spawns: {
    us: [[-4, 15], [-1.5, 15.5], [1.5, 15.5], [4, 15]],
    them: [[-4, -15], [-1.5, -15.5], [1.5, -15.5], [4, -15]],
  },
};

// [cx, cz, w, d, h, material, y0] — y0 defaults to 0. Walls are h 4; crates 1.2-2.6;
// containers 2.6 high, stacked where listed.
const BOXES = [
  // Perimeter walls (with gaps left as the two lane mouths are inside, not in the wall)
  [-24, 0, 1, 36, 4.5, 'concrete', 0], [24, 0, 1, 36, 4.5, 'concrete', 0],
  [0, -18, 48, 1, 4.5, 'concrete', 0], [0, 18, 48, 1, 4.5, 'concrete', 0],
  // Warehouse block, north-centre: two roofed rooms and a sunlit centre hall.
  // Doors in the south wall (west x -11..-9, centre x 3..5, east x 9..11) —
  // the centre door sits off the mid axis on purpose, so no spawn-to-spawn
  // sightline runs down the middle of the map. The rooms join the hall
  // through the gaps south of the inner dividers.
  [-14.5, -13, 1, 8, 4, 'roof', 0], [14.5, -13, 1, 8, 4, 'roof', 0],
  [0, -16.5, 30, 1, 4, 'roof', 0],
  [-13, -9.5, 4, 1, 4, 'roof', 0], [-3, -9.5, 12, 1, 4, 'roof', 0],
  [7, -9.5, 4, 1, 4, 'roof', 0], [13, -9.5, 4, 1, 4, 'roof', 0],
  [-5.5, -14.5, 1, 5, 4, 'roof', 0], [5.5, -14.5, 1, 5, 4, 'roof', 0],
  [-10, -13, 9, 8, 0.4, 'roof', 4], [10, -13, 9, 8, 0.4, 'roof', 4],
  // Container stacks — the yard's cover
  [-18, 2, 6, 2.5, 2.6, 'containerRust', 0], [-18, 2, 6, 2.5, 2.6, 'containerTeal', 2.6],
  [-18, -4, 6, 2.5, 2.6, 'containerSlate', 0],
  [18, 2, 6, 2.5, 2.6, 'containerTeal', 0], [18, -4, 6, 2.5, 2.6, 'containerAmber', 0],
  [18, -4, 6, 2.5, 2.6, 'containerRust', 2.6],
  [-10, 2, 6, 2.5, 2.6, 'containerAmber', 0], [10, 2, 6, 2.5, 2.6, 'containerSlate', 0],
  [-7, -5, 6, 2.5, 2.6, 'containerTeal', 0], [7, -5, 6, 2.5, 2.6, 'containerRust', 0],
  [-16, 11, 2.5, 6, 2.6, 'containerRust', 0], [16, 11, 2.5, 6, 2.6, 'containerTeal', 0],
  // Crates — low cover you can shoot over while crouched behind
  [-3, 4, 2, 2, 1.2, 'wood', 0], [3, 4, 2, 2, 1.2, 'wood', 0],
  [-13, -8, 2.4, 1.2, 1.1, 'wood', 0], [13, -8, 2.4, 1.2, 1.1, 'wood', 0],
  [-21, 8, 2, 2, 1.2, 'wood', 0], [21, 8, 2, 2, 1.2, 'wood', 0],
  [-21, -14, 2, 2, 1.2, 'wood', 0], [21, -14, 2, 2, 1.2, 'wood', 0],
  // Crane legs at site A and a fuel tank at site B
  [-20, -13, 1, 1, 9, 'hazard', 0], [-14, -13, 1, 1, 9, 'hazard', 0],
  [-17, -13, 7, 1, 1, 'hazard', 9],
  [20, -13, 3, 3, 2.4, 'containerSlate', 0],
];

// Waypoints: node id -> [x, z]. Edges are an adjacency list of node ids. Every
// edge was checked against the box table: the straight line between its ends
// clears every collider, so a bot walking node to node never gets stuck.
const NODES = {
  spawnUS: [0, 15], spawnThem: [0, -15],
  midS: [0, 8], mid: [0, 0], midN: [4, -8],
  westS: [-13, 7], westM: [-14, 0], westN: [-14, -6],
  eastS: [13, 7], eastM: [14, 0], eastN: [14, -6],
  siteA: [-17, -11], siteB: [17, -11],
  whW: [-10, -13], whE: [10, -13], whC: [4, -13],
  hallS: [4, -10.5], gapW: [-7, -11], gapE: [7, -11],
  coverW: [-8, 5], coverE: [8, 5], coverWN: [-9, -3], coverEN: [9, -3],
};
const EDGES = {
  spawnUS: ['midS', 'westS', 'eastS'], spawnThem: ['whC'],
  midS: ['spawnUS', 'mid', 'westS', 'eastS', 'coverW', 'coverE'],
  mid: ['midS', 'midN', 'westM', 'eastM', 'coverWN', 'coverEN'],
  midN: ['mid', 'whC', 'westN', 'eastN', 'hallS'],
  westS: ['spawnUS', 'westM', 'midS'], westM: ['westS', 'westN', 'mid'],
  westN: ['westM', 'siteA', 'midN'],
  eastS: ['spawnUS', 'eastM', 'midS'], eastM: ['eastS', 'eastN', 'mid'],
  eastN: ['eastM', 'siteB', 'midN'],
  siteA: ['westN'], siteB: ['eastN'],
  whW: ['gapW'], whE: ['gapE'], whC: ['spawnThem', 'hallS'],
  hallS: ['whC', 'midN', 'gapW', 'gapE'],
  gapW: ['whW', 'hallS'], gapE: ['whE', 'hallS'],
  coverW: ['midS', 'westS', 'mid'], coverE: ['midS', 'eastS', 'mid'],
  coverWN: ['mid', 'westN'], coverEN: ['mid', 'eastN'],
};

export function aabbOf(box) {
  const [cx, cz, w, d, h, , y0 = 0] = box;
  return { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, minY: y0, maxY: y0 + h };
}

// Slab test: does segment p0->p1 hit the AABB? Returns the hit fraction or -1.
export function segmentAABB(p0, p1, b) {
  let tmin = 0;
  let tmax = 1;
  const d = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z];
  const o = [p0.x, p0.y, p0.z];
  const mn = [b.minX, b.minY, b.minZ];
  const mx = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return -1;
    } else {
      let t1 = (mn[i] - o[i]) / d[i];
      let t2 = (mx[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

export function losBlocked(p0, p1, colliders) {
  for (const b of colliders) {
    if (segmentAABB(p0, p1, b) >= 0) return true;
  }
  return false;
}

// Move a circle (radius r, feet y, height h) against the colliders, axis by
// axis so it slides along walls instead of sticking. Mutates pos in place.
export function moveCircle(pos, dx, dz, y, h, r, colliders) {
  pos.x += dx;
  for (const b of colliders) {
    if (y + h <= b.minY || y >= b.maxY) continue;
    if (pos.x + r > b.minX && pos.x - r < b.maxX && pos.z + r > b.minZ && pos.z - r < b.maxZ) {
      pos.x = dx > 0 ? b.minX - r : b.maxX + r;
    }
  }
  pos.z += dz;
  for (const b of colliders) {
    if (y + h <= b.minY || y >= b.maxY) continue;
    if (pos.x + r > b.minX && pos.x - r < b.maxX && pos.z + r > b.minZ && pos.z - r < b.maxZ) {
      pos.z = dz > 0 ? b.minZ - r : b.maxZ + r;
    }
  }
  pos.x = Math.max(MAP.minX + 0.6, Math.min(MAP.maxX - 0.6, pos.x));
  pos.z = Math.max(MAP.minZ + 0.6, Math.min(MAP.maxZ - 0.6, pos.z));
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(0.55, 0.65, 1.1, 10);

export function createWorld(scene, textures) {
  const colliders = [];
  const matCache = new Map();
  function materialFor(name, w, d) {
    const rx = Math.max(1, Math.min(6, Math.round(w / 2.5)));
    const rz = Math.max(1, Math.min(6, Math.round(d / 2.5)));
    const key = `${name}:${rx}:${rz}`;
    let mat = matCache.get(key);
    if (!mat) {
      const tex = textures[name].clone();
      tex.needsUpdate = true;
      tex.repeat.set(rx, rz);
      mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.08 });
      matCache.set(key, mat);
    }
    return mat;
  }

  const floorMat = new THREE.MeshStandardMaterial({ map: textures.asphalt, roughness: 0.95, metalness: 0.05 });
  textures.asphalt.repeat.set(12, 9);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(48, 36), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  for (const box of BOXES) {
    const [cx, cz, w, d, h, mat, y0 = 0] = box;
    const mesh = new THREE.Mesh(unitBox, materialFor(mat, w, d));
    mesh.position.set(cx, y0 + h / 2, cz);
    mesh.scale.set(w, h, d);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    colliders.push(aabbOf(box));
  }

  // Site decals + beacon poles
  for (const site of MAP.sites) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(site.r * 2, site.r * 2),
      new THREE.MeshStandardMaterial({ map: site.id === 'A' ? textures.site : textures.siteB, transparent: true, roughness: 0.9 }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(site.x, 0.02, site.z);
    decal.receiveShadow = true;
    scene.add(decal);
    const pole = new THREE.Mesh(unitCyl, new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.6, metalness: 0.6 }));
    pole.scale.set(0.5, 5, 0.5);
    pole.position.set(site.x + site.r + 0.8, 2.5, site.z + site.r + 0.8);
    pole.castShadow = true;
    scene.add(pole);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 10, 8),
      new THREE.MeshStandardMaterial({ color: site.id === 'A' ? 0xffb02e : 0x2dd4bf, emissive: site.id === 'A' ? 0xffb02e : 0x2dd4bf, emissiveIntensity: 2.2 }),
    );
    lamp.position.set(site.x + site.r + 0.8, 5.1, site.z + site.r + 0.8);
    scene.add(lamp);
    const light = new THREE.PointLight(site.id === 'A' ? 0xffb02e : 0x2dd4bf, 12, 14, 1.8);
    light.position.set(site.x, 3.4, site.z);
    scene.add(light);
  }

  // Barrels near the fuel depot
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x7a3b1e, roughness: 0.7, metalness: 0.35 });
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.05, 12);
  for (const [bx, bz] of [[14.5, -14], [15.4, -13.6], [19.5, -15.5], [20.4, -14.8]]) {
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(bx, 0.52, bz);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    scene.add(barrel);
    colliders.push({ minX: bx - 0.42, maxX: bx + 0.42, minZ: bz - 0.42, maxZ: bz + 0.42, minY: 0, maxY: 1.05 });
  }

  // Warm work lights inside the two roofed warehouse rooms.
  for (const lx of [-10, 10]) {
    const lamp = new THREE.PointLight(0xffc06a, 9, 12, 1.8);
    lamp.position.set(lx, 3.2, -13);
    scene.add(lamp);
  }

  return { colliders, nodes: NODES, edges: EDGES, sites: MAP.sites, spawns: MAP.spawns };
}

// Breadth-first shortest path over the nav graph; returns node ids.
export function findPath(edges, from, to) {
  if (from === to) return [from];
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length > 0) {
    const node = queue.shift();
    for (const next of edges[node] ?? []) {
      if (!prev.has(next)) {
        prev.set(next, node);
        if (next === to) {
          const path = [to];
          let cur = to;
          while (prev.get(cur) !== null) {
            cur = prev.get(cur);
            path.unshift(cur);
          }
          return path;
        }
        queue.push(next);
      }
    }
  }
  return [from, to];
}
