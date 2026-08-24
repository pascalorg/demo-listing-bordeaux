import { LAYOUT_URL, PHOTO_CAMS } from '../config.js';
import { Spherical, Vector2, Vector3 } from 'three/webgpu';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ROOM_COLORS = ['#e3a29b', '#efc56f', '#a9c98f', '#83bed0', '#b5a6d7', '#e0a9c2', '#9fc8ba', '#d6b68a', '#9ab7da'];
const PLAN_POLAR_MIN = 0.06;
const PLAN_POLAR_MAX = 1.38;
const PLAN_ORBIT_SENSITIVITY = 0.006;
const ROOM_CAMERAS = Object.freeze({
  chambre2: { eye: [-6.33, 1.07, 4.42], tgt: [-2.51, 0.88, 1.20], fov: 48 },
  entree: { eye: [-12.76, 5.43, 7.59], tgt: [-9.44, 2.39, 5.42], fov: 48 },
  salleDeau: { eye: [-6.72, 5.15, 5.60], tgt: [-8.91, 1.02, 7.38], fov: 48 },
  wc: { eye: [-9.36, 2.99, 5.98], tgt: [-10.46, -1.08, 8.67], fov: 48 },
  salleDeBains: { eye: [-7.45, 4.75, 4.67], tgt: [-9.08, 0.48, 2.66], fov: 48 },
  chambre3: { eye: [-0.72, 5.20, -1.00], tgt: [-3.96, 1.59, 0.20], fov: 48 },
});

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function cameraFor(record) {
  if (record.label === 'Séjour / Cuisine') return PHOTO_CAMS.sejour;
  if (record.label === 'Chambre 1') return PHOTO_CAMS.chambre1;
  if (record.label === 'Balcon') return { eye: [-1.28, 1.58, -3.72], tgt: [-1.32, 1.05, 0.1], fov: 66 };
  if (ROOM_CAMERAS[record.key]) return ROOM_CAMERAS[record.key];
  const { x, z } = record.position;
  return { eye: [x, 4.5, z + 2.4], tgt: [x, 0.55, z], fov: 48 };
}

function openingGeometry(opening, nodes) {
  const wall = nodes[opening.wallId || opening.parentId];
  if (!wall?.start || !wall?.end) return null;
  const dx = wall.end[0] - wall.start[0];
  const dz = wall.end[1] - wall.start[1];
  const length = Math.hypot(dx, dz);
  if (!length) return null;
  const ux = dx / length;
  const uz = dz / length;
  const along = Number(opening.position?.[0] || 0);
  const half = Number(opening.width || 0.8) / 2;
  const center = [wall.start[0] + ux * along, wall.start[1] + uz * along];
  const side = opening.side === 'back' ? -1 : 1;
  return {
    wall,
    length,
    along,
    half,
    ux,
    uz,
    nx: -uz * side,
    nz: ux * side,
    start: [center[0] - ux * half, center[1] - uz * half],
    end: [center[0] + ux * half, center[1] + uz * half],
  };
}

function wallSegments(wall, openings) {
  const dx = wall.end[0] - wall.start[0];
  const dz = wall.end[1] - wall.start[1];
  const length = Math.hypot(dx, dz);
  if (!length) return [];
  const ux = dx / length;
  const uz = dz / length;
  const gaps = openings
    .map((opening) => [
      Math.max(0, opening.along - opening.half - 0.025),
      Math.min(length, opening.along + opening.half + 0.025),
    ])
    .sort((a, b) => a[0] - b[0]);
  const spans = [];
  let cursor = 0;
  for (const [start, end] of gaps) {
    if (start > cursor + 0.001) spans.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < length - 0.001) spans.push([cursor, length]);
  return spans.map(([start, end]) => ({
    start: [wall.start[0] + ux * start, wall.start[1] + uz * start],
    end: [wall.start[0] + ux * end, wall.start[1] + uz * end],
  }));
}

function appendDoorMark(group, opening, geometry) {
  if (opening.doorType === 'pocket' || opening.doorType === 'sliding') {
    group.append(svgElement('line', {
      x1: geometry.start[0] + geometry.nx * 0.06,
      y1: geometry.start[1] + geometry.nz * 0.06,
      x2: geometry.end[0] + geometry.nx * 0.06,
      y2: geometry.end[1] + geometry.nz * 0.06,
      class: 'plan-door-leaf plan-door-pocket',
    }));
    return;
  }
  const hingeAtEnd = opening.hingesSide === 'right';
  const hinge = hingeAtEnd ? geometry.end : geometry.start;
  const closed = hingeAtEnd ? geometry.start : geometry.end;
  const width = geometry.half * 2;
  const open = [hinge[0] + geometry.nx * width, hinge[1] + geometry.nz * width];
  group.append(
    svgElement('line', {
      x1: hinge[0], y1: hinge[1], x2: open[0], y2: open[1], class: 'plan-door-leaf',
    }),
    svgElement('path', {
      d: `M ${closed[0]} ${closed[1]} A ${width} ${width} 0 0 ${hingeAtEnd ? 0 : 1} ${open[0]} ${open[1]}`,
      class: 'plan-door-arc',
    }),
  );
}

function appendWindowMark(group, geometry) {
  for (const offset of [-0.045, 0.045]) {
    group.append(svgElement('line', {
      x1: geometry.start[0] + geometry.nx * offset,
      y1: geometry.start[1] + geometry.nz * offset,
      x2: geometry.end[0] + geometry.nx * offset,
      y2: geometry.end[1] + geometry.nz * offset,
      class: 'plan-window-line',
    }));
  }
}

export function mountPlan({ stage, viewer, i18n, story, copyLayer }) {
  const mobileQuery = matchMedia('(max-width: 900px)');
  const scrim = document.createElement('button');
  scrim.type = 'button';
  scrim.className = 'plan-scrim';
  scrim.tabIndex = -1;
  scrim.setAttribute('aria-hidden', 'true');

  const panel = document.createElement('aside');
  panel.className = 'plan-panel';
  panel.id = 'plan-panel';
  panel.setAttribute('aria-hidden', 'true');
  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'plan-toggle';
  openButton.setAttribute('aria-controls', panel.id);
  openButton.setAttribute('aria-expanded', 'false');
  const toolbar = document.createElement('div');
  toolbar.className = 'plan-toolbar';
  const title = document.createElement('strong');
  title.className = 'plan-title';
  title.id = 'plan-title';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'plan-close';
  toolbar.append(title, closeButton);
  const drawing = document.createElement('div');
  drawing.className = 'plan-drawing';
  const miniButton = document.createElement('button');
  miniButton.type = 'button';
  miniButton.className = 'plan-mini-open';
  const hint = document.createElement('p');
  hint.className = 'plan-hint';
  const mobileHint = document.createElement('p');
  mobileHint.className = 'plan-mobile-hint';
  const roomAction = document.createElement('button');
  roomAction.type = 'button';
  roomAction.className = 'plan-room-action';
  roomAction.hidden = true;
  const returnButton = document.createElement('button');
  returnButton.type = 'button';
  returnButton.className = 'plan-return';
  panel.append(openButton, toolbar, drawing, miniButton, hint, mobileHint, roomAction, returnButton);
  document.body.append(scrim, panel);
  let active = false;
  let browsing = false;
  let expanded = false;
  let walking = false;
  let visible = false;
  let selectedRecord = null;
  let lastMobileBottom = -1;
  let cameraCone = null;
  let cameraDot = null;
  const cameraDirection = new Vector3();
  const orbitDirection = new Vector3();
  const orbitOffset = new Vector3();
  const orbitPivot = new Vector3();
  const orbitSpherical = new Spherical();
  const pickNdc = new Vector2();
  let orbitActive = false;
  let orbitContext = null;
  let orbitInitialized = false;
  let orbitMinimumPhi = PLAN_POLAR_MIN;
  let orbitPointer = null;
  let orbitX = 0;
  let orbitY = 0;
  let orbitTravel = 0;
  let orbitDragged = false;
  let planHoveredRecord = null;
  let modelHoveredRecord = null;

  function initializeOrbit(camera, target) {
    orbitPivot.copy(target);
    if (orbitContext === 'plan') {
      orbitDirection.subVectors(target, camera.position).normalize();
      const distanceToCenterHeight = (viewer.center.y - camera.position.y) / orbitDirection.y;
      if (Number.isFinite(distanceToCenterHeight) && distanceToCenterHeight > 0) {
        orbitPivot.copy(camera.position).addScaledVector(orbitDirection, distanceToCenterHeight);
      }
    }
    orbitSpherical.setFromVector3(orbitOffset.subVectors(camera.position, orbitPivot));
    orbitMinimumPhi = Math.min(PLAN_POLAR_MIN, orbitSpherical.phi);
    orbitSpherical.phi = Math.max(orbitMinimumPhi, Math.min(PLAN_POLAR_MAX, orbitSpherical.phi));
    orbitInitialized = true;
  }

  function applyPlanOrbit({ camera, target }) {
    if (!orbitActive || !orbitInitialized || (orbitContext === 'room' && story.browseFlying)) return;
    orbitOffset.setFromSpherical(orbitSpherical);
    camera.position.copy(orbitPivot).add(orbitOffset);
    target.copy(orbitPivot);
    camera.lookAt(orbitPivot);
  }

  function setOrbitActive(next, context = null) {
    const enabled = Boolean(next);
    if (orbitActive === enabled && orbitContext === context) return;
    orbitActive = enabled;
    orbitContext = enabled ? context : null;
    orbitInitialized = false;
    orbitPointer = null;
    orbitDragged = false;
    document.body.classList.toggle('plan-orbit-active', orbitActive);
    story.setLookLocked('plan-orbit', orbitActive);
    story.setCameraOverride(orbitActive ? applyPlanOrbit : null);
    viewer.invalidate();
  }

  function orbitPointerDown(event) {
    if (!orbitActive || event.button !== 0 || (orbitContext === 'room' && story.browseFlying)) return;
    orbitPointer = event.pointerId;
    orbitX = event.clientX;
    orbitY = event.clientY;
    orbitTravel = 0;
    orbitDragged = false;
    setModelHoveredRecord(null);
    if (!orbitInitialized) initializeOrbit(viewer.camera, story.copyCameraTarget(new Vector3()));
    stage.setPointerCapture?.(event.pointerId);
  }

  function orbitPointerMove(event) {
    if (!orbitActive) return;
    if (event.pointerId !== orbitPointer) {
      updateModelHover(event);
      return;
    }
    const deltaX = event.clientX - orbitX;
    const deltaY = event.clientY - orbitY;
    orbitTravel += Math.hypot(deltaX, deltaY);
    orbitDragged ||= orbitTravel > 4;
    orbitSpherical.theta -= deltaX * PLAN_ORBIT_SENSITIVITY;
    orbitSpherical.phi = Math.max(
      orbitMinimumPhi,
      Math.min(PLAN_POLAR_MAX, orbitSpherical.phi + deltaY * PLAN_ORBIT_SENSITIVITY),
    );
    orbitX = event.clientX;
    orbitY = event.clientY;
    viewer.invalidate();
  }

  function orbitPointerEnd(event) {
    if (event.pointerId !== orbitPointer) return;
    const clickRecord = event.type === 'pointerup' && !orbitDragged && orbitContext === 'plan'
      ? recordAtPointer(event)
      : null;
    orbitPointer = null;
    stage.releasePointerCapture?.(event.pointerId);
    if (clickRecord) flyToRecord(clickRecord);
    else updateModelHover(event);
  }

  function refreshHover() {
    panel.querySelectorAll('.plan-zone').forEach((group) => {
      group.classList.toggle('is-model-hovered', group.dataset.zoneKey === modelHoveredRecord?.key);
    });
    viewer.zones.highlight(selectedRecord?.id || planHoveredRecord?.id || modelHoveredRecord?.id || null);
  }

  function setPlanHoveredRecord(record) {
    planHoveredRecord = record;
    refreshHover();
  }

  function setModelHoveredRecord(record) {
    if (modelHoveredRecord?.id === record?.id) return;
    modelHoveredRecord = record;
    refreshHover();
  }

  function recordAtPointer(event) {
    if (!active || browsing || walking || expanded || event.pointerType !== 'mouse') return null;
    const bounds = stage.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom) return null;
    pickNdc.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    return viewer.zones.pick(viewer.camera, pickNdc);
  }

  function updateModelHover(event) {
    if (orbitPointer != null) return;
    if (event.type === 'pointerleave') {
      setModelHoveredRecord(null);
      return;
    }
    setModelHoveredRecord(recordAtPointer(event));
  }

  function syncMobileAnchor() {
    if (!mobileQuery.matches || !active) return;
    const card = copyLayer.querySelector(".beat-card[data-beat='plan']");
    if (!card) return;
    const bottom = Math.max(12, innerHeight - card.getBoundingClientRect().top + 8);
    if (Math.abs(bottom - lastMobileBottom) < 0.5) return;
    lastMobileBottom = bottom;
    panel.style.setProperty('--plan-mobile-bottom', `${bottom}px`);
    scrim.style.setProperty('--plan-mobile-bottom', `${bottom}px`);
  }

  function clearSelection() {
    selectedRecord = null;
    panel.querySelectorAll('.plan-zone.is-selected').forEach((zone) => zone.classList.remove('is-selected'));
    roomAction.hidden = true;
    refreshHover();
  }

  function selectRecord(record, group) {
    selectedRecord = record;
    panel.querySelectorAll('.plan-zone.is-selected').forEach((zone) => zone.classList.remove('is-selected'));
    group.classList.add('is-selected');
    refreshHover();
    roomAction.hidden = false;
    const name = i18n.dictionary().zones[record.key]?.name || record.label;
    roomAction.textContent = `${i18n.t('ui.planEnter')} ${name} →`;
  }

  function flyToRecord(record) {
    setPlanHoveredRecord(null);
    setModelHoveredRecord(null);
    clearSelection();
    setExpanded(false);
    story.flyTo(cameraFor(record));
  }

  function setExpanded(next) {
    const nextExpanded = Boolean(next && visible && !walking && !browsing);
    if (expanded === nextExpanded) return;
    expanded = nextExpanded;
    panel.classList.toggle('is-expanded', expanded);
    scrim.classList.toggle('is-active', expanded);
    document.body.classList.toggle('plan-overlay-open', expanded);
    openButton.setAttribute('aria-expanded', String(expanded));
    scrim.setAttribute('aria-hidden', String(!expanded));
    if (expanded) {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-labelledby', title.id);
      requestAnimationFrame(() => closeButton.focus({ preventScroll: true }));
    } else {
      panel.removeAttribute('role');
      panel.removeAttribute('aria-modal');
      panel.removeAttribute('aria-labelledby');
      clearSelection();
    }
  }

  function rebuildLabels() {
    hint.textContent = i18n.t('ui.planHint');
    openButton.textContent = `${i18n.t('ui.planOpen')} ↑`;
    title.textContent = i18n.dictionary().beats.plan.nav;
    closeButton.textContent = `× ${i18n.t('ui.planClose')}`;
    closeButton.setAttribute('aria-label', i18n.t('ui.planClose'));
    scrim.setAttribute('aria-label', i18n.t('ui.planClose'));
    mobileHint.textContent = i18n.t('ui.planTapHint');
    miniButton.setAttribute('aria-label', i18n.t('ui.planOpen'));
    returnButton.textContent = `← ${i18n.t('ui.planReturn')}`;
    panel.querySelector('svg')?.setAttribute('aria-label', i18n.dictionary().beats.plan.nav);
    panel.querySelectorAll('[data-zone-key]').forEach((group) => {
      const record = viewer.zones.records.find((entry) => entry.key === group.dataset.zoneKey);
      if (!record) return;
      const translated = i18n.dictionary().zones[record.key];
      group.querySelector('.plan-name').textContent = translated?.name || record.label;
      group.querySelector('.plan-area').textContent = i18n.formatArea(record.officialArea);
    });
    if (selectedRecord) {
      const name = i18n.dictionary().zones[selectedRecord.key]?.name || selectedRecord.label;
      roomAction.textContent = `${i18n.t('ui.planEnter')} ${name} →`;
    }
  }

  async function build() {
    const layout = await fetch(LAYOUT_URL).then((response) => response.json());
    const nodes = layout.nodes;
    const records = viewer.zones.records;
    const points = records.flatMap((record) => record.polygon);
    const xs = points.map(([x]) => x);
    const zs = points.map(([, z]) => z);
    const minX = Math.min(...xs) - 0.45;
    const maxX = Math.max(...xs) + 0.45;
    const minZ = Math.min(...zs) - 0.45;
    const maxZ = Math.max(...zs) + 0.45;
    const svg = svgElement('svg', {
      viewBox: `${minX} ${minZ} ${maxX - minX} ${maxZ - minZ}`,
      role: 'img',
      'aria-label': i18n.dictionary().beats.plan.nav,
      preserveAspectRatio: 'xMidYMid meet',
    });
    svg.append(svgElement('rect', {
      x: minX, y: minZ, width: maxX - minX, height: maxZ - minZ, class: 'plan-paper',
    }));

    const roomLayer = svgElement('g', { class: 'plan-rooms' });
    records.forEach((record, index) => {
      const group = svgElement('g', { class: 'plan-zone', tabindex: '0', role: 'button' });
      group.dataset.zoneKey = record.key || '';
      group.style.setProperty('--room-fill', ROOM_COLORS[index % ROOM_COLORS.length]);
      const polygon = svgElement('polygon', { points: record.polygon.map((point) => point.join(',')).join(' ') });
      const name = svgElement('text', { x: record.position.x, y: record.position.z - 0.08, class: 'plan-name' });
      const area = svgElement('text', { x: record.position.x, y: record.position.z + 0.27, class: 'plan-area' });
      group.append(polygon, name, area);
      const enter = () => {
        if (!mobileQuery.matches) setPlanHoveredRecord(record);
      };
      const leave = () => {
        if (!mobileQuery.matches && planHoveredRecord?.id === record.id) setPlanHoveredRecord(null);
      };
      group.addEventListener('pointerenter', enter);
      group.addEventListener('pointerleave', leave);
      group.addEventListener('focus', enter);
      group.addEventListener('blur', leave);
      group.addEventListener('click', () => {
        if (mobileQuery.matches) {
          if (selectedRecord?.id !== record.id) selectRecord(record, group);
          else flyToRecord(record);
          return;
        }
        flyToRecord(record);
      });
      group.addEventListener('keydown', (event) => {
        if (!['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        group.click();
      });
      roomLayer.append(group);
    });
    svg.append(roomLayer);

    const openingsByWall = new Map();
    const openingRecords = [];
    for (const opening of Object.values(nodes).filter((node) => node.type === 'door' || node.type === 'window')) {
      const geometry = openingGeometry(opening, nodes);
      if (!geometry) continue;
      openingRecords.push({ opening, geometry });
      const list = openingsByWall.get(geometry.wall.id) || [];
      list.push(geometry);
      openingsByWall.set(geometry.wall.id, list);
    }

    const wallLayer = svgElement('g', { class: 'plan-walls', 'aria-hidden': 'true' });
    for (const wall of Object.values(nodes).filter((node) => node.type === 'wall' && node.start && node.end)) {
      for (const segment of wallSegments(wall, openingsByWall.get(wall.id) || [])) {
        wallLayer.append(svgElement('line', {
          x1: segment.start[0], y1: segment.start[1], x2: segment.end[0], y2: segment.end[1],
        }));
      }
    }
    svg.append(wallLayer);

    const openingLayer = svgElement('g', { class: 'plan-openings', 'aria-hidden': 'true' });
    for (const { opening, geometry } of openingRecords) {
      if (opening.type === 'door') appendDoorMark(openingLayer, opening, geometry);
      else appendWindowMark(openingLayer, geometry);
    }
    svg.append(openingLayer);

    const cameraLayer = svgElement('g', { class: 'plan-camera', 'aria-hidden': 'true' });
    cameraCone = svgElement('path', { class: 'plan-camera-cone' });
    cameraDot = svgElement('circle', { r: 0.13, class: 'plan-camera-dot' });
    cameraLayer.append(cameraCone, cameraDot);
    svg.append(cameraLayer);
    drawing.append(svg);
    panel.dataset.ready = '1';
    rebuildLabels();
  }

  function updateCameraMarker() {
    if (!cameraCone || !cameraDot) return;
    const { camera } = viewer;
    camera.getWorldDirection(cameraDirection);
    const length = Math.hypot(cameraDirection.x, cameraDirection.z);
    if (length < 0.0001) return;
    const x = camera.position.x;
    const z = camera.position.z;
    const direction = Math.atan2(cameraDirection.z / length, cameraDirection.x / length);
    const horizontalFov = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
    const half = Math.min(horizontalFov / 2, Math.PI * 0.49);
    const radius = 1.65;
    const start = direction - half;
    const end = direction + half;
    const x1 = x + Math.cos(start) * radius;
    const z1 = z + Math.sin(start) * radius;
    const x2 = x + Math.cos(end) * radius;
    const z2 = z + Math.sin(end) * radius;
    cameraCone.setAttribute('d', `M ${x} ${z} L ${x1} ${z1} A ${radius} ${radius} 0 0 1 ${x2} ${z2} Z`);
    cameraDot.setAttribute('cx', x);
    cameraDot.setAttribute('cy', z);
  }

  function update(state) {
    const nextActive = !state.docMode && Math.abs(state.value - 8) < 0.53;
    const nextBrowsing = !state.docMode && state.browsing;
    const nextWalking = state.suspended && document.body.classList.contains('walkthrough-active');
    const nextVisible = !state.docMode && (!mobileQuery.matches || nextActive || nextWalking);
    if (browsing !== nextBrowsing || active !== nextActive) {
      setPlanHoveredRecord(null);
      setModelHoveredRecord(null);
    }
    active = nextActive;
    browsing = nextBrowsing;
    walking = nextWalking;
    visible = nextVisible;
    if (!visible || browsing || walking) setExpanded(false);
    panel.classList.toggle('is-active', visible);
    panel.classList.toggle('is-plan-beat', active);
    panel.classList.toggle('is-mini', visible && (!active || walking || browsing) && !expanded);
    panel.classList.toggle('is-browsing', browsing);
    panel.classList.toggle('is-walkthrough', walking);
    panel.setAttribute('aria-hidden', String(!visible));
    miniButton.disabled = walking;
    if (!active && !expanded) refreshHover();
    setOrbitActive(nextActive && !state.suspended && !expanded, nextBrowsing ? 'room' : 'plan');
    updateCameraMarker();
    syncMobileAnchor();
  }

  openButton.addEventListener('click', () => setExpanded(true));
  miniButton.addEventListener('click', () => setExpanded(true));
  closeButton.addEventListener('click', () => setExpanded(false));
  scrim.addEventListener('click', () => setExpanded(false));
  roomAction.addEventListener('click', () => {
    if (selectedRecord) flyToRecord(selectedRecord);
  });
  returnButton.addEventListener('click', () => story.resumeStory());
  const onKeydown = (event) => {
    if (event.key === 'Escape' && expanded) setExpanded(false);
  };
  const onViewportChange = () => {
    if (!mobileQuery.matches) setExpanded(false);
    lastMobileBottom = -1;
    syncMobileAnchor();
  };
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', onViewportChange, { passive: true });
  mobileQuery.addEventListener?.('change', onViewportChange);
  stage.addEventListener('pointerdown', orbitPointerDown);
  stage.addEventListener('pointermove', orbitPointerMove);
  stage.addEventListener('pointerup', orbitPointerEnd);
  stage.addEventListener('pointercancel', orbitPointerEnd);
  stage.addEventListener('pointerleave', updateModelHover);
  build().catch((error) => console.error('Interactive plan failed to load', error));
  rebuildLabels();
  const unsubscribeLanguage = i18n.subscribe(rebuildLabels);
  const unsubscribeFrame = story.subscribeFrame(update);
  return () => {
    unsubscribeLanguage();
    unsubscribeFrame();
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('resize', onViewportChange);
    mobileQuery.removeEventListener?.('change', onViewportChange);
    stage.removeEventListener('pointerdown', orbitPointerDown);
    stage.removeEventListener('pointermove', orbitPointerMove);
    stage.removeEventListener('pointerup', orbitPointerEnd);
    stage.removeEventListener('pointercancel', orbitPointerEnd);
    stage.removeEventListener('pointerleave', updateModelHover);
    setOrbitActive(false);
    document.body.classList.remove('plan-overlay-open');
    viewer.zones.highlight(null);
    scrim.remove();
    panel.remove();
  };
}
