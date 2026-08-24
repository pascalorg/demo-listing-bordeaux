import {
  Color,
  Layers,
  Matrix4,
  RenderPipeline,
  UnsignedByteType,
} from 'three/webgpu';
import {
  abs,
  add,
  diffuseColor,
  exp,
  float,
  max,
  min,
  mix,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  sample,
  saturation,
  screenSize,
  screenUV,
  smoothstep,
  step,
  uniform,
  unpackRGBToNormal,
  velocity,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { recurrentDenoise } from 'three/addons/tsl/display/RecurrentDenoiseNode.js';
import { temporalReproject } from 'three/addons/tsl/display/TemporalReprojectNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { LAYERS } from './config.js';

const POST_QUALITY = Object.freeze({
  convergenceFrames: 32,
  ssgi: Object.freeze({
    sliceCount: 2,
    stepCount: 8,
    radius: 12,
    expFactor: 2,
    thickness: 1,
    backfaceLighting: 0,
    aoIntensity: 1,
    giIntensity: 10,
    useLinearThickness: false,
    useScreenSpaceSampling: true,
    useTemporalFiltering: true,
  }),
  denoise: Object.freeze({
    radius: 5,
    lumaPhi: 5,
    depthPhi: 5,
    normalPhi: 5,
    diffusePhi: 100,
    strength: 0.25,
    maxFrames: 32,
  }),
});

const GRADE = Object.freeze({ contrast: 1.05, saturation: 1.1 });

function backdropGradient({ dirY, background, haze, sky, skyDeep }) {
  let base = mix(background, sky, smoothstep(-0.02, 0.14, dirY));
  base = mix(base, skyDeep, smoothstep(0.1, 0.55, dirY));
  return mix(base, haze, exp(abs(dirY).mul(-11)).mul(0.8));
}

function inkedEdges({ depthTex, normalTex, sceneRgb, inkColor }) {
  const px = vec2(1, 1).div(screenSize);
  const uv = screenUV;
  const dC = depthTex.sample(uv).r;
  const dR = depthTex.sample(uv.add(vec2(px.x, 0))).r;
  const dL = depthTex.sample(uv.sub(vec2(px.x, 0))).r;
  const dU = depthTex.sample(uv.add(vec2(0, px.y))).r;
  const dD = depthTex.sample(uv.sub(vec2(0, px.y))).r;
  const depthLap = abs(dR.add(dL).add(dU).add(dD).sub(dC.mul(4)));
  const invDepth = float(1).sub(dC);
  const depthMetric = depthLap.div(invDepth.mul(invDepth).add(0.00002));
  const depthEdge = smoothstep(0.5, 2.5, depthMetric)
    .mul(smoothstep(0.00002, 0.00006, depthLap));

  const readNormal = (at) => unpackRGBToNormal(normalTex.sample(at)).normalize();
  const nC = readNormal(uv);
  const nR = readNormal(uv.add(vec2(px.x, 0)));
  const nL = readNormal(uv.sub(vec2(px.x, 0)));
  const nU = readNormal(uv.add(vec2(0, px.y)));
  const nD = readNormal(uv.sub(vec2(0, px.y)));
  const nDiff = max(
    max(float(1).sub(nC.dot(nR)), float(1).sub(nC.dot(nL))),
    max(float(1).sub(nC.dot(nU)), float(1).sub(nC.dot(nD))),
  );
  const normalEdge = smoothstep(0.01, 0.05, nDiff);
  const distanceFade = float(1).sub(smoothstep(0.9994, 0.9998, dC));
  const mask = min(max(depthEdge, normalEdge).mul(0.5).mul(distanceFade), 1);
  return mix(sceneRgb, inkColor, mask);
}

function grade(rgb) {
  return saturation(rgb.div(0.18).pow(vec3(GRADE.contrast)).mul(0.18), GRADE.saturation);
}

function preserveCameraViewOffset(traaPass, camera) {
  const setTRAAViewOffset = traaPass.setViewOffset.bind(traaPass);
  const clearTRAAViewOffset = traaPass.clearViewOffset.bind(traaPass);
  let authoredView = null;
  let jitterApplied = false;

  const restoreAuthoredView = () => {
    if (authoredView) {
      camera.setViewOffset(
        authoredView.fullWidth,
        authoredView.fullHeight,
        authoredView.offsetX,
        authoredView.offsetY,
        authoredView.width,
        authoredView.height,
      );
    } else {
      camera.clearViewOffset();
    }
  };

  traaPass.setViewOffset = (width, height) => {
    if (!jitterApplied) {
      authoredView = camera.view?.enabled ? { ...camera.view } : null;
    } else {
      restoreAuthoredView();
    }
    setTRAAViewOffset(width, height);
    if (authoredView) {
      const jitterX = camera.view.offsetX * (authoredView.fullWidth / width);
      const jitterY = camera.view.offsetY * (authoredView.fullHeight / height);
      camera.setViewOffset(
        authoredView.fullWidth,
        authoredView.fullHeight,
        authoredView.offsetX + jitterX,
        authoredView.offsetY + jitterY,
        authoredView.width,
        authoredView.height,
      );
    }
    jitterApplied = true;
  };

  traaPass.clearViewOffset = () => {
    clearTRAAViewOffset();
    restoreAuthoredView();
    authoredView = null;
    jitterApplied = false;
  };
}

export function createPostPipeline(renderer, scene, camera, { look = 'real' } = {}) {
  const real = look !== 'sketch';
  const sceneLayers = new Layers();
  sceneLayers.set(LAYERS.scene);
  sceneLayers.enable(LAYERS.grid);
  const zoneLayers = new Layers();
  zoneLayers.set(LAYERS.zone);

  const scenePass = pass(scene, camera, { samples: 0 });
  scenePass.setLayers(sceneLayers);
  const zonePass = pass(scene, camera);
  zonePass.setLayers(zoneLayers);

  scenePass.setMRT(real
    ? mrt({
      output,
      diffuseColor,
      normal: packNormalToRGB(normalView),
      velocity,
    })
    : mrt({
      output,
      normal: packNormalToRGB(normalView),
    }));

  const sceneColor = scenePass.getTextureNode('output');
  const sceneDepth = scenePass.getTextureNode('depth');
  const packedNormal = scenePass.getTextureNode('normal');
  scenePass.getTexture('normal').type = UnsignedByteType;

  const zoneColor = zonePass.getTextureNode('output');
  const sceneDepthValue = sceneDepth.sample(screenUV).r;
  const contentAlpha = sceneColor.a.max(zoneColor.a);

  const projectionInverse = uniform(new Matrix4());
  const cameraWorld = uniform(new Matrix4());
  const ndc = vec4(
    screenUV.x.mul(2).sub(1),
    float(1).sub(screenUV.y).mul(2).sub(1),
    1,
    1,
  );
  const viewRay = projectionInverse.mul(ndc);
  const worldDirection = cameraWorld.mul(vec4(viewRay.xyz, 0)).xyz.normalize();
  const backdrop = {
    background: uniform(new Color('#e9e7e2')),
    haze: uniform(new Color('#dad4c5')),
    sky: uniform(new Color('#b6cfe7')),
    skyDeep: uniform(new Color('#527dab')),
  };
  const background = backdropGradient({
    dirY: worldDirection.y,
    ...backdrop,
  });
  const disposables = [];
  let finalColor;

  if (real) {
    const diffuse = scenePass.getTextureNode('diffuseColor');
    const sceneVelocity = scenePass.getTextureNode('velocity');
    scenePass.getTexture('diffuseColor').type = UnsignedByteType;
    const normal = sample((uv) => unpackRGBToNormal(packedNormal.sample(uv)));
    const giPass = ssgi(sceneColor, sceneDepth, normal, camera);
    for (const [key, value] of Object.entries(POST_QUALITY.ssgi)) {
      if (key === 'useTemporalFiltering') giPass[key] = value;
      else giPass[key].value = value;
    }

    const rawAOTexture = giPass.getAONode();
    const rawAO = vec4(rawAOTexture.r, rawAOTexture.r, rawAOTexture.r, rawAOTexture.r);
    const temporalAOInput = vec4(rawAOTexture.r, rawAOTexture.r, rawAOTexture.r, 1);
    const temporalAO = temporalReproject(temporalAOInput, sceneDepth, packedNormal, sceneVelocity, camera, {
      mode: 'diffuse',
      accumulate: false,
    });
    const denoisedAO = recurrentDenoise(temporalAO, camera, {
      depth: sceneDepth,
      normal: packedNormal,
      diffuse,
      raw: rawAO,
      mode: 'diffuse',
      accumulate: true,
    });
    denoisedAO.alphaSource = 'ao';
    temporalAO.setHistoryTexture(denoisedAO);

    const rawGITexture = giPass.getGINode();
    const rawGI = vec4(rawGITexture.rgb, 1);
    const temporalGI = temporalReproject(rawGI, sceneDepth, packedNormal, sceneVelocity, camera, {
      mode: 'diffuse',
      accumulate: false,
    });
    const denoisedGI = recurrentDenoise(temporalGI, camera, {
      depth: sceneDepth,
      normal: packedNormal,
      diffuse,
      raw: rawGI,
      mode: 'diffuse',
      accumulate: true,
    });
    denoisedGI.alphaSource = 'none';
    temporalGI.setHistoryTexture(denoisedGI);

    for (const node of [temporalAO, temporalGI, denoisedAO, denoisedGI]) {
      node.maxFrames.value = POST_QUALITY.denoise.maxFrames;
    }
    for (const denoisePass of [denoisedAO, denoisedGI]) {
      for (const [key, value] of Object.entries(POST_QUALITY.denoise)) {
        denoisePass[key].value = value;
      }
    }

    let ao = denoisedAO.r;
    ao = mix(ao, 1, smoothstep(0.9994, 0.9998, sceneDepthValue));
    const withGI = add(sceneColor.rgb.mul(ao), add(zoneColor.rgb, diffuse.rgb.mul(denoisedGI.rgb)));
    const composite = vec4(mix(grade(background), grade(withGI), contentAlpha), 1);
    const traaPass = traa(composite, sceneDepth, sceneVelocity, camera);
    preserveCameraViewOffset(traaPass, camera);
    const backgroundPixel = step(0.999999, sceneDepthValue);
    finalColor = mix(traaPass.rgb, grade(background), backgroundPixel);
    disposables.push(giPass, temporalAO, temporalGI, denoisedAO, denoisedGI, traaPass);
  } else {
    const withZones = add(sceneColor.rgb, zoneColor.rgb);
    const inked = inkedEdges({
      depthTex: sceneDepth,
      normalTex: packedNormal,
      sceneRgb: withZones,
      inkColor: uniform(new Color('#1a1d24')),
    });
    finalColor = mix(grade(background), grade(inked), contentAlpha);
  }

  const pipeline = new RenderPipeline(renderer);
  pipeline.outputNode = vec4(finalColor, 1);

  return {
    convergenceFrames: real ? POST_QUALITY.convergenceFrames : 0,
    render() {
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      projectionInverse.value.copy(camera.projectionMatrixInverse);
      cameraWorld.value.copy(camera.matrixWorld);
      pipeline.render();
    },
    setBackdrop(colors) {
      for (const [key, value] of Object.entries(colors)) backdrop[key]?.value.set(value);
    },
    dispose() {
      disposables.forEach((node) => node.dispose());
      scenePass.dispose();
      zonePass.dispose();
      pipeline.dispose();
    },
  };
}
