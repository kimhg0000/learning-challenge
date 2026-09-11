// Deterministic textured pixels, generated locally; never student photographs.
export function texturedPixels(width: number, height: number): Buffer {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 42;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed >>> 24) / 4;
    const i = (y * width + x) * 3;
    pixels[i] = Math.min(255, x / width * 180 + noise);
    pixels[i+1] = Math.min(255, y / height * 180 + noise);
    pixels[i+2] = Math.min(255, 80 + 70 * Math.sin(x / 70) * Math.cos(y / 90) + noise);
  }
  return pixels;
}
