import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationMixer,
  Box3,
  Color,
  DataTexture,
  DirectionalLight,
  EquirectangularReflectionMapping,
  FloatType,
  HemisphereLight,
  LinearSRGBColorSpace,
  LoopOnce,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  RGBAFormat,
  Scene,
  Sphere,
  Vector2,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {
  BUILDING_FALLBACK_BOUNDS,
  BUILDING_ID,
  KTX2_PATH,
  LAYERS,
  MODEL_URL,
} from './config.js';
import { createPostPipeline } from './post.js';
import { createZones } from './zones.js';

const INIT_TIMEOUT = 4000;

async function initializeRenderer(canvas, options = {}) {
  const renderer = new WebGPURenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
    ...options,
  });
  let timeoutId = 0;
  try {
    await Promise.race([
      renderer.init(),
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error('Renderer initialization timed out')), INIT_TIMEOUT);
      }),
    ]);
    return renderer;
  } catch (error) {
    await renderer.dispose();
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function createRenderer(canvas) {
  const params = new URLSearchParams(location.search);
  if (params.has('forceWebGL')) {
    return initializeRenderer(canvas, { forceWebGL: true });
  }
  try {
    if (params.has('simulateWebGPUFailure')) throw new Error('Simulated WebGPU initialization failure');
    return await initializeRenderer(canvas);
  } catch {
    return initializeRenderer(canvas, { forceWebGL: true });
  }
}

function createEnvironment() {
  const width = 64;
  const height = 32;
  const data = new Float32Array(width * height * 4);
  const zenith = [0.40, 0.56, 0.78];
  const horizon = [0.95, 0.84, 0.66];
  const ground = [0.38, 0.35, 0.30];
  for (let y = 0; y < height; y += 1) {
    const latitude = 1 - (y / (height - 1)) * 2;
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (latitude >= 0) {
        const t = latitude ** 0.65;
        for (let channel = 0; channel < 3; channel += 1) {
          data[offset + channel] = horizon[channel] + (zenith[channel] - horizon[channel]) * t;
        }
      } else {
        const darken = 1 - Math.abs(latitude) * 0.35;
        for (let channel = 0; channel < 3; channel += 1) data[offset + channel] = ground[channel] * darken;
      }
      data[offset + 3] = 1;
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function fallbackBounds() {
  return new Box3(
    new Vector3(...BUILDING_FALLBACK_BOUNDS.min),
    new Vector3(...BUILDING_FALLBACK_BOUNDS.max),
  );
}

function findBuilding(model) {
  let building = model.getObjectByName(BUILDING_ID);
  if (building) return building;
  model.traverse((node) => {
    if (!building && node.userData?.pascalId === BUILDING_ID) building = node;
  });
  return building;
}

function installLights(scene, bounds) {
  scene.add(new AmbientLight('#ffffff', 0.15));
  scene.add(new HemisphereLight('#ffffff', '#aaa49a', 0.45));

  const sphere = bounds.getBoundingSphere(new Sphere());
  const size = sphere.radius * 1.15 + 3;
  const distance = size + 10;
  const direction = new Vector3(10, 10, 10).normalize();
  const key = new DirectionalLight('#ffffff', 4);
  key.position.copy(sphere.center).addScaledVector(direction, distance);
  key.target.position.copy(sphere.center);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 2;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.08;
  key.shadow.intensity = 0.75;
  const shadowCamera = key.shadow.camera;
  shadowCamera.left = -size;
  shadowCamera.right = size;
  shadowCamera.top = size;
  shadowCamera.bottom = -size;
  shadowCamera.near = 10;
  shadowCamera.far = distance + size;
  shadowCamera.layers.enable(LAYERS.shadowOnly);
  shadowCamera.updateProjectionMatrix();
  scene.add(key, key.target);

  const fill = new DirectionalLight('#ffffff', 0.6);
  fill.position.copy(sphere.center).addScaledVector(new Vector3(-10, 10, -10).normalize(), distance);
  scene.add(fill);
  return { key, fill };
}

function configureModel(model) {
  model.traverse((node) => {
    if (node.isLine || node.isLineSegments || node.userData?.kind === 'guide') {
      node.visible = false;
      return;
    }
    if (!node.isMesh) return;
    const position = node.geometry?.getAttribute('position');
    if (!position || position.count === 0) {
      node.visible = false;
      return;
    }
    // A few shared GLB materials reference texture channels that their mesh
    // primitive does not carry. Avoid compiling those unavailable UV samples.
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    let changed = false;
    const safeMaterials = materials.map((source) => {
      if (!source) return source;
      let material = source;
      for (const [property, value] of Object.entries(source)) {
        if (!value?.isTexture) continue;
        const channel = Number(value.channel || 0);
        const attribute = `uv${channel > 0 ? channel : ''}`;
        if (node.geometry.hasAttribute(attribute)) continue;
        if (material === source) material = source.clone();
        material[property] = null;
        changed = true;
      }
      return material;
    });
    if (changed) node.material = Array.isArray(node.material) ? safeMaterials : safeMaterials[0];
    const transparent = Array.isArray(node.material)
      ? node.material.some((material) => material.transparent || material.opacity < 0.95)
      : node.material?.transparent || node.material?.opacity < 0.95;
    node.castShadow = !transparent;
    node.receiveShadow = true;
  });
}

function createOpeningController(model, animations, invalidate, type) {
  const mixer = new AnimationMixer(model);
  const records = new Map();
  const roots = new Map();
  const raycaster = new Raycaster();
  const rayCenter = new Vector2(0, 0);
  const clipPattern = new RegExp(`^(${type}_[^:]+): open$`);
  for (const clip of animations) {
    const match = clipPattern.exec(clip.name);
    if (!match) continue;
    const root = model.getObjectByName(match[1]) || model.getObjectByProperty('userData.pascalId', match[1]);
    records.set(match[1], {
      id: match[1],
      clip,
      action: mixer.clipAction(clip),
      root,
      center: null,
      progress: 0,
      moving: false,
      motionElapsed: 0,
      motionDuration: 0,
      motionFrom: 0,
      targetProgress: 0,
      scrubReady: false,
      fallback: false,
    });
    if (root) roots.set(root, match[1]);
  }

  function fallbackOpen(record, layoutOpening) {
    const root = model.getObjectByName(record.id) || model.getObjectByProperty('userData.pascalId', record.id);
    const leaf = root?.getObjectByName('door-pocket-leaf')
      || root?.children.find((child) => /leaf|sash|panel/i.test(child.name));
    if (leaf) {
      if (layoutOpening?.doorType === 'pocket' || layoutOpening?.doorType === 'sliding') {
        leaf.position.x += Number(layoutOpening.width || 0.9);
      } else {
        const sign = layoutOpening?.hingesSide === 'right' ? -1 : 1;
        leaf.rotation.y += sign * Math.PI / 2;
      }
      leaf.updateMatrixWorld(true);
    }
    record.fallback = true;
    record.progress = 1;
    invalidate();
  }

  function registerLayout(layout) {
    const nodes = layout.nodes || {};
    for (const opening of Object.values(nodes).filter((node) => node.type === type)) {
      let record = records.get(opening.id);
      if (!record) {
        record = {
          id: opening.id,
          clip: null,
          action: null,
          root: model.getObjectByName(opening.id) || model.getObjectByProperty('userData.pascalId', opening.id),
          progress: 0,
          moving: false,
          motionElapsed: 0,
          motionDuration: 0,
          motionFrom: 0,
          targetProgress: 0,
          scrubReady: false,
          fallback: false,
        };
        records.set(opening.id, record);
        if (record.root) roots.set(record.root, opening.id);
      }
      const wall = nodes[opening.wallId || opening.parentId];
      if (wall?.start && wall?.end) {
        const dx = wall.end[0] - wall.start[0];
        const dz = wall.end[1] - wall.start[1];
        const length = Math.hypot(dx, dz) || 1;
        const along = Number(opening.position?.[0] || 0);
        record.center = [wall.start[0] + (dx / length) * along, wall.start[1] + (dz / length) * along];
      }
      record.layout = opening;
      if (!record.moving && !record.scrubReady) {
        record.progress = Math.max(record.progress, Number(opening.operationState || 0));
      }
    }
  }

  function animateTo(id, targetProgress, { duration = 0.45 } = {}) {
    const record = records.get(id);
    if (!record) return false;
    const target = Math.max(0, Math.min(1, Number(targetProgress) || 0));
    if (Math.abs(record.progress - target) < 0.001 && !record.moving) return false;
    if (!record.action || !record.clip) {
      if (target > record.progress) fallbackOpen(record, record.layout);
      return true;
    }
    const from = record.progress;
    record.action.reset();
    record.action.enabled = true;
    record.action.clampWhenFinished = true;
    record.action.setLoop(LoopOnce, 1);
    record.action.timeScale = 1;
    record.action.play();
    record.action.paused = true;
    record.action.time = record.clip.duration * from;
    record.scrubReady = true;
    record.motionElapsed = 0;
    record.motionDuration = Math.max(0.12, duration * Math.max(0.25, Math.abs(target - from)));
    record.motionFrom = from;
    record.targetProgress = target;
    record.moving = true;
    mixer.update(0);
    invalidate();
    return true;
  }

  function open(id, { speed = 1 } = {}) {
    return animateTo(id, 1, { duration: 1 / Math.max(0.01, speed) });
  }

  function toggle(id, options) {
    const record = records.get(id);
    if (!record?.action || !record.clip) return false;
    const target = record.moving
      ? (record.targetProgress >= 0.5 ? 0 : 1)
      : (record.progress >= 0.5 ? 0 : 1);
    return animateTo(id, target, options);
  }

  function scrub(id, progress) {
    const record = records.get(id);
    if (!record?.action || !record.clip) return false;
    const next = Math.max(0, Math.min(1, Number(progress) || 0));
    const actionProgress = record.action.time / record.clip.duration;
    if (record.scrubReady && !record.moving
      && Math.abs(next - record.progress) < 0.00001
      && Math.abs(next - actionProgress) < 0.00001) return false;
    if (!record.scrubReady || record.moving) {
      record.action.reset();
      record.action.enabled = true;
      record.action.clampWhenFinished = true;
      record.action.setLoop(LoopOnce, 1);
      record.action.play();
      record.scrubReady = true;
    }
    record.action.paused = true;
    record.action.time = record.clip.duration * next;
    record.progress = next;
    record.moving = false;
    record.motionElapsed = 0;
    record.motionDuration = 0;
    record.motionFrom = next;
    record.targetProgress = next;
    mixer.update(0);
    invalidate();
    return true;
  }

  function openNear([x, z], distance = 1.2) {
    for (const record of records.values()) {
      if (!record.center || record.progress >= 0.999) continue;
      if (Math.hypot(x - record.center[0], z - record.center[1]) <= distance) open(record.id);
    }
  }

  function update(delta) {
    const moving = [...records.values()].filter((record) => record.moving);
    if (!moving.length) return false;
    for (const record of moving) {
      record.motionElapsed += Math.max(0, delta);
      const local = Math.min(1, record.motionElapsed / record.motionDuration);
      const eased = local * local * local * (local * (local * 6 - 15) + 10);
      record.progress = record.motionFrom + (record.targetProgress - record.motionFrom) * eased;
      record.action.time = record.clip.duration * record.progress;
      if (local >= 1) {
        record.progress = record.targetProgress;
        record.action.time = record.clip.duration * record.progress;
        record.moving = false;
      }
    }
    mixer.update(0);
    return true;
  }

  function pick(camera, distance = 2.5) {
    raycaster.near = 0;
    raycaster.far = distance;
    raycaster.setFromCamera(rayCenter, camera);
    const hit = raycaster.intersectObject(model, true)[0];
    if (!hit) return null;
    let node = hit.object;
    while (node && node !== model) {
      const id = roots.get(node);
      if (id) {
        const record = records.get(id);
        return record?.action && record.clip ? record : null;
      }
      node = node.parent;
    }
    return null;
  }

  return {
    records,
    registerLayout,
    animateTo,
    open,
    openNear,
    toggle,
    pick,
    scrub,
    isPassable(id) { return (records.get(id)?.progress ?? 1) >= 0.4; },
    update,
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      records.clear();
    },
  };
}

export async function createViewer({ canvas, stage, loadState, labelLayer, i18n }) {
  const renderer = await createRenderer(canvas);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setClearColor(new Color('#e9e7e2'), 0);

  const isWebGPU = renderer.backend?.isWebGPUBackend === true && renderer.backend?.device != null;
  const scene = new Scene();
  const camera = new PerspectiveCamera(36, 1, 0.1, 100);
  camera.layers.set(LAYERS.scene);
  scene.environment = createEnvironment();
  scene.environmentIntensity = 0.6;

  const cappedPixelRatio = () => Math.min(
    devicePixelRatio || 1,
    matchMedia('(pointer: coarse)').matches ? 1.25 : 1.5,
  );
  let currentPixelRatio = cappedPixelRatio();
  renderer.setPixelRatio(currentPixelRatio);

  const ktx2 = new KTX2Loader().setTranscoderPath(KTX2_PATH).detectSupport(renderer);
  const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(MODEL_URL);
  ktx2.dispose();

  const model = gltf.scene;
  configureModel(model);
  scene.add(model);
  model.updateMatrixWorld(true);
  const building = findBuilding(model);
  const bounds = building ? new Box3().setFromObject(building) : fallbackBounds();
  if (bounds.isEmpty()) bounds.copy(fallbackBounds());
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const lights = installLights(scene, bounds);
  const defaultLight = {
    position: lights.key.position.clone(),
    intensity: lights.key.intensity,
    color: lights.key.color.clone(),
  };

  let dirty = true;
  let renderCount = 0;
  let convergenceFramesRemaining = 0;
  let lastWidth = 0;
  let lastHeight = 0;
  let post = null;
  let dprMediaQuery = null;
  const renderListeners = new Set();
  const invalidate = () => {
    dirty = true;
    convergenceFramesRemaining = post?.convergenceFrames ?? 0;
  };
  const zones = createZones({ scene, model, labelLayer, i18n, invalidate });
  const doors = createOpeningController(model, gltf.animations, invalidate, 'door');
  const windows = createOpeningController(model, gltf.animations, invalidate, 'window');
  const requestedLook = new URLSearchParams(location.search).get('look');
  const look = isWebGPU ? (requestedLook === 'sketch' ? 'sketch' : 'real') : 'direct';
  if (isWebGPU) post = createPostPipeline(renderer, scene, camera, { look });
  else camera.layers.enable(LAYERS.zone);

  function watchDevicePixelRatio() {
    dprMediaQuery?.removeEventListener('change', onDevicePixelRatioChange);
    dprMediaQuery = matchMedia(`(resolution: ${devicePixelRatio || 1}dppx)`);
    dprMediaQuery.addEventListener('change', onDevicePixelRatioChange);
  }

  function onDevicePixelRatioChange() {
    watchDevicePixelRatio();
    invalidate();
  }

  function resize() {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    const nextPixelRatio = cappedPixelRatio();
    const sizeChanged = width !== lastWidth || height !== lastHeight;
    const pixelRatioChanged = Math.abs(nextPixelRatio - currentPixelRatio) > 0.0001;
    if (!sizeChanged && !pixelRatioChanged) return false;
    lastWidth = width;
    lastHeight = height;
    if (pixelRatioChanged) {
      currentPixelRatio = nextPixelRatio;
      renderer.setPixelRatio(currentPixelRatio);
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    invalidate();
    return true;
  }

  function render(force = false, delta = 1 / 60) {
    resize();
    const zoneMoving = zones.tick(1 / 60);
    const doorMoving = doors.update(delta);
    const windowMoving = windows.update(delta);
    const sceneMoving = zoneMoving || doorMoving || windowMoving;
    if (post && (force || dirty || sceneMoving)) {
      convergenceFramesRemaining = post.convergenceFrames;
    }
    if (!force && !dirty && !sceneMoving && convergenceFramesRemaining <= 0) return false;
    dirty = false;
    if (post) post.render();
    else renderer.render(scene, camera);
    if (post && !sceneMoving && convergenceFramesRemaining > 0) convergenceFramesRemaining -= 1;
    zones.updateLabels(camera, lastWidth, lastHeight);
    renderCount += 1;
    renderListeners.forEach((listener) => listener({ camera, renderCount }));
    return true;
  }

  watchDevicePixelRatio();
  window.addEventListener('resize', invalidate, { passive: true });
  stage.classList.add('model-ready');
  stage.setAttribute('aria-busy', 'false');
  loadState.dataset.i18n = 'ui.loaded';
  loadState.textContent = i18n.t('ui.loaded');
  window.setTimeout(() => loadState.setAttribute('hidden', ''), 900);
  invalidate();

  return {
    renderer,
    scene,
    camera,
    model,
    bounds,
    center,
    size,
    lights,
    zones,
    doors,
    windows,
    isWebGPU,
    look,
    invalidate,
    render,
    subscribeRender(listener) {
      renderListeners.add(listener);
      return () => renderListeners.delete(listener);
    },
    get renderCount() { return renderCount; },
    get convergenceFramesRemaining() { return convergenceFramesRemaining; },
    setDaylight({ direction, intensity, color, backdrop }) {
      if (direction) {
        const distance = lights.key.position.distanceTo(lights.key.target.position);
        lights.key.position.copy(lights.key.target.position).addScaledVector(direction, distance);
      }
      if (intensity != null) lights.key.intensity = intensity;
      if (color) lights.key.color.set(color);
      if (backdrop) {
        post?.setBackdrop(backdrop);
        stage.style.setProperty('--daylight-sky', backdrop.sky || '#b6cfe7');
        stage.style.setProperty('--daylight-haze', backdrop.haze || '#dad4c5');
      }
      invalidate();
    },
    resetDaylight() {
      lights.key.position.copy(defaultLight.position);
      lights.key.intensity = defaultLight.intensity;
      lights.key.color.copy(defaultLight.color);
      post?.setBackdrop({ background: '#e9e7e2', haze: '#dad4c5', sky: '#b6cfe7', skyDeep: '#527dab' });
      stage.style.removeProperty('--daylight-sky');
      stage.style.removeProperty('--daylight-haze');
      invalidate();
    },
    async prewarm() {
      if (typeof renderer.compileAsync === 'function') await renderer.compileAsync(scene, camera);
    },
    dispose() {
      window.removeEventListener('resize', invalidate);
      dprMediaQuery?.removeEventListener('change', onDevicePixelRatioChange);
      zones.dispose();
      doors.dispose();
      windows.dispose();
      renderListeners.clear();
      post?.dispose();
      scene.environment?.dispose();
      renderer.dispose();
    },
  };
}
