import { Vector3 } from 'three/webgpu';

const FLY_TARGET_DISTANCE = 5;
const FLY_BASE_SPEED = 2.5;
const FLY_FAST_MULTIPLIER = 4;
const FLY_SPEED_MIN = 0.1;
const FLY_SPEED_MAX = 40;
const FLY_LOOK_SENSITIVITY = 0.002;
const FLY_PITCH_LIMIT = Math.PI / 2 - 0.01;
const FLY_RETURN_MS = 750;
const FLY_FOV_MIN = 20;
const FLY_FOV_MAX = 90;

function number(value) {
  return Number(value).toFixed(2);
}

function vector(values) {
  return `[${values.map(number).join(', ')}]`;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function mountPoseCapture({ viewer, story, walkthrough }) {
  const style = document.createElement('style');
  style.textContent = `
    .pose-capture {
      background: rgb(15 22 20 / 76%);
      border: 1px solid rgb(255 255 255 / 18%);
      border-radius: 9px;
      bottom: 16px;
      color: rgb(255 255 255 / 82%);
      font: 10px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      left: 16px;
      letter-spacing: .01em;
      max-width: calc(100vw - 32px);
      padding: 8px 10px;
      pointer-events: none;
      position: fixed;
      white-space: nowrap;
      z-index: 80;
    }
    .pose-capture strong { color: var(--acid, #d8ff58); font-weight: 600; }
    .pose-capture.is-copied { border-color: var(--acid, #d8ff58); color: white; }
    .pose-capture.is-fly {
      border-color: rgb(216 255 88 / 70%);
      box-shadow: 0 0 0 1px rgb(216 255 88 / 10%), 0 8px 28px rgb(0 0 0 / 22%);
    }
    .pose-capture .pose-fly-indicator {
      background: var(--acid, #d8ff58);
      border-radius: 999px;
      color: #152018;
      display: inline-block;
      letter-spacing: .08em;
      padding: 0 5px;
    }
    @media (max-width: 700px) {
      .pose-capture { bottom: 10px; font-size: 8px; left: 10px; max-width: calc(100vw - 20px); }
    }
  `;
  const overlay = document.createElement('aside');
  overlay.className = 'pose-capture';
  overlay.setAttribute('aria-live', 'polite');
  const poseLine = document.createElement('div');
  const storyLine = document.createElement('div');
  overlay.append(poseLine, storyLine);
  document.head.append(style);
  document.body.append(overlay);

  const canvas = viewer.renderer.domElement;
  const target = new Vector3();
  const direction = new Vector3();
  const right = new Vector3();
  const movement = new Vector3();
  const worldUp = new Vector3(0, 1, 0);
  const flyPosition = new Vector3();
  const flyTarget = new Vector3();
  const returnEye = new Vector3();
  const returnTarget = new Vector3();
  const baseEye = new Vector3();
  const baseTarget = new Vector3();
  const keys = new Set();
  let flyMode = 'idle';
  let flySpeed = FLY_BASE_SPEED;
  let flyYaw = 0;
  let flyPitch = 0;
  let flyFov = viewer.camera.fov;
  let returnStarted = 0;
  let pointerWasLocked = false;
  let suppressPointerExit = false;
  let latestText = '';
  let latestStoryText = '';
  let copyStatus = 'C copy';
  let copiedTimer = 0;

  function setDirection() {
    const cp = Math.cos(flyPitch);
    direction.set(-Math.sin(flyYaw) * cp, Math.sin(flyPitch), -Math.cos(flyYaw) * cp);
    return direction;
  }

  function readPose() {
    const { camera } = viewer;
    if (flyMode !== 'idle') {
      camera.getWorldDirection(direction);
      target.copy(camera.position).addScaledVector(direction, FLY_TARGET_DISTANCE);
    } else if (walkthrough.active) {
      camera.getWorldDirection(direction);
      target.copy(camera.position).add(direction);
    } else {
      story.copyCameraTarget(target);
    }
    return {
      eye: camera.position.toArray(),
      tgt: target.toArray(),
      fov: camera.fov,
    };
  }

  function updatePose() {
    const pose = readPose();
    poseLine.textContent = `eye: ${vector(pose.eye)} · tgt: ${vector(pose.tgt)} · fov: ${number(pose.fov)}`;
    latestText = poseText(pose);
  }

  function poseText(pose = readPose()) {
    const moment = story.moment;
    const suffix = moment.beat
      ? `, "beat": "${moment.beat}"`
      : `, "transition": "${moment.transition}", "t": ${number(moment.t)}`;
    return `{ "eye": ${vector(pose.eye)}, "tgt": ${vector(pose.tgt)}, "fov": ${number(pose.fov)}${suffix} }`;
  }

  function updateStory() {
    const transition = story.transition;
    const flyStatus = flyMode === 'fly'
      ? `<strong class="pose-fly-indicator">FLY</strong> · ${number(flySpeed)} m/s · click view · WASD · Q/E · [/] FOV · F/Esc exit`
      : (flyMode === 'return' ? '<strong>RETURN</strong>' : 'F fly');
    const next = `<strong>${transition.from} → ${transition.to}</strong> · t=${number(transition.progress)} · ${flyStatus} · ${copyStatus}`;
    if (next === latestStoryText) return;
    latestStoryText = next;
    storyLine.innerHTML = next;
  }

  function moveFlyCamera(delta) {
    movement.set(0, 0, 0);
    setDirection();
    right.set(Math.cos(flyYaw), 0, -Math.sin(flyYaw));
    if (keys.has('KeyW')) movement.add(direction);
    if (keys.has('KeyS')) movement.sub(direction);
    if (keys.has('KeyD')) movement.add(right);
    if (keys.has('KeyA')) movement.sub(right);
    if (keys.has('KeyE') || keys.has('Space')) movement.add(worldUp);
    if (keys.has('KeyQ') || keys.has('ControlLeft') || keys.has('ControlRight')) movement.sub(worldUp);
    if (movement.lengthSq() === 0) return false;
    movement.normalize();
    const fast = keys.has('ShiftLeft') || keys.has('ShiftRight');
    flyPosition.addScaledVector(
      movement,
      flySpeed * (fast ? FLY_FAST_MULTIPLIER : 1) * Math.min(delta, 0.05),
    );
    return true;
  }

  function applyCameraOverride({ camera, target: storyTarget, time, delta }) {
    if (flyMode === 'fly') {
      const moved = moveFlyCamera(delta);
      camera.position.copy(flyPosition);
      camera.fov = flyFov;
      camera.clearViewOffset();
      storyTarget.copy(flyPosition).addScaledVector(setDirection(), FLY_TARGET_DISTANCE);
      camera.lookAt(storyTarget);
      if (moved) viewer.invalidate();
      return;
    }
    if (flyMode !== 'return') return;
    baseEye.copy(camera.position);
    baseTarget.copy(storyTarget);
    const progress = clamp((time - returnStarted) / FLY_RETURN_MS, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    camera.position.lerpVectors(returnEye, baseEye, eased);
    storyTarget.lerpVectors(returnTarget, baseTarget, eased);
    camera.fov = flyFov + (camera.fov - flyFov) * eased;
    camera.clearViewOffset();
    camera.lookAt(storyTarget);
    viewer.invalidate();
    if (progress >= 1) {
      flyMode = 'idle';
      story.setCameraOverride(null);
      story.setLookLocked('pose-fly', false);
      overlay.classList.remove('is-fly');
      updateStory();
    }
  }

  function requestFlyPointer() {
    if (flyMode !== 'fly' || document.pointerLockElement === canvas) return;
    const result = canvas.requestPointerLock?.();
    result?.catch?.(() => {});
  }

  function enterFly() {
    const { camera } = viewer;
    camera.getWorldDirection(direction);
    flyPosition.copy(camera.position);
    flyYaw = Math.atan2(-direction.x, -direction.z);
    flyPitch = Math.asin(clamp(direction.y, -1, 1));
    flyFov = clamp(camera.fov, FLY_FOV_MIN, FLY_FOV_MAX);
    flyTarget.copy(flyPosition).addScaledVector(direction, FLY_TARGET_DISTANCE);
    if (walkthrough.active) walkthrough.exit();
    keys.clear();
    flyMode = 'fly';
    pointerWasLocked = false;
    story.setLookLocked('pose-fly', true);
    story.setCameraOverride(applyCameraOverride);
    overlay.classList.add('is-fly');
    updateStory();
    viewer.invalidate();
    requestFlyPointer();
  }

  function exitFly() {
    if (flyMode !== 'fly') return;
    keys.clear();
    returnEye.copy(flyPosition);
    returnTarget.copy(flyTarget.copy(flyPosition).addScaledVector(setDirection(), FLY_TARGET_DISTANCE));
    returnStarted = performance.now();
    flyMode = 'return';
    if (document.pointerLockElement === canvas) {
      suppressPointerExit = true;
      document.exitPointerLock();
    }
    overlay.classList.remove('is-fly');
    updateStory();
    viewer.invalidate();
  }

  async function copyPose() {
    latestText = poseText();
    console.info(`[camera pose] ${latestText}`);
    let status = 'copied';
    try {
      await navigator.clipboard.writeText(latestText);
    } catch {
      status = 'logged';
    }
    window.clearTimeout(copiedTimer);
    copyStatus = status;
    overlay.classList.add('is-copied');
    updateStory();
    copiedTimer = window.setTimeout(() => {
      copyStatus = 'C copy';
      overlay.classList.remove('is-copied');
      updateStory();
    }, 900);
  }

  function keyDown(event) {
    if (event.code === 'KeyC' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      copyPose();
      return;
    }
    if (event.code === 'KeyF' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      if (flyMode === 'fly') exitFly();
      else enterFly();
      return;
    }
    if (flyMode !== 'fly') return;
    if (event.code === 'Escape') {
      event.preventDefault();
      exitFly();
      return;
    }
    if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
      event.preventDefault();
      const amount = event.shiftKey ? 0.25 : 1;
      flyFov = clamp(flyFov + (event.code === 'BracketRight' ? amount : -amount), FLY_FOV_MIN, FLY_FOV_MAX);
      viewer.invalidate();
      return;
    }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
      event.preventDefault();
      keys.add(event.code);
      viewer.invalidate();
    }
  }

  function keyUp(event) {
    keys.delete(event.code);
  }

  function mouseMove(event) {
    if (flyMode !== 'fly' || document.pointerLockElement !== canvas) return;
    flyYaw -= event.movementX * FLY_LOOK_SENSITIVITY;
    flyPitch = clamp(flyPitch - event.movementY * FLY_LOOK_SENSITIVITY, -FLY_PITCH_LIMIT, FLY_PITCH_LIMIT);
    viewer.invalidate();
  }

  function wheel(event) {
    if (flyMode !== 'fly') return;
    event.preventDefault();
    flySpeed = clamp(flySpeed * Math.exp(-event.deltaY * 0.0015), FLY_SPEED_MIN, FLY_SPEED_MAX);
    updateStory();
  }

  function pointerLockChange() {
    if (document.pointerLockElement === canvas) {
      pointerWasLocked = true;
      return;
    }
    if (suppressPointerExit) {
      suppressPointerExit = false;
      return;
    }
    if (flyMode === 'fly' && pointerWasLocked) exitFly();
  }

  function canvasClick() {
    requestFlyPointer();
  }

  const unsubscribeRender = viewer.subscribeRender(updatePose);
  const unsubscribeFrame = story.subscribeFrame(updateStory);
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('wheel', wheel, { passive: false });
  document.addEventListener('mousemove', mouseMove);
  document.addEventListener('pointerlockchange', pointerLockChange);
  canvas.addEventListener('click', canvasClick);
  updatePose();
  updateStory();
  viewer.invalidate();

  return () => {
    unsubscribeRender();
    unsubscribeFrame();
    window.removeEventListener('keydown', keyDown);
    window.removeEventListener('keyup', keyUp);
    window.removeEventListener('wheel', wheel);
    document.removeEventListener('mousemove', mouseMove);
    document.removeEventListener('pointerlockchange', pointerLockChange);
    canvas.removeEventListener('click', canvasClick);
    window.clearTimeout(copiedTimer);
    keys.clear();
    story.setCameraOverride(null);
    story.setLookLocked('pose-fly', false);
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    overlay.remove();
    style.remove();
  };
}
