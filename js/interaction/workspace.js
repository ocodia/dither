import { clone } from '../model/document.js';
import { hitTest, resizeTransform, lineEndpoints, moveLineEndpoint } from './geometry.js';
import { isLineLayer } from '../model/line.js';
import { isSelectionTool } from '../model/pixel-region.js';
export class Workspace {
  constructor({ element, stage, overlay, getDocument, getSelected, select, preview, commit, beforeGesture, onView }) {
    Object.assign(this, { element, stage, overlay, getDocument, getSelected, select, preview, commit, beforeGesture, onView });
    this.view = { x: 0, y: 0, zoom: 1 }; this.tool = 'move'; this.space = false; this.gesture = null; this.autoFit = true;
    element.addEventListener('pointerdown', e => this.down(e));
    element.addEventListener('pointermove', e => { this.pointer = { clientX: e.clientX, clientY: e.clientY }; this.move(e); });
    element.addEventListener('pointerleave', () => { this.pointer = null; });
    element.addEventListener('pointerup', () => this.finish());
    element.addEventListener('pointercancel', () => this.finish(true));
    element.addEventListener('lostpointercapture', () => this.finish(true));
    element.addEventListener('wheel', e => { e.preventDefault(); const rect = element.getBoundingClientRect(); this.zoomAt(Math.exp(-e.deltaY * 0.0015), { x: e.clientX - rect.left, y: e.clientY - rect.top }); }, { passive: false });
    new ResizeObserver(() => this.autoFit ? this.fit() : this.draw()).observe(element);
  }
  point(e) { const rect = this.element.getBoundingClientRect(); return { x: (e.clientX - rect.left - this.view.x) / this.view.zoom, y: (e.clientY - rect.top - this.view.y) / this.view.zoom }; }
  setTool(tool) { this.tools?.cancel(); this.finish(true); this.pixelSelection?.cancelDraft(); this.tool = tool; this.element.classList.toggle('drawing-tool', !!this.tools?.active()); this.element.classList.toggle('hand', tool === 'hand'); this.element.classList.toggle('pixel-tool', isSelectionTool(tool)); this.draw(); }
  fit() { this.autoFit = true; const c = this.getDocument().canvas, { width, height } = this.element.getBoundingClientRect(); this.view.zoom = Math.max(.01, Math.min(2, (width - 110) / c.width, (height - 150) / c.height)); this.view.x = (width - c.width * this.view.zoom) / 2; this.view.y = (height - c.height * this.view.zoom) / 2; this.draw(); }
  zoomAt(factor, point = { x: this.element.clientWidth / 2, y: this.element.clientHeight / 2 }) {
    this.autoFit = false;
    const before = this.view.zoom, after = Math.max(.01, Math.min(16, before * factor));
    this.view.x = point.x - (point.x - this.view.x) * after / before; this.view.y = point.y - (point.y - this.view.y) * after / before; this.view.zoom = after; this.draw();
  }
  down(e) {
    if (e.target.closest('button, input, select, label, #tool-options') || ![0, 1].includes(e.button)) return;
    this.beforeGesture(); this.element.focus({ preventScroll: true });
    const point = this.point(e), pan = e.button === 1 || this.space || this.tool === 'hand';
    if (pan) { this.autoFit = false; this.gesture = { type: 'pan', start: { x: e.clientX, y: e.clientY }, view: { ...this.view } }; }
    else {
      const handle = e.target.closest('[data-handle]'), rotation = e.target.closest('[data-rotate]'), endpoint = e.target.closest('[data-endpoint]');
      if (!handle && !rotation && !endpoint) this.select(hitTest(this.getDocument().layers, point, 6 / this.view.zoom)?.id || null);
      const layer = this.getSelected(); if (!layer || layer.locked || !layer.visible) return;
      this.gesture = { type: endpoint ? 'endpoint' : rotation ? 'rotate' : handle ? 'resize' : 'move', endpoint: Number(endpoint?.dataset.endpoint), start: point, layer, before: clone(layer.transform), handle: handle?.dataset.handle.split(',').map(Number) };
    }
    e.preventDefault(); this.pointerId = e.pointerId; this.element.setPointerCapture(e.pointerId); this.element.classList.add('dragging');
  }
  move(e) {
    const p = this.point(e);
    const g = this.gesture; if (!g) return;
    if (g.type === 'pan') { this.view.x = g.view.x + e.clientX - g.start.x; this.view.y = g.view.y + e.clientY - g.start.y; this.draw(); return; }
    const delta = { x: p.x - g.start.x, y: p.y - g.start.y }, t = g.before;
    if (g.type === 'move') g.layer.transform = { ...t, x: t.x + delta.x, y: t.y + delta.y };
    if (g.type === 'resize') g.layer.transform = resizeTransform(t, g.handle, delta, { shift: e.shiftKey, alt: e.altKey });
    if (g.type === 'endpoint') {
      const endpoint = lineEndpoints(t)[g.endpoint];
      g.layer.transform = moveLineEndpoint(t, g.endpoint, { x: endpoint.x + delta.x, y: endpoint.y + delta.y }, { shift: e.shiftKey });
    }
    if (g.type === 'rotate') {
      let rotation = t.rotation + (Math.atan2(p.y - t.y, p.x - t.x) - Math.atan2(g.start.y - t.y, g.start.x - t.x)) * 180 / Math.PI;
      if (e.shiftKey) rotation = Math.round(rotation / 15) * 15;
      g.layer.transform = { ...t, rotation: ((rotation % 360) + 360) % 360 };
    }
    this.preview(); this.draw();
  }
  finish(cancel = false) {
    const g = this.gesture; if (!g) return; this.gesture = null; this.element.classList.remove('dragging');
    if (this.element.hasPointerCapture(this.pointerId)) this.element.releasePointerCapture(this.pointerId);
    if (g.type !== 'pan') { if (cancel) { g.layer.transform = g.before; this.preview(); } else this.commit(g.layer, g.before, clone(g.layer.transform)); }
    this.draw();
  }
  draw() {
    const c = this.getDocument().canvas, { x, y, zoom } = this.view;
    this.stage.style.width = `${c.width}px`; this.stage.style.height = `${c.height}px`; this.stage.style.transform = `translate(${x}px,${y}px) scale(${zoom})`;
    // SVG maps world coordinates directly into the viewport, without CSS scaling.
    const width = this.element.clientWidth, height = this.element.clientHeight;
    this.overlay.setAttribute('viewBox', `${-x / zoom} ${-y / zoom} ${width / zoom} ${height / zoom}`);
    const layer = this.getSelected();
    const toolOverlay = this.tools?.overlay();
    if (toolOverlay != null) this.overlay.innerHTML = toolOverlay;
    else if (!layer || !layer.visible || layer.locked) this.overlay.innerHTML = '';
    else if (this.pixelSelection && (isSelectionTool(this.tool) || this.pixelSelection.current())) this.overlay.innerHTML = this.pixelSelection.overlay(layer, zoom);
    else if (isLineLayer(layer)) {
      const [start, end] = lineEndpoints(layer.transform);
      this.overlay.innerHTML = `<g fill="white" stroke="#84abff" stroke-width="${1 / zoom}"><path d="M${start.x} ${start.y}L${end.x} ${end.y}" fill="none" stroke-dasharray="${3 / zoom} ${3 / zoom}"/>${[start, end].map((p, index) => `<circle data-endpoint="${index}" cx="${p.x}" cy="${p.y}" r="${5 / zoom}" style="pointer-events:all;cursor:crosshair"/>`).join('')}</g>`;
    } else {
      const t = layer.transform, w = t.width, h = t.height, size = 7 / zoom, length = 28 / zoom;
      const handles = [[-1,-1],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0]];
      const cursors = ['nwse','ns','nesw','ew','nwse','ns','nesw','ew'];
      this.overlay.innerHTML = `<g transform="translate(${t.x} ${t.y}) rotate(${t.rotation})" fill="white" stroke="#84abff" stroke-width="${1 / zoom}"><rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" fill="none"/><path d="M0 ${-h/2}v${-length}" fill="none"/><circle data-rotate="true" cx="0" cy="${-h/2-length}" r="${4.5/zoom}"/>${handles.map(([hx,hy], index) => `<rect data-handle="${hx},${hy}" x="${hx*w/2-size/2}" y="${hy*h/2-size/2}" width="${size}" height="${size}" style="cursor:${cursors[index]}-resize"/>`).join('')}</g>`;
    }
    this.onView(this.view);
  }
}
