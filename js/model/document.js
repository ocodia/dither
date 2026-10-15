import { validPath, validGradient, canGradient, editableStops } from './vector.js';
import { validRegion } from './pixel-region.js';

export const VERSION = 2;
export const uid = () => crypto.randomUUID();
export const clone = value => structuredClone(value);
export const MAX_EDGE = 8192;
export const MAX_PIXELS = 32_000_000;

export function checkSize(width, height) {
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= MAX_EDGE) || width * height > MAX_PIXELS)
    throw new Error('Use whole dimensions from 1 to 8192 pixels, with at most 32 million pixels.');
}
export function createDocument({ name = 'Untitled', width = 1600, height = 1000, background = null } = {}) {
  checkSize(width, height);
  return { version: VERSION, id: uid(), name, created: Date.now(), modified: Date.now(), canvas: { width, height, background }, layers: [], assets: [] };
}
export function createLayer(type, canvas, options = {}) {
  const width = type === 'text' ? 480 : 320, height = type === 'text' ? 140 : 240;
  const layer = { id: uid(), name: type === 'image' ? 'Image' : type === 'text' ? 'Text' : 'Rectangle', type,
    visible: true, locked: false, opacity: 1,
    transform: { x: canvas.width / 2, y: canvas.height / 2, width, height, rotation: 0, flipX: false, flipY: false }, effects: [] };
  if (type === 'text') layer.text = { content: 'Text', fontFamily: 'Arial', fontSize: 48, fontWeight: '700', fontStyle: 'normal', colour: '#f4f6fa', align: 'left', lineHeight: 1.2, letterSpacing: 0 };
  if (type === 'shape') layer.shape = { kind: 'rectangle', fill: '#6799f5', fillOpacity: 1, stroke: '#dbe7ff', strokeWidth: 0, strokeOpacity: 1, radius: 16, startArrow: false, endArrow: true, arrowSize: 22 };
  if (type === 'image') layer.assetId = '';
  return Object.assign(layer, options);
}

export function migrateDocument(value) {
  const doc = clone(value);
  if (doc?.version === 1) doc.version = VERSION;
  validateDocument(doc);
  for (const layer of doc.layers) if (layer.shape?.gradient) layer.shape.gradient.stops=editableStops(layer.shape.gradient.stops);
  return validateDocument(doc);
}
export function validateDocument(doc) {
  if (!doc || doc.version !== VERSION) throw new Error('This project version is not supported by this version of Dither.');
  checkSize(doc.canvas?.width, doc.canvas?.height);
  if (typeof doc.id !== 'string' || typeof doc.name !== 'string' || !Array.isArray(doc.layers) || !Array.isArray(doc.assets)) throw new Error('Invalid project structure.');
  if (doc.canvas.background !== null && !/^#[\da-f]{6}$/i.test(doc.canvas.background)) throw new Error('Invalid background colour.');
  const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const colour = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
  const ids = new Set(), assetIds = new Set(doc.assets.map(a => a?.id));
  if (assetIds.size !== doc.assets.length) throw new Error('Duplicate asset IDs.');
  if (doc.assets.some(a => !a || typeof a.id !== 'string' || typeof a.name !== 'string')) throw new Error('Invalid asset metadata.');
  for (const layer of doc.layers) {
    if (!layer || !['image', 'text', 'shape'].includes(layer.type) || typeof layer.id !== 'string' || ids.has(layer.id)) throw new Error('Invalid or duplicate layer.');
    ids.add(layer.id);
    const t = layer.transform;
    if (!t || !['x', 'y', 'width', 'height', 'rotation'].every(key => Number.isFinite(t[key])) || t.width < 1 || t.height < 1 || t.width > MAX_EDGE || t.height > MAX_EDGE || t.width * t.height > MAX_PIXELS) throw new Error('Invalid layer transform.');
    if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1 || !Array.isArray(layer.effects)) throw new Error('Invalid layer properties.');
    if (typeof layer.name !== 'string' || typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean' || typeof t.flipX !== 'boolean' || typeof t.flipY !== 'boolean') throw new Error('Invalid layer properties.');
    if (layer.type === 'image' && !assetIds.has(layer.assetId)) throw new Error('An image layer references a missing asset.');
    if (layer.eraseRegions !== undefined && (layer.type !== 'image' || !Array.isArray(layer.eraseRegions) || !layer.eraseRegions.every(validRegion))) throw new Error('Invalid image pixel edits.');
    if (layer.type === 'text') {
      const p = layer.text;
      if (!p || typeof p.content !== 'string' || typeof p.fontFamily !== 'string' || !finite(p.fontSize, 1, 600) || !['400','500','700','900'].includes(p.fontWeight) || !['normal','italic'].includes(p.fontStyle) || !['left','center','right'].includes(p.align) || !colour(p.colour) || !finite(p.lineHeight,.5,4) || !finite(p.letterSpacing,-10,50)) throw new Error('Invalid text layer.');
    }
    if (layer.type === 'shape' && !['rectangle', 'ellipse', 'line', 'arrow', 'path'].includes(layer.shape?.kind)) throw new Error('Invalid shape layer.');
    if (layer.type === 'shape') {
      const s = layer.shape;
      if (s.kind === 'path' && !validPath(s)) throw new Error('Invalid path anchors.');
      if (s.gradient !== undefined && (!canGradient(layer) || !validGradient(s.gradient))) throw new Error('Invalid gradient fill.');
      if (!colour(s.fill) || !colour(s.stroke) || !finite(s.fillOpacity,0,1) || !finite(s.strokeOpacity,0,1) || !finite(s.strokeWidth,0,100) || !finite(s.radius,0,1000) || !finite(s.arrowSize,1,500) || typeof s.startArrow !== 'boolean' || typeof s.endArrow !== 'boolean') throw new Error('Invalid shape style.');
    }
    const effectIds = new Set();
    for (const effect of layer.effects) {
      if (!effect || typeof effect.id !== 'string' || effectIds.has(effect.id) || typeof effect.enabled !== 'boolean' || !['brightness', 'contrast', 'dither', 'colour-overlay', 'stroke', 'blur', 'drop-shadow'].includes(effect.type)) throw new Error('Invalid or unsupported effect.');
      effectIds.add(effect.id);
      for (const value of Object.values(effect)) if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid effect value.');
      const e = effect;
      const valid = {
        brightness: () => finite(e.amount,-100,100), contrast: () => finite(e.amount,-100,100),
        dither: () => e.algorithm === 'floyd-steinberg' && finite(e.intensity,0,1),
        'colour-overlay': () => colour(e.colour) && finite(e.opacity,0,1) && e.blendMode === 'normal',
        stroke: () => colour(e.colour) && finite(e.opacity,0,1) && finite(e.width,0,24) && e.position === 'outside',
        blur: () => finite(e.radius,0,40),
        'drop-shadow': () => colour(e.colour) && finite(e.opacity,0,1) && finite(e.offsetX,-100,100) && finite(e.offsetY,-100,100) && finite(e.blur,0,40)
      };
      if (!valid[e.type]()) throw new Error(`Invalid ${e.type} effect settings.`);
    }
  }
  return doc;
}
