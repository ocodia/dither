import { clone } from '../model/document.js';
import { textFont } from '../rendering/renderer.js';

// A native textarea supplies caret movement, selection, clipboard and IME input.
// Its box uses the same world transform as the selected layer.
export class TextEditor {
  constructor({ workspace, controls, renderer, getLayer, getDocument, record, preview, onDirty, onFinish }) {
    Object.assign(this, { workspace, controls, renderer, getLayer, getDocument, record, preview, onDirty, onFinish });
    this.element = document.createElement('div'); this.element.id = 'text-editor'; this.element.hidden = true;
    this.input = document.createElement('textarea');
    this.input.setAttribute('aria-label', 'Text content'); this.input.dataset.path = 'text.content';
    this.input.spellcheck = false; this.input.wrap = 'soft';
    this.metrics = document.createElement('canvas').getContext('2d');
    this.element.append(this.input); workspace.element.append(this.element);
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'dblclick', 'contextmenu']) {
      this.element.addEventListener(type, e => e.stopPropagation());
    }
    this.input.addEventListener('input', () => {
      if (!this.layer) return;
      this.layer.text.content = this.input.value; this.onDirty();
    });
    this.input.addEventListener('keydown', e => {
      if (!e.isComposing && e.key.toLowerCase() === 's' && (e.ctrlKey || e.metaKey)) {
        this.checkpoint(); return; // Let the document save shortcut handle this.
      }
      // Let the platform handle composition and native text undo/redo.
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.preventDefault(); this.finish(false); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.finish(); }
    });
    document.addEventListener('pointerdown', e => {
      if (this.layer && !this.contains(e.target)) this.finish();
    }, true);
    document.addEventListener('focusin', e => {
      if (this.layer && !this.contains(e.target)) this.finish();
    });
  }
  contains(target) { return this.element.contains(target) || this.controls.contains(target); }
  get dirty() { return !!this.layer && this.layer.text.content !== this.before; }
  begin(layer) {
    if (layer?.type !== 'text' || layer.locked || !layer.visible) return;
    this.finish();
    this.layer = layer; this.document = this.getDocument(); this.before = layer.text.content;
    this.input.value = layer.text.content;
    this.renderer.editingLayerId = layer.id; this.element.hidden = false;
    this.draw(); this.preview(); this.workspace.draw();
    this.input.focus({ preventScroll: true });
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }
  checkpoint() {
    if (!this.layer || !this.dirty) return;
    const layer = this.layer, before = { ...clone(layer.text), content: this.before };
    this.before = layer.text.content;
    this.record(layer, before, clone(layer.text));
  }
  finish(commit = true) {
    if (!this.layer) return;
    const layer = this.layer, before = this.before;
    this.layer = null; this.element.hidden = true; this.renderer.editingLayerId = null;
    if (!commit) layer.text.content = before;
    else if (layer.text.content !== before && this.getDocument() === this.document && this.getDocument().layers.includes(layer)) {
      this.record(layer, { ...clone(layer.text), content: before }, clone(layer.text));
    }
    if (this.element.contains(document.activeElement)) this.workspace.element.focus({ preventScroll: true });
    this.preview(); this.workspace.draw(); this.onDirty(); this.onFinish();
  }
  sync() {
    if (this.layer && (this.getLayer() !== this.layer || this.getDocument() !== this.document || !this.document.layers.includes(this.layer) || this.layer.locked || !this.layer.visible)) this.finish();
    this.draw();
  }
  draw() {
    if (!this.layer) return;
    const { transform: t, text } = this.layer, v = this.workspace.view;
    Object.assign(this.element.style, {
      width: `${t.width}px`, height: `${t.height}px`,
      transform: `translate(${v.x + t.x * v.zoom}px,${v.y + t.y * v.zoom}px) scale(${v.zoom}) rotate(${t.rotation}deg) scale(${t.flipX ? -1 : 1},${t.flipY ? -1 : 1}) translate(-50%,-50%)`,
      opacity: this.layer.opacity
    });
    const leading = text.fontSize * (text.lineHeight - 1);
    const font = textFont(text);
    if (this.font !== font) {
      this.font = font;
      document.fonts.load(font, text.content || ' ').then(() => {
        if (this.layer && this.font === font) this.draw();
      }).catch(() => {}); // The native editor and canvas share the fallback font.
    }
    this.metrics.font = font; this.metrics.textBaseline = 'alphabetic';
    const metrics = this.metrics.measureText('Mg');
    this.metrics.textBaseline = 'top';
    const top = this.metrics.measureText('Mg');
    // CSS centres a font's ascent/descent in its line box. Canvas's `top`
    // baseline uses a different origin; compensate so editing doesn't jump.
    const offset = Number.isFinite(metrics.fontBoundingBoxAscent) ?
      metrics.actualBoundingBoxAscent - top.actualBoundingBoxAscent - metrics.fontBoundingBoxAscent -
      (text.fontSize * text.lineHeight - metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2 : -leading / 2;
    Object.assign(this.input.style, {
      fontFamily: `${JSON.stringify(text.fontFamily === 'Noto' ? 'Noto Sans' : text.fontFamily)}, Inter, sans-serif`,
      fontSize: `${text.fontSize}px`, fontWeight: text.fontWeight, fontStyle: text.fontStyle,
      lineHeight: String(text.lineHeight), letterSpacing: `${text.letterSpacing}px`, textAlign: text.align,
      color: text.colour, caretColor: text.colour, top: `${offset}px`, height: `${t.height + Math.abs(offset) + Math.abs(leading)}px`
    });
  }
}
