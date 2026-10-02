import * as THREE from './vendor/three.module.min.js';
import { OutlineEffect } from './vendor/effects/OutlineEffect.js';
import { defaultLighting, temperatureRGB } from './light-estimation.js';

const celRamp = /* glsl */`
uniform float studioContrast;
uniform float studioFace;
vec3 getGradientIrradiance(vec3 normal, vec3 lightDirection) {
  float ndl = dot(normal, lightDirection);
  float feather = max(fwidth(ndl), 0.018);
  float lit = smoothstep(-0.02 - feather, -0.02 + feather, ndl);
  vec3 shade = mix(vec3(0.84), vec3(0.42, 0.36, 0.53), studioContrast);
  shade = mix(shade, vec3(0.76, 0.71, 0.78), studioFace);
  vec3 ramp = mix(shade, vec3(1.0), lit);
  float highlight = smoothstep(0.65 - feather, 0.65 + feather, ndl);
  return ramp * mix(0.94, 1.05, highlight);
}
`;

const rimLighting = /* glsl */`
float studioFresnel = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
float studioEdge = smoothstep(0.55, 0.9, studioFresnel);
float studioLightSide = 0.4;
#if NUM_DIR_LIGHTS > 0
  studioLightSide += 0.6 * saturate(dot(normal, directionalLights[0].direction) * 0.5 + 0.5);
#endif
outgoingLight += studioRimColor * diffuseColor.rgb * studioEdge * studioRim * studioLightSide;
float studioLuma = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
outgoingLight = max(vec3(0.0), mix(vec3(studioLuma), outgoingLight, 1.07));
`;

export class AnimeRenderer {
  constructor(renderer, scene) {
    this.renderer = renderer; this.scene = scene;
    this.settings = { ...defaultLighting }; this.mode = 'anime';
    this.outline = new OutlineEffect(renderer, { defaultThickness: .0015 });
    this.ambient = new THREE.HemisphereLight(0xe9efff, 0x908599, .45);
    this.key = new THREE.DirectionalLight(0xfff4e8, 2);
    this.fill = new THREE.DirectionalLight(0xb8cfff, .18);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -.0002;
    scene.add(this.ambient, this.key, this.key.target, this.fill, this.fill.target);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.worldCenter = new THREE.Vector3(); this.worldScale = new THREE.Vector3();
    this.direction = new THREE.Vector3(); this.rotation = new THREE.Quaternion();
    // The extra pass follows Three's XR-compatible OutlineEffect integration.
    // A render pass can receive the XR camera, so use the actual callback camera.
    scene.onAfterRender = (renderer, scene, camera) => {
      if (this.renderingOutline || this.mode !== 'anime' || !this.settings.outline || !this.mesh) return;
      this.renderingOutline = true;
      try { this.outline.renderOutline(scene, camera); }
      finally { this.renderingOutline = false; }
    };
  }

  attach(mesh) {
    this.mesh = mesh;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.outlineParameters = { visible: true };
    for (const material of mesh.material) {
      material.userData.studioOriginal = {
        fragmentShader: material.fragmentShader, emissive: material.emissive.clone(),
        specular: material.specular.clone(), shininess: material.shininess,
        outline: { ...material.userData.outlineParameters }
      };
      material.uniforms.studioContrast = { value: .6 };
      material.uniforms.studioFace = { value: /face|^eye$|顔|瞳/i.test(material.name) ? 1 : 0 };
      material.uniforms.studioRim = { value: .35 };
      material.uniforms.studioRimColor = { value: new THREE.Color(0xfff0d8) };
      material.userData.studioShader = material.fragmentShader
        .replace('#include <gradientmap_pars_fragment>', celRamp)
        // Softer shadow floors keep anime faces readable without requiring a
        // character-specific face SDF, which ordinary imported PMX lacks.
        .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
          'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;',
          'directLight.color *= mix(mix(0.35, 0.72, studioFace), 1.0, ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0);'
        ))
        .replace('#include <common>', '#include <common>\nuniform float studioRim;\nuniform vec3 studioRimColor;')
        .replace('#include <opaque_fragment>', `${rimLighting}\n#include <opaque_fragment>`);
    }
    this.setMode(this.mode);
  }

  detach() { this.mesh = null; }

  setMode(mode) {
    this.mode = mode;
    for (const material of this.mesh?.material || []) {
      const original = material.userData.studioOriginal;
      material.fragmentShader = mode === 'anime' ? material.userData.studioShader : original.fragmentShader;
      material.emissive.copy(original.emissive).multiplyScalar(mode === 'anime' ? .15 : 1);
      material.specular.copy(original.specular).multiplyScalar(mode === 'anime' ? .18 : 1);
      material.shininess = mode === 'anime' ? Math.max(40, original.shininess) : original.shininess;
      material.needsUpdate = true;
    }
    this.configure(this.settings);
  }

  configure(settings) {
    Object.assign(this.settings, settings);
    const s = this.settings;
    const color = new THREE.Color().setRGB(...temperatureRGB(s.temperature), THREE.SRGBColorSpace);
    this.key.color.copy(color); this.key.intensity = s.intensity / 100 * 2.1;
    this.ambient.intensity = s.ambient / 100;
    this.fill.intensity = s.ambient / 100 * .24;
    this.renderer.toneMappingExposure = s.exposure / 100;
    for (const material of this.mesh?.material || []) {
      material.uniforms.studioContrast.value = s.contrast / 100;
      material.uniforms.studioRim.value = s.rim / 100;
      material.uniforms.studioRimColor.value.copy(color).lerp(new THREE.Color(0xffffff), .5);
      const original = material.userData.studioOriginal.outline;
      material.userData.outlineParameters = {
        ...original, thickness: Math.min(original.thickness || .002, .003) * s.outline / 50,
        color: [.035, .027, .055], alpha: Math.min(original.alpha ?? 1, material.opacity),
        visible: this.mode === 'anime' && original.visible && s.outline > 0 && material.opacity > .2
      };
    }
  }

  update(camera, center, height) {
    if (!this.mesh) return;
    this.mesh.updateWorldMatrix(true, false);
    this.worldCenter.copy(center).applyMatrix4(this.mesh.matrixWorld);
    this.mesh.getWorldScale(this.worldScale);
    const size = height * Math.max(this.worldScale.x, this.worldScale.y, this.worldScale.z);
    const s = this.settings, azimuth = s.azimuth * Math.PI / 180, elevation = s.elevation * Math.PI / 180;
    // Light direction follows screen coordinates, including a moving XR viewer.
    camera.getWorldQuaternion(this.rotation);
    this.direction.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
    this.direction.applyQuaternion(this.rotation);
    this.key.position.copy(this.worldCenter).addScaledVector(this.direction, size * 3);
    this.key.target.position.copy(this.worldCenter);
    this.fill.position.copy(this.worldCenter).addScaledVector(this.direction, -size * 2);
    this.fill.target.position.copy(this.worldCenter);
    const shadow = this.key.shadow.camera;
    shadow.left = shadow.bottom = -size; shadow.right = shadow.top = size;
    shadow.near = Math.max(.001, size * .1); shadow.far = Math.max(.01, size * 7);
    shadow.updateProjectionMatrix();
    this.key.shadow.normalBias = size * .001;
  }
}
