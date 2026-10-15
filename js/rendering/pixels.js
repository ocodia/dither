import { floydSteinberg } from './dither.js';
import { gaussianBlur } from './blur.js';
export function processPixels(data, width, height, effect) {
  if (effect.type === 'blur') return gaussianBlur(data, width, height, effect.radius);
  if (effect.type === 'dither') return floydSteinberg(data, width, height, effect.intensity);
  if (effect.type === 'brightness' || effect.type === 'contrast') {
    const amount = effect.amount, factor = (100 + amount) / Math.max(1, 100 - amount);
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      for (let c = 0; c < 3; c++) data[i + c] = effect.type === 'brightness' ? data[i + c] + amount * 2.55 : (data[i + c] - 127.5) * factor + 127.5;
    }
  }
  if (effect.type === 'stroke') {
    // Two linear-time maximum filters dilate alpha with a square kernel.
    // This defines a consistent outside contour with square joins for all layer types.
    const radius = Math.round(effect.width);
    if (!radius) return data;
    const horizontal = new Uint8Array(width * height), alpha = new Uint8Array(width * height);
    const deque = new Int32Array(Math.max(width, height));
    for (let y = 0; y < height; y++) {
      let head = 0, tail = 0, added = -1;
      for (let x = 0; x < width; x++) {
        const end = Math.min(width - 1, x + radius);
        while (added < end) {
          added++; const value = data[(y * width + added) * 4 + 3];
          while (tail > head && data[(y * width + deque[tail - 1]) * 4 + 3] <= value) tail--;
          deque[tail++] = added;
        }
        while (tail > head && deque[head] < x - radius) head++;
        horizontal[y * width + x] = data[(y * width + deque[head]) * 4 + 3];
      }
    }
    for (let x = 0; x < width; x++) {
      let head = 0, tail = 0, added = -1;
      for (let y = 0; y < height; y++) {
        const end = Math.min(height - 1, y + radius);
        while (added < end) {
          added++; const value = horizontal[added * width + x];
          while (tail > head && horizontal[deque[tail - 1] * width + x] <= value) tail--;
          deque[tail++] = added;
        }
        while (tail > head && deque[head] < y - radius) head++;
        alpha[y * width + x] = horizontal[deque[head] * width + x];
      }
    }
    const rgb = [1, 3, 5].map(i => parseInt(effect.colour.slice(i, i + 2), 16));
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const source = data[i + 3] / 255, outline = Math.max(0, alpha[p] / 255 - source) * effect.opacity;
      const out = source + outline * (1 - source);
      if (out) for (let c = 0; c < 3; c++) data[i + c] = (data[i + c] * source + rgb[c] * outline * (1 - source)) / out;
      data[i + 3] = out * 255;
    }
  }
  return data;
}
