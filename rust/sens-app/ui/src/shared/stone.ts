export type StoneState = "idle" | "scan" | "focus" | "done" | "rest";

export interface Stone {
  set(state: StoneState): void;
  destroy(): void;
}

const VERTEX = `
attribute vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }
`;

const FRAGMENT = `
precision highp float;

uniform vec2 size;
uniform float glow;
uniform float scanAt;
uniform float scanning;
uniform float reveal;
uniform float flash;
uniform float seed;

const float PI = 3.14159265;
const vec3 SIGNAL = vec3(0.571, 1.0, 0.069);
const vec3 HOT = vec3(0.86, 1.0, 0.62);
const float BEND = 0.2;
const float GAP = 0.018;
const float LIP = 0.05;
const float FLOOR = -0.9;

mat3 turn() {
  float a = 0.5;
  float b = -0.22;
  float c = 0.38;
  mat3 z = mat3(cos(a), sin(a), 0.0, -sin(a), cos(a), 0.0, 0.0, 0.0, 1.0);
  mat3 x = mat3(1.0, 0.0, 0.0, 0.0, cos(b), sin(b), 0.0, -sin(b), cos(b));
  mat3 y = mat3(cos(c), 0.0, -sin(c), 0.0, 1.0, 0.0, sin(c), 0.0, cos(c));
  return y * x * z;
}

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

float grain(vec3 p) {
  return noise(p * 240.0) * 0.6 + noise(p * 520.0) * 0.4;
}

float smax(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return max(a, b) + h * h * k * 0.25;
}

vec3 radii(vec3 p) {
  return vec3(0.66 * (1.0 - 0.1 * p.y), 0.96, 0.6 * (1.0 - 0.06 * p.y));
}

float body(vec3 p) {
  vec3 r = radii(p);
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}

float cut(vec3 p) {
  float along = clamp(p.y, -1.2, 1.2);
  float centre = -BEND * sin(PI * along);
  float slope = -BEND * PI * cos(PI * along);
  return (p.x - centre) / sqrt(1.0 + slope * slope);
}

float stone(vec3 p) {
  return smax(body(p), GAP - abs(cut(p)), LIP);
}

vec3 normalAt(vec3 p) {
  vec2 e = vec2(0.0015, -0.0015);
  return normalize(
    e.xyy * stone(p + e.xyy) + e.yyx * stone(p + e.yyx) +
    e.yxy * stone(p + e.yxy) + e.xxx * stone(p + e.xxx));
}

float lit(float along) {
  float drawn = smoothstep(reveal - 0.25, reveal + 0.05, -along) ;
  float head = scanning * exp(-pow((along - scanAt) / 0.16, 2.0)) * 1.6;
  return glow * (1.0 - drawn) * (1.0 + flash) + head;
}

vec3 tonemap(vec3 c) {
  c *= 1.35;
  c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
  return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * size) / size.y;
  vec3 eye = vec3(0.0, 0.32, 4.6);
  vec3 target = vec3(0.0, -0.08, 0.0);
  vec3 forward = normalize(target - eye);
  vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, forward);
  vec3 ray = normalize(forward * 1.6 + uv.x * right + uv.y * up);
  mat3 local = turn();

  vec3 light = normalize(vec3(-0.55, 0.85, 0.55));
  vec3 rim = normalize(vec3(0.8, 0.25, -0.55));

  float dither = hash(vec3(gl_FragCoord.xy, seed)) - 0.5;

  vec3 colour = vec3(0.0);
  float cover = 0.0;
  float halo = 0.0;

  float t = 0.0;
  float hit = -1.0;
  vec3 near = eye - vec3(0.0, 0.0, 0.0);
  float b = dot(near, ray);
  float c = dot(near, near) - 1.2 * 1.2;
  float h = b * b - c;
  if (h > 0.0) {
    t = max(-b - sqrt(h), 0.0);
    float leave = -b + sqrt(h);
    for (int i = 0; i < 110; i++) {
      vec3 p = local * (eye + ray * t);
      float d = stone(p);
      float sheet = length(vec2(abs(cut(p)), max(body(p) + 0.02, 0.0)));
      halo += exp(-sheet * 60.0) * lit(p.y) * 0.012;
      if (d < 0.0006) { hit = t; break; }
      t += max(d * 0.8, 0.004);
      if (t > leave) break;
    }
  }

  if (hit > 0.0) {
    vec3 world = eye + ray * hit;
    vec3 p = local * world;
    vec3 n = normalAt(p);
    vec3 e = vec3(0.004, 0.0, 0.0);
    vec3 bump = vec3(grain(p + e.xyy) - grain(p - e.xyy), grain(p + e.yxy) - grain(p - e.yxy), grain(p + e.yyx) - grain(p - e.yyx));
    n = normalize(n - bump * 0.12);
    vec3 v = -(local * ray);
    vec3 l = local * light;
    vec3 r = local * rim;

    float fibre = 0.86 + 0.28 * noise(p * 260.0);
    vec3 albedo = vec3(0.0125, 0.013, 0.0125) * fibre;
    float wrap = max((dot(n, l) + 0.12) / 1.12, 0.0);
    float back = pow(max(dot(n, r), 0.0), 1.5);
    float facing = max(dot(n, v), 0.0);
    float sheen = pow(1.0 - facing, 3.5);
    vec3 halfway = normalize(l + v);
    float spec = pow(max(dot(n, halfway), 0.0), 18.0) * 0.035;

    float occlusion = 1.0;
    for (int k = 1; k < 4; k++) {
      float step = 0.03 * float(k);
      occlusion -= (step - stone(p + n * step)) * (1.6 / float(k));
    }
    occlusion = clamp(occlusion, 0.25, 1.0);

    float away = abs(cut(p));
    float inside = 1.0 - smoothstep(GAP, GAP + 0.012, away);
    float spill = exp(-(away - GAP) * 28.0);
    float towards = clamp(-sign(cut(p)) * n.x * 0.8 + 0.35, 0.0, 1.0);
    float energy = lit(p.y);

    colour = albedo * (2.4 * wrap * vec3(1.0, 0.98, 0.95) + 0.9 * back + 0.06) * occlusion;
    colour += vec3(0.022) * sheen * (0.15 + wrap + back) * occlusion + spec * 0.6 * wrap;
    colour += SIGNAL * energy * spill * towards * 0.3;
    colour += mix(SIGNAL, HOT, inside * inside) * energy * inside * 1.8;
    colour = tonemap(colour);
    cover = 1.0;
  }

  vec3 floorGlow = vec3(0.0);
  float shade = 0.0;
  if (ray.y < 0.0) {
    float f = (FLOOR - eye.y) / ray.y;
    vec3 q = eye + ray * f;
    if (hit < 0.0 || f < hit) {
      float spread = length(q.xz * vec2(0.9, 1.6));
      float fade = exp(-spread * spread * 2.0);
      float shadow = 1.0;
      float s = 0.02;
      for (int k = 0; k < 28; k++) {
        float d = stone(local * (q + light * s));
        shadow = min(shadow, 9.0 * d / s);
        s += clamp(d, 0.02, 0.2);
        if (s > 2.4) break;
      }
      shadow = clamp(shadow, 0.0, 1.0);
      float contact = exp(-max(stone(local * q), 0.0) * 9.0);
      vec3 foot = q - vec3(-0.18, FLOOR, 0.15);
      float pool = exp(-dot(foot.xz, foot.xz) * 5.5);
      floorGlow = vec3(0.06) * shadow * fade * 0.5 + SIGNAL * pool * lit(-0.9) * 0.2 * (0.35 + 0.65 * shadow);
      shade = fade * (0.55 * (1.0 - shadow) + 0.5 * contact);
    }
  }

  vec2 inset = min(gl_FragCoord.xy, size - gl_FragCoord.xy) / size.y;
  float edge = smoothstep(0.0, 0.14, min(inset.x, inset.y));
  floorGlow *= edge;
  shade *= edge;
  vec3 bloom = SIGNAL * halo * (0.8 + 0.2 * HOT) * edge;
  vec3 addition = pow(max(floorGlow + bloom, 0.0), vec3(1.0 / 2.2)) * 0.9;
  vec3 result = colour * cover + addition * (1.0 - cover * 0.6);
  float alpha = cover + (1.0 - cover) * clamp(shade, 0.0, 0.85);
  gl_FragColor = vec4(result + dither / 255.0, alpha);
}
`;

const BREATH = 5000;
const SCAN = 1100;
const FOCUS = 1300;
const DONE = 560;
const SLOW = 40;
const PIXELS = 1_400_000;
const IDLE_FPS = 20;

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);

function compile(gl: WebGLRenderingContext, kind: number, source: string) {
  const shader = gl.createShader(kind);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.warn(gl.getShaderInfoLog(shader));
  return null;
}

function program(gl: WebGLRenderingContext) {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vertex || !fragment) return null;
  const made = gl.createProgram();
  if (!made) return null;
  gl.attachShader(made, vertex);
  gl.attachShader(made, fragment);
  gl.linkProgram(made);
  return gl.getProgramParameter(made, gl.LINK_STATUS) ? made : null;
}

export function mountStone(canvas: HTMLCanvasElement, first: StoneState = "idle"): Stone | null {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const made = program(gl);
  if (!made) return null;
  gl.useProgram(made);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(made, "corner");
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

  const uniform = (name: string) => gl.getUniformLocation(made, name);
  const at = {
    size: uniform("size"),
    glow: uniform("glow"),
    scanAt: uniform("scanAt"),
    scanning: uniform("scanning"),
    reveal: uniform("reveal"),
    flash: uniform("flash"),
    seed: uniform("seed"),
  };

  let state = first;
  let since = performance.now();
  let frame = 0;
  let last = 0;
  let scanning = 0;
  let still = reduced();
  let slowFrames = 0;
  let drawn = 0;
  let gone = false;

  const fit = () => {
    const area = Math.max(1, canvas.clientWidth * canvas.clientHeight);
    const scale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(PIXELS / area));
    const width = Math.max(1, Math.round(canvas.clientWidth * scale));
    const height = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
  };

  const values = (now: number) => {
    const age = now - since;
    const breath = still ? 1 : 0.92 + 0.08 * Math.sin((now / BREATH) * Math.PI * 2);
    const scanTarget = state === "scan" ? 1 : 0;
    scanning += (scanTarget - scanning) * (still ? 1 : 0.08);
    const reveal = state === "focus" && !still ? -1.3 + 2.8 * easeOut(age / FOCUS) : 1.5;
    const flash = state === "done" && !still ? Math.max(0, 1 - age / DONE) * 0.9 : 0;
    const glow = state === "rest" ? 0.1 : state === "idle" ? breath : 1;
    const scanAt = -1.25 + 2.5 * ((now % SCAN) / SCAN);
    return { glow, reveal, flash, scanAt, scanning: still ? 0 : scanning };
  };

  const moving = (now: number) => {
    if (still) return false;
    const age = now - since;
    if (state === "scan" || state === "idle") return true;
    if (state === "focus") return age < FOCUS + 100;
    if (state === "done") return age < DONE + 100;
    return scanning > 0.01;
  };

  const paint = (now: number) => {
    fit();
    const v = values(now);
    gl.uniform2f(at.size, canvas.width, canvas.height);
    gl.uniform1f(at.glow, v.glow);
    gl.uniform1f(at.scanAt, v.scanAt);
    gl.uniform1f(at.scanning, v.scanning);
    gl.uniform1f(at.reveal, v.reveal);
    gl.uniform1f(at.flash, v.flash);
    gl.uniform1f(at.seed, (drawn % 64) + 0.5);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const started = performance.now();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (drawn < 4) {
      gl.finish();
      if (performance.now() - started > SLOW) slowFrames += 1;
      if (slowFrames >= 2) still = true;
    }
    drawn += 1;
  };

  const tick = (now: number) => {
    frame = 0;
    if (gone || document.hidden) return;
    const idle = state === "idle";
    if (!idle || now - last >= 1000 / IDLE_FPS) {
      last = now;
      paint(now);
    }
    if (moving(now)) frame = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (gone || frame) return;
    frame = requestAnimationFrame(tick);
  };

  const resized = new ResizeObserver(() => {
    if (!gone) paint(performance.now());
    wake();
  });
  resized.observe(canvas);

  const shown = () => {
    if (!document.hidden) wake();
  };
  document.addEventListener("visibilitychange", shown);

  const lost = (event: Event) => {
    event.preventDefault();
    gone = true;
  };
  canvas.addEventListener("webglcontextlost", lost);

  wake();

  return {
    set(next) {
      if (next === state && next !== "done" && next !== "focus") return;
      state = next;
      since = performance.now();
      wake();
    },
    destroy() {
      gone = true;
      if (frame) cancelAnimationFrame(frame);
      resized.disconnect();
      document.removeEventListener("visibilitychange", shown);
      canvas.removeEventListener("webglcontextlost", lost);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
