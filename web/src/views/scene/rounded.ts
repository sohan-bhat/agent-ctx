import { MeshDepthMaterial, MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from 'three';

const helpers = /* glsl */ `
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

function patch(shader: WebGLProgramParametersWithUniforms, edge: { value: number }, normals: boolean) {
  shader.uniforms.uEdge = edge;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${helpers}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n#ifdef USE_INSTANCING\ntransformed = ctxRound(position, normal);\n#endif`);
  if (normals) shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n#ifdef USE_INSTANCING\nobjectNormal *= ctxScale();\n#endif`);
}

export function blockMaterials(edge: number): { surface: MeshStandardMaterial; depth: MeshDepthMaterial; edge: { value: number } } {
  const uniform = { value: edge };
  const surface = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  surface.onBeforeCompile = (s) => patch(s, uniform, true);
  surface.customProgramCacheKey = () => 'ctx-rounded';
  const depth = new MeshDepthMaterial();
  depth.onBeforeCompile = (s) => patch(s, uniform, false);
  depth.customProgramCacheKey = () => 'ctx-rounded-depth';
  return { surface, depth, edge: uniform };
}
