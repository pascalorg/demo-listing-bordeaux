import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicNodeMaterial,
  Plane,
  Raycaster,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
} from 'three/webgpu';
import { color, float, uniform, uv } from 'three/tsl';
import { LAYERS, OFFICIAL_AREAS, ZONE_KEYS } from './config.js';

const pointInPolygon = ([x, y], polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crossing = ((yi > y) !== (yj > y))
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crossing) inside = !inside;
  }
  return inside;
};

function signedDistanceToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function interiorPoint(polygon) {
  let crossTotal = 0;
  let xTotal = 0;
  let yTotal = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    const cross = x1 * y2 - x2 * y1;
    crossTotal += cross;
    xTotal += (x1 + x2) * cross;
    yTotal += (y1 + y2) * cross;
  }
  const centroid = crossTotal
    ? [xTotal / (3 * crossTotal), yTotal / (3 * crossTotal)]
    : polygon[0];
  if (pointInPolygon(centroid, polygon)) return centroid;

  const xs = polygon.map(([x]) => x);
  const ys = polygon.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  let best = polygon[0];
  let bestDistance = -1;
  for (let gx = 0; gx <= 24; gx += 1) {
    for (let gy = 0; gy <= 24; gy += 1) {
      const point = [minX + ((maxX - minX) * gx) / 24, minY + ((maxY - minY) * gy) / 24];
      if (!pointInPolygon(point, polygon)) continue;
      let distance = Infinity;
      for (let i = 0; i < polygon.length; i += 1) {
        distance = Math.min(distance, signedDistanceToSegment(point, polygon[i], polygon[(i + 1) % polygon.length]));
      }
      if (distance > bestDistance) {
        best = point;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function borderGeometry(polygon) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const start = positions.length / 3;
    positions.push(a[0], 0.01, a[1], b[0], 0.01, b[1], b[0], 2.31, b[1], a[0], 2.31, a[1]);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  return geometry;
}

function makeMaterial(zoneColor, opacityNode) {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  });
  material.colorNode = color(new Color(zoneColor));
  material.opacityNode = opacityNode;
  return material;
}

export function createZones({ scene, model, labelLayer, i18n, invalidate }) {
  const globalOpacity = uniform(1);
  const records = [];
  let mode = 'off';
  let highlighted = null;
  let suppressed = false;
  let labelCurrent = 0;
  let labelTarget = 0;
  let animateLabelJump = false;
  let labelJumpFrom = 0;
  let labelJumpStarted = 0;
  let lastTickTime = performance.now();
  const pickRaycaster = new Raycaster();
  const pickPlane = new Plane(new Vector3(0, 1, 0), -0.02);
  const pickPoint = new Vector3();

  model.traverse((node) => {
    const data = node.userData;
    if (data?.kind !== 'zone' || !Array.isArray(data.polygon) || data.polygon.length < 3) return;
    const polygon = data.polygon.map(([x, z]) => [Number(x), Number(z)]);
    const localOpacity = uniform(0);
    // ShapeGeometry is XY; negating layout Z before the -90° rotation preserves
    // Pascal's direct layout[x,y] -> world[x,z] mapping.
    const shape = new Shape(polygon.map(([x, z]) => new Vector2(x, -z)));
    const floor = new Mesh(
      new ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, 0.02, 0),
      makeMaterial(data.color || '#d6ff6b', float(0.25).mul(globalOpacity).mul(localOpacity)),
    );
    const border = new Mesh(
      borderGeometry(polygon),
      makeMaterial(
        data.color || '#d6ff6b',
        float(0.36).mul(float(1).sub(uv().y)).mul(globalOpacity).mul(localOpacity),
      ),
    );
    for (const mesh of [floor, border]) {
      mesh.layers.set(LAYERS.zone);
      mesh.frustumCulled = false;
      mesh.raycast = () => {};
      scene.add(mesh);
    }
    const point = interiorPoint(polygon);
    const element = document.createElement('div');
    element.className = 'zone-label';
    labelLayer.append(element);
    records.push({
      id: data.pascalId || node.name,
      label: data.label || node.name,
      key: ZONE_KEYS[data.label],
      officialArea: OFFICIAL_AREAS[data.label] ?? null,
      polygon,
      footprintArea: Math.abs(polygon.reduce((sum, point, index) => {
        const next = polygon[(index + 1) % polygon.length];
        return sum + point[0] * next[1] - next[0] * point[1];
      }, 0)) / 2,
      position: new Vector3(point[0], 1, point[1]),
      localOpacity,
      current: 0,
      target: 0,
      collisionCurrent: 0,
      collisionTarget: 0,
      lifecycleOpacity: 0,
      meshes: [floor, border],
      element,
    });
  });

  function refreshCopy() {
    for (const record of records) {
      const translated = record.key ? i18n.dictionary().zones[record.key] : null;
      record.element.replaceChildren();
      const name = document.createElement('strong');
      name.textContent = translated?.name ?? record.label;
      const area = document.createElement('span');
      area.textContent = translated?.area ?? i18n.formatArea(record.officialArea);
      record.element.append(name, area);
    }
    invalidate();
  }

  function updateTargets() {
    for (const record of records) {
      const selected = highlighted === record.id || highlighted === record.label;
      if (suppressed || mode === 'off') record.target = 0;
      else if (mode === 'labels') record.target = 0;
      else if (mode === 'context') record.target = selected ? 0.72 : 0.4;
      else record.target = selected ? 1 : 0.3;
      record.element.classList.toggle('is-highlighted', selected);
    }
    invalidate();
  }

  function hideImmediately() {
    for (const record of records) {
      record.current = 0;
      record.target = 0;
      record.localOpacity.value = 0;
      record.collisionCurrent = 0;
      record.collisionTarget = 0;
      record.element.hidden = true;
      for (const mesh of record.meshes) mesh.visible = false;
    }
    invalidate();
  }

  refreshCopy();
  const unsubscribe = i18n.subscribe(refreshCopy);

  return {
    records,
    pick(camera, ndc) {
      pickRaycaster.setFromCamera(ndc, camera);
      if (!pickRaycaster.ray.intersectPlane(pickPlane, pickPoint)) return null;
      return records.find((record) => pointInPolygon([pickPoint.x, pickPoint.z], record.polygon)) ?? null;
    },
    highlight(id) {
      if (id === highlighted) return;
      highlighted = id;
      updateTargets();
    },
    setMode(next) {
      if (!['off', 'labels', 'context', 'active'].includes(next) || next === mode) return;
      mode = next;
      labelLayer.classList.toggle('is-floor-label-mode', mode === 'labels');
      updateTargets();
    },
    setLabelFade(next, animate = false) {
      const value = Math.max(0, Math.min(1, Number(next) || 0));
      if (Math.abs(value - labelTarget) < 0.0005) return;
      labelTarget = value;
      animateLabelJump = Boolean(animate);
      if (animateLabelJump) {
        labelJumpFrom = labelCurrent;
        labelJumpStarted = performance.now();
      } else {
        labelCurrent = labelTarget;
      }
      invalidate();
    },
    setSuppressed(next) {
      const value = Boolean(next);
      if (value === suppressed) return;
      suppressed = value;
      if (suppressed) hideImmediately();
      else updateTargets();
    },
    tick(delta) {
      let moving = false;
      const now = performance.now();
      const elapsed = Math.max(0, Math.min(0.1, (now - lastTickTime) / 1000));
      lastTickTime = now;
      if (animateLabelJump) {
        const progress = Math.max(0, Math.min(1, (now - labelJumpStarted) / 240));
        const eased = progress * progress * (3 - 2 * progress);
        labelCurrent = labelJumpFrom + (labelTarget - labelJumpFrom) * eased;
        animateLabelJump = progress < 1;
        if (!animateLabelJump) labelCurrent = labelTarget;
        moving = moving || animateLabelJump;
      }
      for (const record of records) {
        const next = record.current + (record.target - record.current) * Math.min(1, delta * 8);
        if (Math.abs(next - record.current) > 0.0005) moving = true;
        record.current = Math.abs(next - record.target) < 0.001 ? record.target : next;
        const nextCollision = record.collisionCurrent
          + (record.collisionTarget - record.collisionCurrent) * (1 - Math.exp(-elapsed * 12));
        if (Math.abs(nextCollision - record.collisionCurrent) > 0.0005) moving = true;
        record.collisionCurrent = Math.abs(nextCollision - record.collisionTarget) < 0.001
          ? record.collisionTarget
          : nextCollision;
        record.localOpacity.value = record.current;
        const geometryVisible = !suppressed && (mode === 'context' || mode === 'active');
        for (const mesh of record.meshes) mesh.visible = geometryVisible && record.current > 0.01;
      }
      return moving;
    },
    updateLabels(camera, width, height) {
      const projected = new Vector3();
      const placed = [];
      const candidates = [];
      for (const record of records) {
        const lifecycleOpacity = labelCurrent > 0
          ? labelCurrent
          : ((mode === 'context' || mode === 'active') ? record.current : 0);
        projected.copy(record.position).project(camera);
        const onScreen = projected.z < 1 && Math.abs(projected.x) < 1.08 && Math.abs(projected.y) < 1.08;
        const x = (projected.x * 0.5 + 0.5) * width;
        const y = (-projected.y * 0.5 + 0.5) * height;
        record.element.style.left = `${x}px`;
        record.element.style.top = `${y}px`;
        record.lifecycleOpacity = lifecycleOpacity;
        if (lifecycleOpacity > 0.001 && onScreen) {
          record.element.hidden = false;
          candidates.push({ record, x, y });
        } else {
          record.collisionTarget = 0;
        }
      }

      // Floor-label collision pass: larger rooms keep their centroid, while a
      // small room tries a few short nudges before fading out.
      candidates.sort((a, b) => b.record.footprintArea - a.record.footprintArea);
      const offsets = [[0, 0], [0, -34], [34, 0], [-34, 0], [0, 34]];
      for (const candidate of candidates) {
        const element = candidate.record.element;
        const halfWidth = Math.max(42, element.offsetWidth / 2);
        const halfHeight = Math.max(16, element.offsetHeight / 2);
        let chosen = null;
        for (const [dx, dy] of offsets) {
          const box = {
            left: candidate.x + dx - halfWidth - 5,
            right: candidate.x + dx + halfWidth + 5,
            top: candidate.y + dy - halfHeight - 4,
            bottom: candidate.y + dy + halfHeight + 4,
          };
          const overlaps = placed.some((other) => box.left < other.right && box.right > other.left
            && box.top < other.bottom && box.bottom > other.top);
          if (!overlaps) { chosen = { ...box, dx, dy }; break; }
        }
        if (!chosen) {
          candidate.record.collisionTarget = 0;
          continue;
        }
        candidate.record.collisionTarget = 1;
        element.style.left = `${candidate.x + chosen.dx}px`;
        element.style.top = `${candidate.y + chosen.dy}px`;
        placed.push(chosen);
      }
      for (const record of records) {
        record.element.style.opacity = String(Math.min(1, record.lifecycleOpacity * record.collisionCurrent));
        if (record.lifecycleOpacity <= 0.001 && record.collisionCurrent <= 0.001) {
          record.element.hidden = true;
        }
      }
    },
    dispose() {
      unsubscribe();
      labelLayer.classList.remove('is-floor-label-mode');
      for (const record of records) {
        record.element.remove();
        for (const mesh of record.meshes) {
          scene.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
        }
      }
    },
  };
}
