// The welcome's "sens", filled with a moving, grainy gradient of the Signal
// tones, drawn by WebGL2 on a canvas behind the letters.

const TOKENS = ["--sens-signal-200", "--sens-signal-500", "--sens-signal-700"];
const GROUND = "--sens-carbon-950";

const VERTEX = `#version 300 es
in vec2 position;
void main() {
gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec3 uGround;
out vec4 fragColor;
const float TIME_SPEED = 0.45;
const float WARP_STRENGTH = 2.2;
const float WARP_FREQUENCY = 6.0;
const float WARP_SPEED = 2.6;
const float WARP_AMPLITUDE = 14.0;
const float BLEND_SOFTNESS = 0.04;
const float ROTATION_AMOUNT = 420.0;
const float NOISE_SCALE = 2.0;
const float GRAIN_AMOUNT = 0.12;
const float GRAIN_SCALE = 2.0;
const float CONTRAST = 1.5;
const float ZOOM = 0.55;
#define S(a,b,t) smoothstep(a,b,t)
mat2 Rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
vec2 hash(vec2 p){p=vec2(dot(p,vec2(2127.1,81.17)),dot(p,vec2(1269.5,283.37)));return fract(sin(p)*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);float n=mix(mix(dot(-1.0+2.0*hash(i+vec2(0.0,0.0)),f-vec2(0.0,0.0)),dot(-1.0+2.0*hash(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),mix(dot(-1.0+2.0*hash(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),dot(-1.0+2.0*hash(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);return 0.5+0.5*n;}
void main(){
float t=iTime*TIME_SPEED;
vec2 uv=gl_FragCoord.xy/iResolution.xy;
float ratio=iResolution.x/iResolution.y;
vec2 tuv=(uv-0.5)/ZOOM;
float degree=noise(vec2(t*0.1,tuv.x*tuv.y)*NOISE_SCALE);
tuv.y*=1.0/ratio;
tuv*=Rot(radians((degree-0.5)*ROTATION_AMOUNT+180.0));
tuv.y*=ratio;
float amplitude=WARP_AMPLITUDE/WARP_STRENGTH;
float warpTime=t*WARP_SPEED;
tuv.x+=sin(tuv.y*WARP_FREQUENCY+warpTime)/amplitude;
tuv.y+=sin(tuv.x*(WARP_FREQUENCY*1.5)+warpTime)/(amplitude*0.5);
float edge0=-0.3-BLEND_SOFTNESS;
float edge1=0.2+BLEND_SOFTNESS;
vec3 layer1=mix(uColor3,uColor2,S(edge0,edge1,tuv.x));
vec3 layer2=mix(uColor2,uColor1,S(edge0,edge1,tuv.x));
vec3 col=mix(layer1,layer2,S(0.5+BLEND_SOFTNESS,-0.3-BLEND_SOFTNESS,tuv.y));
float grain=fract(sin(dot(uv*GRAIN_SCALE,vec2(12.9898,78.233)))*43758.5453);
col+=(grain-0.5)*GRAIN_AMOUNT;
col=max(clamp((col-0.5)*CONTRAST+0.5,0.0,1.0),uGround);
fragColor=vec4(col,1.0);
}`;

function tokenRgb(name: string) {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim().replace("#", "");
  return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
}

function shader(gl: WebGL2RenderingContext, kind: number, source: string) {
  const made = gl.createShader(kind);
  if (!made) return null;
  gl.shaderSource(made, source);
  gl.compileShader(made);
  return gl.getShaderParameter(made, gl.COMPILE_STATUS) ? made : null;
}

function program(gl: WebGL2RenderingContext) {
  const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const made = vertex && fragment && gl.createProgram();
  if (!made) return null;
  gl.attachShader(made, vertex!);
  gl.attachShader(made, fragment!);
  gl.linkProgram(made);
  return gl.getProgramParameter(made, gl.LINK_STATUS) ? made : null;
}

// Draws on `canvas`, sized to `mark`, while the mark is on screen (once, with
// reduced motion). Returns how to stop, or null when WebGL2 is not there.
export function grain(canvas: HTMLCanvasElement, mark: HTMLElement): (() => void) | null {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
  const made = gl && program(gl);
  if (!gl || !made) return null;

  gl.useProgram(made);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(made, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  TOKENS.forEach((token, at) => gl.uniform3fv(gl.getUniformLocation(made, `uColor${at + 1}`), tokenRgb(token)));
  gl.uniform3fv(gl.getUniformLocation(made, "uGround"), tokenRgb(GROUND));
  const resolution = gl.getUniformLocation(made, "iResolution");
  const clock = gl.getUniformLocation(made, "iTime");

  const fit = () => {
    const box = mark.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(box.width * ratio));
    canvas.height = Math.max(1, Math.round(box.height * ratio));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(resolution, canvas.width, canvas.height);
  };
  const watcher = new ResizeObserver(fit);
  watcher.observe(mark);
  fit();

  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const started = performance.now();
  let shown = false;
  let pending = 0;
  const frame = (now: number) => {
    pending = 0;
    gl.uniform1f(clock, (now - started) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (shown && !still) pending = requestAnimationFrame(frame);
  };
  const sight = new IntersectionObserver(([seen]) => {
    shown = seen.isIntersecting;
    if (shown && !pending) pending = requestAnimationFrame(frame);
  });
  sight.observe(mark);
  pending = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(pending);
    watcher.disconnect();
    sight.disconnect();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
}
