import { LAYOUT_URL } from '../config.js';
import { Vector2, Vector3 } from 'three/webgpu';

const EYE_HEIGHT = 1.6;
const START = new Vector3(-7.05, EYE_HEIGHT, 2.2);
const SIGHTLINE_LIMIT = 30;
const SIGHTLINE_DIRECTIONS = 1440;
const SIGHTLINE_CLEARANCE = 0.22;
const LOOK_SENSITIVITY = 0.002;
const PITCH_LIMIT = Math.PI / 2 - 0.05;
const WALK_SPEED = 2;
const RUN_SPEED = 5;
const ACCELERATION = 26;
const DECELERATION = 30;
const DOOR_REACH = 2.5;

function pointInPolygon([x, z], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if (((zi > z) !== (zj > z)) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function intersection(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const cross = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(cross) < 1e-8) return null;
  const ca = [c[0] - a[0], c[1] - a[1]];
  const t = (ca[0] * s[1] - ca[1] * s[0]) / cross;
  const u = (ca[0] * r[1] - ca[1] * r[0]) / cross;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}

function collisionData(layout, doors) {
  doors.registerLayout(layout);
  const nodes = layout.nodes;
  const zones = Object.values(nodes).filter((node) => node.type === 'zone').map((node) => node.polygon);
  const entrance = Object.values(nodes).find((node) => node.type === 'zone' && node.name === 'Entrée')?.polygon;
  const openings = new Map();
  for (const door of Object.values(nodes).filter((node) => node.type === 'door')) {
    const wall = nodes[door.wallId || door.parentId];
    if (!wall) continue;
    const dx = wall.end[0] - wall.start[0];
    const dz = wall.end[1] - wall.start[1];
    const length = Math.hypot(dx, dz);
    const along = Number(door.position?.[0] || 0);
    const center = [wall.start[0] + (dx / length) * along, wall.start[1] + (dz / length) * along];
    const list = openings.get(wall.id) || [];
    list.push({ id: door.id, center, half: Number(door.width || 0.8) / 2 + 0.12 });
    openings.set(wall.id, list);
  }
  const walls = Object.values(nodes).filter((node) => node.type === 'wall' && node.start && node.end);
  return { zones, walls, openings, entrance, doors };
}

function isPassable(data, from, to) {
  if (!data?.zones.some((polygon) => pointInPolygon(to, polygon))) return false;
  for (const wall of data.walls) {
    const hit = intersection(from, to, wall.start, wall.end);
    if (!hit) continue;
    const throughDoor = (data.openings.get(wall.id) || []).some(({ id, center, half }) => (
      data.doors.isPassable(id) && Math.hypot(hit[0] - center[0], hit[1] - center[1]) <= half
    ));
    if (!throughDoor) return false;
  }
  return true;
}

function pointSegmentDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const length2 = dx * dx + dz * dz;
  const t = length2
    ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / length2))
    : 0;
  return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dz);
}

function segmentDistance(a, b, c, d) {
  if (intersection(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}

function hasClearSightline(data, from, to) {
  if (!data?.zones.some((polygon) => pointInPolygon(to, polygon))) return false;
  return !data.walls.some((wall) => segmentDistance(from, to, wall.start, wall.end) < SIGHTLINE_CLEARANCE);
}

function clearDistance(data, origin, yaw) {
  const direction = [-Math.sin(yaw), -Math.cos(yaw)];
  const step = 0.05;
  let clear = 0;
  for (let distance = step; distance <= SIGHTLINE_LIMIT; distance += step) {
    const end = [origin[0] + direction[0] * distance, origin[1] + direction[1] * distance];
    if (hasClearSightline(data, origin, end)) {
      clear = distance;
      continue;
    }
    let low = clear;
    let high = distance;
    for (let index = 0; index < 12; index += 1) {
      const mid = (low + high) / 2;
      const probe = [origin[0] + direction[0] * mid, origin[1] + direction[1] * mid];
      if (hasClearSightline(data, origin, probe)) low = mid;
      else high = mid;
    }
    return low;
  }
  return SIGHTLINE_LIMIT;
}

function walkthroughSpawn(data) {
  const origin = [START.x, START.z];
  if (!data.entrance || !pointInPolygon(origin, data.entrance)) {
    throw new Error('Walkthrough spawn must be inside the Entrée zone');
  }
  let yaw = 0;
  let sightline = 0;
  for (let index = 0; index < SIGHTLINE_DIRECTIONS; index += 1) {
    const candidateYaw = -Math.PI + (index / SIGHTLINE_DIRECTIONS) * Math.PI * 2;
    const distance = clearDistance(data, origin, candidateYaw);
    if (distance > sightline) {
      yaw = candidateYaw;
      sightline = distance;
    }
  }
  const forwardProbe = [
    origin[0] - Math.sin(yaw) * 0.35,
    origin[1] - Math.cos(yaw) * 0.35,
  ];
  if (sightline <= 3) throw new Error(`Walkthrough spawn sightline is only ${sightline.toFixed(2)}m`);
  if (!isPassable(data, origin, forwardProbe)) throw new Error('Walkthrough first forward step is obstructed');
  return { position: START.clone(), yaw, sightline };
}

export function mountWalkthrough({ stage, viewer, i18n, story }) {
  const desktopPointer = matchMedia('(hover: hover) and (pointer: fine)');
  const canvas = viewer.renderer.domElement;
  const root = document.createElement('div');
  root.className = 'walkthrough-ui';
  root.id = 'walkthrough-ui';
  root.setAttribute('aria-hidden', 'true');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'walkthrough-close';
  const hint = document.createElement('p');
  hint.className = 'walkthrough-hint';
  const crosshair = document.createElement('span');
  crosshair.className = 'walkthrough-crosshair';
  crosshair.setAttribute('aria-hidden', 'true');
  const doorHint = document.createElement('p');
  doorHint.className = 'walkthrough-door-hint';
  doorHint.hidden = true;
  const forward = document.createElement('button');
  forward.type = 'button';
  forward.className = 'walkthrough-forward';
  root.append(close, crosshair, doorHint, hint, forward);
  document.body.append(root);

  const keys = new Set();
  const velocity = new Vector2();
  let data = null;
  let active = false;
  let savedScroll = 0;
  let yaw = 0;
  let pitch = -0.03;
  let dragging = false;
  let pointerX = 0;
  let pointerY = 0;
  let lastFrame = 0;
  let animation = 0;
  let forwardHeld = false;
  let spawn = null;
  let viewDirty = false;
  let pointerPaused = false;
  let wasPointerLocked = false;
  let focusedDoor = null;
  let focusedDoorState = '';
  let doorSnapshot = null;

  const dataReady = fetch(LAYOUT_URL).then((response) => response.json()).then((layout) => {
    data = collisionData(layout, viewer.doors);
    viewer.windows.registerLayout(layout);
    spawn = walkthroughSpawn(data);
    return data;
  });

  function rebuild() {
    close.textContent = `× ${i18n.t('ui.closeWalk')}`;
    close.setAttribute('aria-label', i18n.t('ui.closeWalk'));
    hint.replaceChildren();
    if (desktopPointer.matches) {
      const controls = [
        ['WASD', i18n.t('ui.walkMove')],
        ['⇧', i18n.t('ui.walkRun')],
        ['P', i18n.t(pointerPaused ? 'ui.walkResumePointer' : 'ui.walkFreePointer')],
        ['Esc', i18n.t('ui.walkExit')],
      ];
      if (document.pointerLockElement !== canvas) controls.unshift([i18n.t('ui.walkClick'), i18n.t('ui.walkLook')]);
      controls.forEach(([key, label]) => {
        const pill = document.createElement('span');
        pill.className = 'walkthrough-control-pill';
        const keyboard = document.createElement('kbd');
        keyboard.textContent = key;
        const text = document.createElement('span');
        text.textContent = label;
        pill.append(keyboard, text);
        hint.append(pill);
      });
    } else {
      hint.textContent = i18n.t('ui.walkHintMobile');
    }
    forward.textContent = `↑ ${i18n.t('ui.walkForward')}`;
    updateDoorHint(true);
  }

  function updateDoorHint(force = false) {
    const next = active && document.pointerLockElement === canvas
      ? viewer.doors.pick(viewer.camera, DOOR_REACH)
      : null;
    const nextState = next
      ? `${next.id}:${next.moving ? next.targetProgress : next.progress >= 0.5 ? 1 : 0}`
      : '';
    if (!force && focusedDoor === next && focusedDoorState === nextState) return;
    focusedDoor = next;
    focusedDoorState = nextState;
    const interactive = Boolean(focusedDoor);
    crosshair.classList.toggle('is-interactive', interactive);
    doorHint.hidden = !interactive;
    if (!interactive) {
      delete doorHint.dataset.doorId;
      return;
    }
    doorHint.dataset.doorId = focusedDoor.id;
    const open = focusedDoor.moving ? focusedDoor.targetProgress >= 0.5 : focusedDoor.progress >= 0.5;
    doorHint.replaceChildren();
    const keyboard = document.createElement('kbd');
    keyboard.textContent = 'E';
    const lead = document.createElement('span');
    lead.textContent = i18n.t('ui.walkDoorLead');
    const action = document.createElement('strong');
    action.textContent = `${i18n.t(open ? 'ui.walkDoorClose' : 'ui.walkDoorOpen')} ${i18n.t('ui.walkDoor')}`;
    doorHint.append(keyboard, lead, action);
  }

  function activateDoor() {
    if (!active || document.pointerLockElement !== canvas || !focusedDoor) return false;
    const changed = viewer.doors.toggle(focusedDoor.id, { duration: 0.45 });
    if (changed) {
      updateDoorHint(true);
      viewer.invalidate();
    }
    return changed;
  }

  function requestLock() {
    try {
      const result = canvas.requestPointerLock?.();
      result?.catch?.(() => {
        if (active) rebuild();
      });
      return result;
    } catch {
      if (active) rebuild();
      return null;
    }
  }

  function passable(from, to) {
    return isPassable(data, from, to);
  }

  function moveClamped(from, to) {
    if (passable(from, to)) return to;
    let low = 0;
    let high = 1;
    for (let index = 0; index < 9; index += 1) {
      const t = (low + high) / 2;
      const candidate = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
      if (passable(from, candidate)) low = t;
      else high = t;
    }
    return [from[0] + (to[0] - from[0]) * low, from[1] + (to[1] - from[1]) * low];
  }

  function aim() {
    const cp = Math.cos(pitch);
    const direction = new Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    viewer.camera.lookAt(viewer.camera.position.clone().add(direction));
    viewer.camera.updateMatrixWorld();
  }

  function frame(time) {
    if (!active) return;
    const delta = Math.min(0.05, lastFrame ? (time - lastFrame) / 1000 : 0);
    lastFrame = time;
    const forwardInput = keys.has('w') || keys.has('z') || keys.has('arrowup') || forwardHeld
      ? 1 : (keys.has('s') || keys.has('arrowdown') ? -1 : 0);
    const sideInput = keys.has('d') || keys.has('arrowright') ? 1 : (keys.has('a') || keys.has('q') || keys.has('arrowleft') ? -1 : 0);
    const desired = new Vector2(sideInput, forwardInput);
    if (desired.lengthSq() > 1) desired.normalize();
    if (desktopPointer.matches) {
      const hasInput = desired.lengthSq() > 0 && !pointerPaused;
      if (hasInput) {
        const speed = keys.has('shift') ? RUN_SPEED : WALK_SPEED;
        desired.multiplyScalar(speed);
        const reversing = velocity.lengthSq() > 0 && velocity.dot(desired) <= 0;
        const change = desired.sub(velocity).clampLength(
          0,
          ACCELERATION * (reversing ? 2 : 1) * delta,
        );
        velocity.add(change);
      } else {
        velocity.sub(velocity.clone().clampLength(0, DECELERATION * delta));
      }
    } else {
      const response = 1 - Math.exp(-delta * 7);
      velocity.lerp(desired.multiplyScalar(1.55), response);
      if (!forwardInput && !sideInput) velocity.multiplyScalar(Math.exp(-delta * 5));
    }
    let moved = false;
    if (velocity.lengthSq() > 0.0001) {
      const forwardX = -Math.sin(yaw);
      const forwardZ = -Math.cos(yaw);
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);
      const from = [viewer.camera.position.x, viewer.camera.position.z];
      const to = [
        from[0] + (rightX * velocity.x + forwardX * velocity.y) * delta,
        from[1] + (rightZ * velocity.x + forwardZ * velocity.y) * delta,
      ];
      const resolved = moveClamped(from, to);
      viewer.camera.position.set(resolved[0], EYE_HEIGHT, resolved[1]);
      moved = Math.hypot(resolved[0] - from[0], resolved[1] - from[1]) > 0.00001;
    }
    const cameraChanged = moved || viewDirty;
    const doorMoving = [...viewer.doors.records.values()].some((record) => record.moving);
    if (cameraChanged) {
      aim();
      viewDirty = false;
      viewer.invalidate();
    }
    updateDoorHint();
    if (cameraChanged || doorMoving || viewer.convergenceFramesRemaining > 0) {
      viewer.render(false, delta);
    }
    animation = requestAnimationFrame(frame);
  }

  async function enter() {
    if (active) return;
    if (desktopPointer.matches && document.pointerLockElement !== canvas) {
      requestLock();
    }
    await dataReady;
    savedScroll = scrollY;
    active = true;
    keys.clear();
    velocity.set(0, 0);
    yaw = spawn.yaw;
    pitch = -0.03;
    pointerPaused = false;
    wasPointerLocked = document.pointerLockElement === canvas;
    doorSnapshot = new Map([...viewer.doors.records].map(([id, record]) => [id, record.progress]));
    viewer.camera.position.copy(spawn.position);
    viewer.camera.fov = 60;
    viewer.camera.clearViewOffset();
    viewer.camera.updateProjectionMatrix();
    aim();
    viewDirty = false;
    viewer.zones.highlight(null);
    viewer.zones.setMode('off');
    viewer.zones.setSuppressed(true);
    viewer.resetDaylight();
    story.setSuspended(true);
    document.body.classList.add('walkthrough-active');
    root.classList.add('is-active');
    root.setAttribute('aria-hidden', 'false');
    lastFrame = 0;
    viewer.invalidate();
    viewer.render();
    rebuild();
    updateDoorHint(true);
    animation = requestAnimationFrame(frame);
  }

  function exit() {
    if (!active) return;
    active = false;
    cancelAnimationFrame(animation);
    keys.clear();
    forwardHeld = false;
    pointerPaused = false;
    focusedDoor = null;
    focusedDoorState = '';
    crosshair.classList.remove('is-interactive');
    doorHint.hidden = true;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    document.body.classList.remove('walkthrough-active');
    root.classList.remove('is-active');
    root.setAttribute('aria-hidden', 'true');
    if (doorSnapshot) {
      doorSnapshot.forEach((progress, id) => viewer.doors.scrub(id, progress));
      doorSnapshot = null;
    }
    window.scrollTo({ top: savedScroll, behavior: 'instant' });
    story.setSuspended(false);
    viewer.zones.setSuppressed(false);
    viewer.zones.setMode(story.browsing ? 'off' : (story.beat === 'plan' ? 'active' : (story.beat === 'floor' ? 'labels' : 'off')));
  }

  function keyDown(event) {
    if (!active) return;
    if (event.code === 'Escape' && document.pointerLockElement !== canvas) { event.preventDefault(); exit(); return; }
    if (event.code === 'KeyP' && desktopPointer.matches) {
      event.preventDefault();
      if (document.pointerLockElement === canvas) {
        pointerPaused = true;
        keys.clear();
        document.exitPointerLock();
      } else if (pointerPaused) {
        requestLock();
      }
      return;
    }
    if (event.code === 'KeyE' && activateDoor()) {
      event.preventDefault();
      return;
    }
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'z', 'q', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) {
      event.preventDefault();
      keys.add(key);
    }
  }
  function keyUp(event) { keys.delete(event.key.toLowerCase()); }
  function pointerDown(event) {
    if (!active || event.target.closest('.walkthrough-ui')) return;
    if (desktopPointer.matches) return;
    dragging = true;
    pointerX = event.clientX;
    pointerY = event.clientY;
    stage.setPointerCapture?.(event.pointerId);
  }
  function pointerMove(event) {
    if (!active) return;
    if (desktopPointer.matches) {
      if (event.type !== 'mousemove') return;
      if (document.pointerLockElement !== canvas) return;
      yaw -= event.movementX * LOOK_SENSITIVITY;
      pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch - event.movementY * LOOK_SENSITIVITY));
      viewDirty = true;
      return;
    }
    if (!dragging) return;
    yaw -= (event.clientX - pointerX) * 0.004;
    pitch = Math.max(-1.15, Math.min(1.15, pitch - (event.clientY - pointerY) * 0.003));
    pointerX = event.clientX;
    pointerY = event.clientY;
    viewDirty = true;
  }
  function pointerEnd() { dragging = false; }
  function canvasClick() {
    if (!active || !desktopPointer.matches) return;
    if (document.pointerLockElement === canvas) {
      activateDoor();
      return;
    }
    requestLock();
  }
  function pointerLockChange() {
    if (!active || !desktopPointer.matches) return;
    if (document.pointerLockElement === canvas) {
      wasPointerLocked = true;
      pointerPaused = false;
      rebuild();
      updateDoorHint(true);
    } else if (pointerPaused) {
      // Deliberately released with P; remain in walkthrough.
      rebuild();
      updateDoorHint(true);
    } else if (wasPointerLocked) {
      exit();
    } else {
      rebuild();
      updateDoorHint(true);
    }
  }

  const triggers = [...document.querySelectorAll('.walk-trigger')];
  triggers.forEach((button) => button.addEventListener('click', enter));
  close.addEventListener('click', exit);
  const forwardDown = (event) => { event.preventDefault(); forwardHeld = true; };
  const forwardUp = () => { forwardHeld = false; };
  forward.addEventListener('pointerdown', forwardDown);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => forward.addEventListener(type, forwardUp));
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  stage.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('click', canvasClick);
  stage.addEventListener('pointermove', pointerMove);
  document.addEventListener('mousemove', pointerMove);
  document.addEventListener('pointerlockchange', pointerLockChange);
  stage.addEventListener('pointerup', pointerEnd);
  stage.addEventListener('pointercancel', pointerEnd);
  rebuild();
  const unsubscribeLanguage = i18n.subscribe(rebuild);

  return {
    enter,
    exit,
    get active() { return active; },
    get spawnSightline() { return spawn?.sightline ?? null; },
    get spawnYaw() { return spawn?.yaw ?? null; },
    get pointerPaused() { return pointerPaused; },
    get pointerLocked() { return document.pointerLockElement === canvas; },
    setHeading(nextYaw) {
      yaw = Number(nextYaw) || 0;
      viewDirty = true;
    },
    destroy() {
      exit();
      unsubscribeLanguage();
      triggers.forEach((button) => button.removeEventListener('click', enter));
      close.removeEventListener('click', exit);
      forward.removeEventListener('pointerdown', forwardDown);
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => forward.removeEventListener(type, forwardUp));
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      stage.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('click', canvasClick);
      stage.removeEventListener('pointermove', pointerMove);
      document.removeEventListener('mousemove', pointerMove);
      document.removeEventListener('pointerlockchange', pointerLockChange);
      stage.removeEventListener('pointerup', pointerEnd);
      stage.removeEventListener('pointercancel', pointerEnd);
      root.remove();
    },
  };
}
