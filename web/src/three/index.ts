// 3D shade view (W8, laptop-only stretch). Loaded with import() from the 2D/3D toggle; three.js lives only here.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FeatureCollection, Position } from 'geojson';
import type { Graph, ShadeData, Route } from '../routing/index.ts';
import { localProjector, sunDirection } from './geo.ts';
import * as maplibregl from 'maplibre-gl'; // already loaded by the 2D map; the worker URL is set in main.ts

export interface ShadeViewData {
  bbox: Graph['bbox'];
  sun: ShadeData['sun']; // sun[slot] drives the DirectionalLight
  buildings: FeatureCollection; // buildings.geojson
  trees: FeatureCollection; // trees.geojson
}
export interface ShadeView {
  setSlot(slot: number): void; // 0..50; moves the sun and its shadows
  showRoutes(routes: { shortest: Route; shadiest: Route } | null): void; // null clears them
  dispose(): void;
}

// Same colours as the 2D legend in main.ts: redline shadiest, grey shortest.
const ROUTE_COLORS = { shortest: 0x6e7275, shadiest: 0xd7322c };
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'; // same as the 2D map in main.ts
const BASEMAP_PX = 2048; // ≈ 0.5 m per pixel over the ≈ 1 km ground
const DAY_SKY = new THREE.Color(0xdbeafe);
const NIGHT_SKY = new THREE.Color(0x1e293b);

export function createShadeView(el: HTMLElement, data: ShadeViewData): ShadeView {
  const toXZ = localProjector(data.bbox);
  const v2 = (p: Position) => {
    const [x, z] = toXZ(p);
    return new THREE.Vector2(x, -z); // shape space is (east, north); rotateX(−90°) below maps north to −Z
  };

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  el.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = DAY_SKY.clone();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
  camera.position.set(0, 260, 300); // from the south, looking north, like the 2D map
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // stay above the ground
  controls.maxDistance = 2000;
  const render = () => renderer.render(scene, camera);
  controls.addEventListener('change', render);

  const sky = new THREE.HemisphereLight(0xffffff, 0x94a3b8, 1.2);
  const sun = new THREE.DirectionalLight(0xfff4e0, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -400, right: 400, top: 400, bottom: -400, near: 1, far: 2000 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.3;
  scene.add(sky, sun, sun.target); // target stays at the origin

  // Ground: plain at first, then the same Positron basemap as 2D (streets, names, parks) once a hidden map draws it.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2),
    // Grey tint: full sun lands at about the basemap's own colours instead of blowing out to white.
    new THREE.MeshStandardMaterial({ color: 0xe0e0e0 }),
  );
  ground.receiveShadow = true;
  scene.add(ground);
  const groundMap = drapeBasemap(data.bbox, (tex, nw, se) => {
    const [x0, z0] = toXZ(nw);
    const [x1, z1] = toXZ(se);
    ground.geometry.dispose();
    ground.geometry = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); // keeps street names sharp at low angles
    ground.material.map = tex;
    ground.material.needsUpdate = true;
    render();
  });
  const credit = document.createElement('div');
  credit.className = 'three-credit';
  credit.textContent = '© OpenFreeMap © OpenStreetMap contributors';
  el.append(credit);

  // Buildings: each footprint extruded to height_m, merged into one mesh (one draw call for thousands).
  const blocks: THREE.BufferGeometry[] = [];
  for (const f of data.buildings.features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    const depth = Number(f.properties?.height_m) || 6;
    for (const [outer, ...holes] of polys) {
      if (!outer || outer.length < 4) continue;
      const shape = new THREE.Shape(outer.map(v2));
      shape.holes = holes.map((h) => new THREE.Path(h.map(v2)));
      blocks.push(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }).rotateX(-Math.PI / 2));
    }
  }
  if (blocks.length) {
    const merged = mergeGeometries(blocks);
    blocks.forEach((b) => b.dispose());
    if (merged) {
      const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: 0xcbd5e1 }));
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }

  // Trees: instanced trunk + canopy. Contract defaults: canopy radius 4 m, height 8 m.
  const trees = data.trees.features.flatMap((f) =>
    f.geometry.type === 'Point'
      ? [{ p: f.geometry.coordinates, r: Number(f.properties?.canopy_radius_m) || 4, h: Number(f.properties?.height_m) || 8 }]
      : [],
  );
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.25, 0.35, 1, 6).translate(0, 0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x8b5e3c }),
    trees.length,
  );
  const canopies = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: 0x4d7c0f, flatShading: true }),
    trees.length,
  );
  const m = new THREE.Matrix4();
  trees.forEach(({ p, r, h }, i) => {
    const [x, z] = toXZ(p);
    const cy = Math.max(h - r, r * 0.5); // canopy top at height_m; short wide trees sit on their trunk
    trunks.setMatrixAt(i, m.makeScale(1, cy, 1).setPosition(x, 0, z));
    canopies.setMatrixAt(i, m.makeScale(r, r, r).setPosition(x, cy, z));
  });
  for (const t of [trunks, canopies]) {
    t.castShadow = t.receiveShadow = true;
    scene.add(t);
  }

  // Routes: flat ribbons just above the ground; unlit so they read the same in sun and shade.
  const routeGroup = new THREE.Group();
  scene.add(routeGroup);
  function ribbon(coords: Position[], color: number, y: number) {
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < coords.length; i++) {
      const [x0, z0] = toXZ(coords[i - 1]);
      const [x1, z1] = toXZ(coords[i]);
      if (Math.hypot(x1 - x0, z1 - z0) > 0.01) path.add(new THREE.LineCurve3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 0, z1)));
    }
    if (!path.curves.length) return;
    // ~1 sample per metre keeps corners sharp; scaling Y after building flattens the tube whatever its twist.
    const geo = new THREE.TubeGeometry(path, Math.ceil(path.getLength()), 1.5, 6).scale(1, 0.3, 1).translate(0, y, 0);
    routeGroup.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color })));
  }
  function clearRoutes() {
    for (const o of routeGroup.children as THREE.Mesh[]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    routeGroup.clear();
  }

  const ro = new ResizeObserver(() => {
    const { clientWidth: w, clientHeight: h } = el;
    if (!w || !h) return; // hidden
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  });
  ro.observe(el);

  return {
    setSlot(slot) {
      const s = data.sun[slot];
      const up = !!s && s.alt_deg > 0;
      if (up) {
        const [x, y, z] = sunDirection(s.alt_deg, s.az_deg);
        sun.position.set(x * 1000, y * 1000, z * 1000);
      }
      sun.intensity = up ? 3 : 0;
      sky.intensity = up ? 1.2 : 0.3;
      (scene.background as THREE.Color).copy(up ? DAY_SKY : NIGHT_SKY);
      render();
    },
    showRoutes(routes) {
      clearRoutes();
      if (routes) {
        // A tie passes the same route twice: draw it once, in shadiest colours.
        if (routes.shortest.edges.join() !== routes.shadiest.edges.join()) ribbon(routes.shortest.coords, ROUTE_COLORS.shortest, 0.5);
        ribbon(routes.shadiest.coords, ROUTE_COLORS.shadiest, 0.7); // a bit higher so shared streets show shadiest
      }
      render();
    },
    dispose() {
      ro.disconnect();
      groundMap.cancel();
      ground.material.map?.dispose();
      credit.remove();
      controls.dispose();
      clearRoutes();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/** Renders the 2D basemap for the bbox plus ≈ 200 m in a hidden MapLibre map, then hands back a texture and its corners. */
function drapeBasemap(bbox: ShadeViewData['bbox'], done: (tex: THREE.CanvasTexture, nw: Position, se: Position) => void) {
  const [w, s, e, n] = bbox;
  const padLon = (e - w) / 3, padLat = (n - s) / 3; // the bbox is ≈ 600 m, so a third is ≈ 200 m
  const holder = document.createElement('div');
  holder.style.cssText = `position:fixed;left:0;top:0;width:${BASEMAP_PX}px;height:${BASEMAP_PX}px;visibility:hidden;pointer-events:none`;
  document.body.append(holder);
  const map = new maplibregl.Map({
    container: holder,
    style: BASEMAP_STYLE,
    bounds: [w - padLon, s - padLat, e + padLon, n + padLat],
    interactive: false,
    attributionControl: false,
    pixelRatio: 1,
    canvasContextAttributes: { preserveDrawingBuffer: true }, // so the finished frame can be copied out
  });
  map.on('load', () => map.getLayer('background') && map.setPaintProperty('background', 'background-color', '#fafaf8')); // as in 2D
  let live = true;
  const cancel = () => {
    if (!live) return;
    live = false;
    map.remove();
    holder.remove();
  };
  map.once('idle', () => {
    const copy = document.createElement('canvas');
    copy.width = copy.height = BASEMAP_PX;
    copy.getContext('2d')!.drawImage(map.getCanvas(), 0, 0, BASEMAP_PX, BASEMAP_PX);
    // Corners straight from MapLibre's own projection, so streets line up with the buildings.
    const nw = map.unproject([0, 0]), se = map.unproject([BASEMAP_PX, BASEMAP_PX]);
    cancel();
    const tex = new THREE.CanvasTexture(copy);
    tex.colorSpace = THREE.SRGBColorSpace;
    done(tex, [nw.lng, nw.lat], [se.lng, se.lat]);
  });
  return { cancel };
}
