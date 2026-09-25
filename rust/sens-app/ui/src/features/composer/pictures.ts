export const SENT_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const RAW_PICTURE_CAP = 25 * 1024 * 1024;
export const SENT_CAP = 5 * 1024 * 1024;
export const LONG_EDGE = 2576;
export const MOST_PIXELS = 3_750_000;

const PHOTOS = new Set(["image/jpeg", "image/avif", "image/heic", "image/heif"]);
const VECTOR = "image/svg+xml";
const VECTOR_EDGE = 1600;
const SHRINK = 0.75;
const TRIES = 6;
const NAMES: Record<string, string> = { "image/svg+xml": "SVG", "image/x-icon": "ICO", "image/vnd.microsoft.icon": "ICO" };

export interface Size {
  width: number;
  height: number;
}

export interface Fitted extends Size {
  bytes: number;
  mediaType: string;
  url: string;
  was?: Size & { mediaType: string };
}

export interface Tools {
  decode: (blob: Blob) => Promise<(Size & { release: () => void; source: CanvasImageSource }) | null>;
  draw: (source: CanvasImageSource, size: Size, type: string, quality?: number) => Promise<Blob | null>;
  urlOf: (blob: Blob) => Promise<string>;
}

export const encoded = (bytes: number) => Math.ceil(bytes / 3) * 4;

export const typeName = (mediaType: string) => NAMES[mediaType] ?? mediaType.replace(/^image\//, "").toUpperCase();

export function fitted({ width, height }: Size): Size {
  const scale = Math.min(1, LONG_EDGE / Math.max(width, height), Math.sqrt(MOST_PIXELS / (width * height)));
  const cut = (side: number) => Math.max(1, Math.floor(side * scale + 1e-6));
  return { width: cut(width), height: cut(height) };
}

export function drawnSize(mediaType: string, natural: Size): Size {
  if (mediaType !== VECTOR) return fitted(natural);
  const width = natural.width || VECTOR_EDGE;
  const height = natural.height || VECTOR_EDGE;
  const grow = VECTOR_EDGE / Math.max(width, height);
  return fitted({ width: Math.round(width * Math.max(grow, 1)), height: Math.round(height * Math.max(grow, 1)) });
}

export const encodings = (mediaType: string): [string, number?][] =>
  PHOTOS.has(mediaType)
    ? [["image/jpeg", 0.9], ["image/webp", 0.88], ["image/jpeg", 0.8]]
    : [["image/png"], ["image/webp", 0.9], ["image/jpeg", 0.85]];

export const readAsUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });

function decode(blob: Blob): ReturnType<Tools["decode"]> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  const release = () => URL.revokeObjectURL(url);
  image.src = url;
  return Promise.resolve()
    .then(() => image.decode())
    .then(
      () => ({ width: image.naturalWidth, height: image.naturalHeight, source: image, release }),
      () => (release(), null),
    );
}

function draw(source: CanvasImageSource, { width, height }: Size, type: string, quality?: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const pen = canvas.getContext("2d");
  if (!pen) return Promise.resolve(null);
  if (type === "image/jpeg") {
    pen.fillStyle = "white";
    pen.fillRect(0, 0, width, height);
  }
  pen.imageSmoothingQuality = "high";
  pen.drawImage(source, 0, 0, width, height);
  return new Promise<Blob | null>((done) => canvas.toBlob(done, type, quality));
}

const BROWSER: Tools = { decode, draw, urlOf: readAsUrl };

export async function fitPicture(blob: Blob, tools: Tools = BROWSER): Promise<Fitted | null> {
  const image = await tools.decode(blob);
  if (!image) return null;
  try {
    const natural = { width: image.width, height: image.height };
    let size = drawnSize(blob.type, natural);
    const whole = size.width === natural.width && size.height === natural.height;
    if (whole && SENT_TYPES.has(blob.type) && encoded(blob.size) <= SENT_CAP) return { ...natural, bytes: blob.size, mediaType: blob.type, url: await tools.urlOf(blob) };
    for (let tries = 0; tries < TRIES; tries++) {
      for (const [type, quality] of encodings(blob.type)) {
        const made = await tools.draw(image.source, size, type, quality);
        if (!made || made.type !== type || encoded(made.size) > SENT_CAP) continue;
        return { ...size, bytes: made.size, mediaType: type, url: await tools.urlOf(made), was: { ...natural, mediaType: blob.type } };
      }
      size = { width: Math.max(1, Math.floor(size.width * SHRINK)), height: Math.max(1, Math.floor(size.height * SHRINK)) };
    }
    return null;
  } finally {
    image.release();
  }
}
