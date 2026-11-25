import { MeshDepthMaterial, MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from 'three';

const helpers = /* glsl */ `
varying float vRim;
#ifdef USE_INSTANCING
uniform float uEdge;
vec3 ctxScale() {
  return max(vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)), vec3(1e-5));
}
vec3 ctxRound(vec3 p, vec3 n) {
  vec3 s = ctxScale();
  float r = min(uEdge, 0.5 * min(min(s.x, s.y), s.z));
  return (sign(p) * (0.5 * s - r) + n * r) / s;
}
#endif
`;

function patch(shader: WebGLProgramParametersWithUniforms, u: { edge: { value: number }; rim: { value: number } }, surface: boolean) {
  shader.uniforms.uEdge = u.edge;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${helpers}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\nvRim = 0.0;\n#ifdef USE_INSTANCING\ntransformed = ctxRound(position, normal);\nvRim = clamp(4.0 * normal.y * (1.0 - normal.y), 0.0, 1.0) * step(0.0, position.y);\n#endif`);
  if (!surface) return;
  shader.uniforms.uRim = u.rim;
  shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n#ifdef USE_INSTANCING\nobjectNormal *= ctxScale();\n#endif`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying float vRim;\nuniform float uRim;`)
    .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vRim * uRim);`);
}

export interface BlockMaterials {
  surface: MeshStandardMaterial;
  depth: MeshDepthMaterial;
  rim: { value: number };
}

export function blockMaterials(edge: number, rim = 0.3): BlockMaterials {
  const u = { edge: { value: edge }, rim: { value: rim } };
  const surface = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  surface.onBeforeCompile = (s) => patch(s, u, true);
  surface.customProgramCacheKey = () => 'ctx-rounded';
  const depth = new MeshDepthMaterial();
  depth.onBeforeCompile = (s) => patch(s, u, false);
  depth.customProgramCacheKey = () => 'ctx-rounded-depth';
  return { surface, depth, rim: u.rim };
}

export interface Fade {
  from: { value: number };
  to: { value: number };
}

export function fadeMaterial(color: string): { material: MeshStandardMaterial; fade: Fade } {
  const fade = { from: { value: 100 }, to: { value: 101 } };
  const material = new MeshStandardMaterial({ color, roughness: 1, metalness: 0, transparent: true });
  material.onBeforeCompile = (s) => {
    s.uniforms.uFadeFrom = fade.from;
    s.uniforms.uFadeTo = fade.to;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;\nuniform float uFadeFrom;\nuniform float uFadeTo;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= 1.0 - smoothstep(uFadeFrom, uFadeTo, length(vWorld.xz));');
  };
  material.customProgramCacheKey = () => 'ctx-plate-fade';
  return { material, fade };
}
