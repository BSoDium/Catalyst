let cached: boolean | undefined;

/**
 * Whether a WebGL context can be created at all. Probed once per page with a throwaway canvas that is released
 * straight away, so the failure path is a calm UI state instead of an exception and a console error from Three.
 */
export function isWebGLAvailable(): boolean {
  if (cached !== undefined) return cached;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    cached = gl !== null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    cached = false;
  }
  return cached;
}
