// Three separable box blurs approximate a Gaussian in linear time. Work in
// premultiplied colour so transparent pixels cannot introduce dark/colour halos.
export function gaussianBlur(data, width, height, sigma) {
  if (sigma <= 0) return data;
  let lower = Math.floor(Math.sqrt(4 * sigma * sigma + 1));
  if (lower % 2 === 0) lower--;
  const count = Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
  const radii = Array.from({ length: 3 }, (_, i) => ((i < count ? lower : lower + 2) - 1) / 2);
  const size = width * height, out = new Uint8ClampedArray(data.length);
  const values = new Float32Array(size), scratch = new Float32Array(size);
  const alpha = new Float32Array(size);
  // Process alpha first and retain its unrounded values for unpremultiplication.
  for (const channel of [3, 0, 1, 2]) {
    for (let p = 0; p < size; p++) values[p] = channel === 3 ? data[p * 4 + 3] : data[p * 4 + channel] * data[p * 4 + 3] / 255;
    for (const radius of radii) {
      if (!radius) continue;
      boxPass(values, scratch, width, height, radius, false);
      boxPass(scratch, values, width, height, radius, true);
    }
    if (channel === 3) alpha.set(values);
    for (let p = 0; p < size; p++) out[p * 4 + channel] = channel === 3 ? values[p] : out[p * 4 + 3] && alpha[p] > 0 ? values[p] * 255 / alpha[p] : 0;
  }
  return out;
}

function boxPass(source, target, width, height, radius, vertical) {
  const lines = vertical ? width : height, length = vertical ? height : width;
  const step = vertical ? width : 1, divisor = radius * 2 + 1;
  for (let line = 0; line < lines; line++) {
    const start = vertical ? line : line * width;
    let sum = 0;
    for (let i = 0; i <= Math.min(radius, length - 1); i++) sum += source[start + i * step];
    for (let i = 0; i < length; i++) {
      target[start + i * step] = sum / divisor;
      if (i - radius >= 0) sum -= source[start + (i - radius) * step];
      if (i + radius + 1 < length) sum += source[start + (i + radius + 1) * step];
    }
  }
}
