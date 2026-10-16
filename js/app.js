import { ToolController } from './interaction/tools.js';
import { createDocument, createLayer, clone, uid, checkSize } from './model/document.js';
import { createEffect, effectDefinitions, setEffect } from './model/effects.js';
import { History, patchCommand, insertCommand, deleteCommand, orderCommand } from './history/history.js';
import { AssetStore } from './storage/assets.js';
import { saveProject, loadProject, listProjects } from './storage/projects.js';
import { DocumentRenderer } from './rendering/renderer.js';
import { Workspace } from './interaction/workspace.js';
import { TextEditor } from './interaction/text-editor.js';
import { propertiesHTML, effectsHTML, layersHTML, historyHTML, escapeHTML, icon, hasShapeToolbar } from './components/panels.js';
import { setupPanelResizer } from './components/panel-resizer.js';
import { ContextMenu } from './components/context-menu.js';
import { setupDocumentPresets } from './components/document-presets.js';
import { PixelSelection } from './interaction/pixel-selection.js';
import { isSelectionTool } from './model/pixel-region.js';
import { localToWorld, hitTest } from './interaction/geometry.js';
import { extractSelection, matchesClipboard } from './rendering/image-pixels.js';

const $ = selector => document.querySelector(selector);
let doc = createDocument(), assets = new AssetStore(), selectedId = null, activeTab = 'properties';
let edit = null, toastTimer, rendering = false, renderNeeded = false, frame = 0, saving = false, exporting = false, documentEpoch = 0, hasSaved = false;
const renderer = new DocumentRenderer(), openedEffects = new Set(['dither']), collapsedProperties = new Set();
const selected = () => doc.layers.find(l => l.id === selectedId) || null;
let pixelClipboard = null, pixelBusy = false;
let rasterising = false, lastViewport = null;
let layerClipboard = null, layerPasting = false;
let imageOpenRequest = 0;
const contextMenu = new ContextMenu();
const history = new History(() => refresh());
const workspace = new Workspace({ element: $('#workspace'), stage: $('#stage'), overlay: $('#overlay'), getDocument: () => doc, getSelected: selected,
  select: id => selectLayer(id), preview: () => requestRender(), beforeGesture: () => finishEdit(),
  commit: (layer, before, after) => { if (JSON.stringify(before) !== JSON.stringify(after)) history.record(patchCommand(layer, { transform: before }, { transform: after }, 'Transform layer')); else refresh(); },
  onView: view => {
    workspace.textEditor?.draw();
    $('#zoom-value').textContent = `${Math.round(view.zoom * 100)}%`;
    const viewport = JSON.stringify([view, $('#workspace').clientWidth, $('#workspace').clientHeight, devicePixelRatio]);
    if (viewport !== lastViewport) { lastViewport = viewport; requestRender(); }
  }
});
const pixelSelection = new PixelSelection(workspace, {
  getDocument: () => doc, getLayer: selected,
  select: id => { selectedId = id; refresh(); }, beforeGesture: finishEdit,
  onChange: updatePixelUI, notify: toast
});
workspace.pixelSelection = pixelSelection;
const toolController = new ToolController(workspace, {
  controls: $('#tool-options'), selection: pixelSelection, renderer,
  getDocument: () => doc, getAssets: () => assets, getLayer: selected,
  select: id => { selectedId = id; refresh(); }, beforeGesture: finishEdit,
  patch: commandPatch, preview: requestRender, notify: toast, rasterise, isRasterising: () => rasterising,
  remove: layer => history.execute(deleteCommand(doc, layer)),
  insert: layer => { const index = selected() ? doc.layers.indexOf(selected()) + 1 : doc.layers.length; selectedId = layer.id; history.execute(insertCommand(doc, layer, index)); },
});
workspace.tools = toolController;
const textEditor = new TextEditor({ workspace, controls: $('#tool-options'), renderer,
  getLayer: selected, getDocument: () => doc, preview: requestRender, onDirty: updateSaveButton,
  record: (layer, before, after) => history.record(patchCommand(layer, { text: before }, { text: after }, 'Edit text')),
  onFinish: () => toolController.renderControls()
});
workspace.textEditor = textEditor;
function editText(layer = selected()) {
  if (layer?.type !== 'text' || layer.locked || !layer.visible) return;
  finishEdit(); workspace.finish(); selectedId = layer.id; setTool('move'); refresh();
  textEditor.begin(layer); toolController.renderControls();
}
function selectLayer(id) {
  finishEdit(); selectedId = id;
  if (['text', 'shape'].includes(selected()?.type)) setTool('move');
  refresh();
}
document.addEventListener('dblclick', e => {
  if (e.target.closest('#text-editor, #tool-options')) return;
  const row = e.target.closest('#layers [data-layer]');
  if (row && !e.target.closest('.layer-select')) return;
  const layer = row ? doc.layers.find(l => l.id === row.dataset.layer) : e.target.closest('#workspace') ? hitTest(doc.layers, workspace.point(e), 6 / workspace.view.zoom, true) : null;
  if (layer?.type === 'text') { e.preventDefault(); e.stopPropagation(); editText(layer); }
}, true);
function updatePixelUI() {
  const hasRegion = !!pixelSelection.current(), drawing = !!pixelSelection.draft;
  $('#pixel-actions').hidden = !hasRegion && !isSelectionTool(workspace.tool) && !pixelClipboard;
  for (const button of document.querySelectorAll('[data-pixel-action]')) {
    const action = button.dataset.pixelAction;
    button.disabled = pixelBusy || drawing || (action === 'paste' ? !pixelClipboard : action === 'all' ? !pixelSelection.eligible() : !hasRegion);
  }
  $('#selection-hint').textContent = drawing && workspace.tool === 'polygon-lasso' ? 'Click points · Enter to close' : !hasRegion && isSelectionTool(workspace.tool) ? pixelSelection.eligible() ? 'Select image pixels' : 'Select an image layer' : '';
}
function deletePixels(label = 'Delete pixels') {
  const region = pixelSelection.current(), layer = selected();
  if (!region || pixelBusy || pixelSelection.draft) return;
  finishEdit();
  commandPatch(layer, { eraseRegions: [...(layer.eraseRegions || []), clone(region.points)] }, label);
}
async function copyPixels(cut = false) {
  const region = pixelSelection.current(), source = selected();
  if (!region || pixelBusy || pixelSelection.draft) return;
  finishEdit(); workspace.finish();
  const epoch = documentEpoch, snapshot = clone(source), points = clone(region.points);
  pixelBusy = true; updatePixelUI();
  try {
    const extracted = await extractSelection(snapshot, assets.images.get(source.assetId), points);
    if (epoch !== documentEpoch) return;
    pixelClipboard = { ...extracted, layer: snapshot, documentId: doc.id };
    layerClipboard = null;
    if (cut) {
      if (!doc.layers.includes(source) || source.locked || JSON.stringify(source) !== JSON.stringify(snapshot)) throw new Error('The image changed while copying. Pixels were copied but not cut.');
      commandPatch(source, { eraseRegions: [...(source.eraseRegions || []), points] }, 'Cut pixels');
    }
    // The local clipboard remains available if the browser denies OS clipboard access.
    let systemCopy = false;
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': extracted.blob })]); systemCopy = true; } catch { /* Local paste still works. */ }
    toast(`${cut ? 'Cut' : 'Copied'} pixels.${systemCopy ? '' : ' Use Paste in the selection toolbar.'}`);
  } catch (error) { toast(error.message, true); }
  finally { pixelBusy = false; updatePixelUI(); }
}
async function pastePixels() {
  if (!pixelClipboard || pixelBusy) return;
  finishEdit(); workspace.finish();
  const clipboard = pixelClipboard, epoch = documentEpoch, destination = assets;
  pixelBusy = true; updatePixelUI();
  try {
    const meta = await destination.add(clipboard.blob); if (epoch !== documentEpoch) return;
    const { crop, sourceWidth: w, sourceHeight: h, layer: source } = clipboard, t = source.transform;
    const position = clipboard.documentId === doc.id ? localToWorld({ x: ((crop.x + crop.width / 2) / w - .5) * t.width, y: ((crop.y + crop.height / 2) / h - .5) * t.height }, t) : { x: doc.canvas.width / 2, y: doc.canvas.height / 2 };
    const layer = createLayer('image', doc.canvas, { assetId: meta.id, name: `${source.name} selection`, opacity: source.opacity,
      transform: { ...t, ...position, width: Math.max(1, t.width * crop.width / w), height: Math.max(1, t.height * crop.height / h) },
      effects: source.effects.map(effect => ({ ...clone(effect), id: uid() })) });
    doc.assets.push(meta); selectedId = layer.id; pixelSelection.clear();
    history.execute({ ...insertCommand(doc, layer), label: 'Paste pixels' }); setTool('move'); setTab('properties');
  } catch (error) { if (epoch === documentEpoch) toast(error.message, true); }
  finally { pixelBusy = false; updatePixelUI(); }
}
function toast(message, error = false) { clearTimeout(toastTimer); const el = $('#toast'); el.textContent = message; el.classList.toggle('error', error); el.hidden = false; toastTimer = setTimeout(() => { el.hidden = true; }, error ? 9000 : 4200); }
function requestRender() { renderNeeded = true; $('#workspace').setAttribute('aria-busy', 'true'); if (!frame && !rendering) frame = requestAnimationFrame(render); }
async function render() {
  frame = 0; if (rendering || !renderNeeded) return;
  rendering = true; renderNeeded = false;
  const epoch = documentEpoch, snapshot = clone(doc), originalAssets = assets;
  if (toolController.gesture?.isNew) snapshot.layers.splice(selected() ? doc.layers.indexOf(selected()) + 1 : snapshot.layers.length, 0, clone(toolController.gesture.layer));
  const timer = setTimeout(() => { $('#processing').hidden = false; }, 160);
  try {
    // Render offscreen so an asynchronous effect never partially replaces the visible scene.
    const buffer = document.createElement('canvas'); await renderer.renderDocument(snapshot, originalAssets, buffer, { ...workspace.view, width: $('#workspace').clientWidth, height: $('#workspace').clientHeight, pixelRatio: devicePixelRatio });
    if (epoch === documentEpoch && !renderNeeded) { const canvas = $('#artwork'); if (canvas.width !== buffer.width) canvas.width = buffer.width; if (canvas.height !== buffer.height) canvas.height = buffer.height; const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(buffer, 0, 0); }
  } catch (error) { if (epoch === documentEpoch) toast(error.message, true); }
  finally { clearTimeout(timer); $('#processing').hidden = true; rendering = false; if (renderNeeded) requestRender(); else $('#workspace').setAttribute('aria-busy', 'false'); }
}
function refresh() {
  contextMenu.close(false);
  textEditor.sync();
  toolController.sync();
  collectAssets();
  if (!doc.layers.some(l => l.id === selectedId)) selectedId = null;
  pixelSelection.sync(); updatePixelUI();
  const layer = selected();
  const activeField = document.activeElement?.closest('[data-path]');
  // Keep the focused control alive so typing and Tab navigation survive a commit.
  if (!edit && !activeField) { $('#properties').innerHTML = propertiesHTML(doc, layer, collapsedProperties); $('#effects').innerHTML = effectsHTML(layer, openedEffects); }
  const rasteriseButton = $('[data-action=rasterise]');
  if (rasteriseButton) { rasteriseButton.disabled = rasterising || layer.locked || !layer.visible; rasteriseButton.querySelector('span').textContent = rasterising ? 'Rasterising…' : 'Rasterise'; }
  $('#layers').innerHTML = layersHTML(doc, selectedId); $('#layer-count').textContent = doc.layers.length;
  $('#effect-count').textContent = layer?.effects.filter(e => e.enabled).length || 0;
  $('#history').innerHTML = historyHTML(history, hasSaved);
  updateSaveButton();
  document.title = `${history.dirty ? ' ' : ''}${doc.name} — Dither`;
  $('[data-action=undo]').disabled = !history.undoStack.length; $('[data-action=redo]').disabled = !history.redoStack.length;
  for (const action of ['duplicate', 'delete', 'raise', 'lower']) $(`[data-action=${action}]`).disabled = !layer || layer.locked;
  if (layer) { $('[data-action=raise]').disabled ||= doc.layers.indexOf(layer) === doc.layers.length - 1; $('[data-action=lower]').disabled ||= doc.layers.indexOf(layer) === 0; }
  updateToolAvailability(); workspace.draw(); requestRender();
}
function collectAssets() {
  assets.collect(doc, history);
}
function commandPatch(target, changes, label) { const before = {}; for (const key of Object.keys(changes)) before[key] = clone(target[key]); history.execute(patchCommand(target, before, changes, label)); }
function updateSaveButton() {
  const draftChanged = edit && Object.keys(edit.before).some(key => JSON.stringify(edit.before[key]) !== JSON.stringify(edit.target[key]));
  $('[data-action=save]').disabled = saving || (hasSaved && !history.dirty && !draftChanged && !textEditor.dirty);
}
function addLayer(kind, placement = false) {
  finishEdit(); const layer = createLayer(kind === 'text' ? 'text' : 'shape', doc.canvas);
  if (kind !== 'text') {
    layer.shape.kind = kind; layer.name = kind[0].toUpperCase() + kind.slice(1);
    if (kind === 'line' || kind === 'arrow') { layer.shape.strokeWidth = 6; layer.transform.height = 120; }
  }
  // New objects fit small documents, retaining the same editable properties.
  const scale = Math.min(1, doc.canvas.width * .65 / layer.transform.width, doc.canvas.height * .65 / layer.transform.height);
  layer.transform.width = Math.max(1, layer.transform.width * scale); layer.transform.height = Math.max(1, layer.transform.height * scale);
  if (kind === 'text') layer.text.fontSize = Math.max(8, Math.round(layer.text.fontSize * scale));
  const position = placement === true ? workspace.pointer && workspace.point(workspace.pointer) : placement;
  if (position) Object.assign(layer.transform, position);
  selectedId = layer.id;
  if (kind === 'text' || hasShapeToolbar(layer)) setTool('move');
  history.execute(insertCommand(doc, layer)); setTab('properties');
}
async function importFiles(files) {
  finishEdit(); const epoch = documentEpoch, destination = assets;
  for (const file of files) {
    try {
      const meta = await destination.add(file); if (epoch !== documentEpoch) return;
      doc.assets.push(meta); const layer = createLayer('image', doc.canvas, { assetId: meta.id, name: file.name?.replace(/\.[^.]+$/, '') || 'Pasted image' });
      const scale = Math.min(1, doc.canvas.width / meta.width, doc.canvas.height / meta.height);
      layer.transform.width = Math.max(1, meta.width * scale); layer.transform.height = Math.max(1, meta.height * scale);
      selectedId = layer.id; history.execute(insertCommand(doc, layer));
    } catch (error) { if (epoch !== documentEpoch) return; toast(error.message, true); }
  }
  setTab('properties');
}
async function openImage(file) {
  const epoch = documentEpoch, request = ++imageOpenRequest, nextAssets = new AssetStore();
  let adopted = false;
  try {
    const meta = await nextAssets.add(file);
    if (epoch !== documentEpoch || request !== imageOpenRequest) return;
    const name = file.name?.replace(/\.[^.]+$/, '') || 'Image';
    const next = createDocument({ name, width: meta.width, height: meta.height });
    next.assets.push(meta);
    const layer = createLayer('image', next.canvas, { assetId: meta.id, name });
    Object.assign(layer.transform, { width: meta.width, height: meta.height });
    next.layers.push(layer);
    if (!canDiscard()) return;
    replaceDocument(next, nextAssets); adopted = true;
    selectedId = layer.id;
    setTool('move'); setTab('properties');
    history.record(insertCommand(doc, layer));
    $('#new-dialog').close(); $('#open-dialog').close();
    workspace.fit();
    toast(`Image opened at ${meta.width} × ${meta.height} pixels.`);
  } catch (error) {
    if (epoch === documentEpoch && request === imageOpenRequest) toast(error.message, true);
  } finally { if (!adopted) nextAssets.dispose(); }
}
async function rasterise() {
  finishEdit(); workspace.finish();
  const source = selected();
  if (rasterising || !source || source.locked || !['shape', 'text'].includes(source.type)) return;
  const snapshot = clone(source), epoch = documentEpoch, destination = assets, document = doc;
  const unchanged = () => epoch === documentEpoch && doc.layers.includes(source) && JSON.stringify(source) === JSON.stringify(snapshot);
  rasterising = true; refresh();
  let meta, inserted = false;
  try {
    const { blob, transform } = await renderer.rasteriseLayer(snapshot, destination);
    if (!unchanged()) throw new Error('The layer changed while rasterising. Please try again.');
    meta = await destination.add(blob);
    if (!unchanged()) throw new Error('The layer changed while rasterising. Please try again.');
    meta.name = `${snapshot.name}.png`;
    const image = { ...snapshot, type: 'image', assetId: meta.id, transform, effects: [] };
    delete image.shape; delete image.text;
    document.assets.push(meta);
    history.execute({ label: `Rasterise ${source.name}`, assetIds: [meta.id],
      redo: () => document.layers.splice(document.layers.indexOf(source), 1, image),
      undo: () => document.layers.splice(document.layers.indexOf(image), 1, source) });
    inserted = true;
    toast('Layer rasterised. Undo restores the editable layer.');
  } catch (error) { if (epoch === documentEpoch) toast(error.message, true); }
  finally {
    if (meta && !inserted) { destination.images.get(meta.id)?.close(); destination.images.delete(meta.id); destination.blobs.delete(meta.id); }
    rasterising = false; refresh();
  }
}
function canDiscard() { toolController.cancel(); finishEdit(); workspace.finish(); return !history.dirty || window.confirm('Discard unsaved changes to this document? Save first to keep an editable copy.'); }
function replaceDocument(nextDoc, nextAssets, saved = false) {
  contextMenu.close(false);
  toolController.cancel();
  pixelSelection.clear();
  workspace.finish(true); documentEpoch++; assets.dispose(); assets = nextAssets; doc = nextDoc; hasSaved = saved;
  selectedId = null; edit = null; history.reset(); renderer.clear(); refresh(); workspace.fit();
}
function startEdit(control) {
  toolController.cancel();
  if (edit?.control === control) return;
  textEditor.checkpoint(); finishPropertyEdit();
  const target = selected() || doc;
  edit = { control, target, before: clone(target) };
}
function changeField(control) {
  const path = control.dataset.path; if (!path) return;
  startEdit(control); const target = edit.target;
  if (target.locked && path !== 'locked' && path !== 'name') return;
  let value = control.type === 'checkbox' ? control.checked : control.type === 'range' || control.type === 'number' ? Number(control.value) : control.value;
  if (control.type === 'number' || control.type === 'range') {
    if (control.value === '' || !Number.isFinite(value)) return;
    value = Math.min(Number(control.max || Infinity), Math.max(Number(control.min || -Infinity), value));
    const output = control.type === 'range' && control.closest('label').querySelector('output');
    if (output) output.value = value;
  }
  if (path.startsWith('effect:')) { const [type, key] = path.slice(7).split('.'); setEffect(target, type, { [key]: value }); }
  else if (path === 'transparent') target.canvas.background = value ? null : '#ffffff';
  else {
    const keys = path.split('.'); let object = target; for (const key of keys.slice(0, -1)) object = object[key];
    const key = keys.at(-1), previous = object[key]; object[key] = value;
    if (path === 'shape.fill' && hasShapeToolbar(target)) delete target.shape.gradient;
    if (path.startsWith('canvas.')) { try { checkSize(target.canvas.width, target.canvas.height); } catch { object[key] = previous; } }
    if (path === 'transform.width' || path === 'transform.height') { if (target.transform.width * target.transform.height > 32_000_000) { object[key] = previous; toast('Keep layer dimensions below 32 million pixels.', true); } }
  }
  requestRender(); workspace.draw(); updateSaveButton();
}
function finishEdit() {
  textEditor.finish(); finishPropertyEdit();
}
function finishPropertyEdit() {
  if (!edit) return;
  const { target, before } = edit; edit = null;
  if (target === doc) target.name = target.name.trim() || 'Untitled';
  // Store only changed top-level properties, never a full-document history snapshot.
  const a = {}, b = {};
  for (const key of Object.keys(before)) if (JSON.stringify(before[key]) !== JSON.stringify(target[key])) { a[key] = before[key]; b[key] = clone(target[key]); }
  if (Object.keys(a).length) {
    const label = 'name' in b ? target === doc ? 'Rename document' : 'Rename layer' : 'text' in b ? 'Edit text' : 'shape' in b ? 'Edit shape' : 'effects' in b ? 'Change effect' : 'transform' in b ? 'Transform layer' : 'canvas' in b ? 'Canvas settings' : 'opacity' in b ? 'Change opacity' : 'Edit properties';
    history.record(patchCommand(target, a, b, label));
  }
}
function setTab(tab) {
  finishEdit(); activeTab = tab;
  for (const name of ['properties', 'effects', 'history']) { $(`#${name}`).hidden = tab !== name; $(`[data-tab=${name}]`).setAttribute('aria-selected', tab === name); $(`[data-tab=${name}]`).tabIndex = tab === name ? 0 : -1; }
}
async function save() {
  toolController.cancel(); finishEdit(); workspace.finish(); if (saving || (hasSaved && !history.dirty)) return;
  const epoch = documentEpoch, state = history.state, snapshot = clone(doc);
  saving = true; refresh();
  try { await saveProject(snapshot, assets); if (epoch === documentEpoch) { hasSaved = true; history.markSaved(state); } toast('Project saved on this device.'); }
  catch (error) { toast(error.message, true); }
  finally { saving = false; refresh(); }
}
async function openPicker() {
  finishEdit();
  $('#new-dialog').close(); $('#open-dialog').showModal();
  $('#project-list').textContent = 'Loading saved projects…';
  try {
    const projects = await listProjects(); $('#project-list').innerHTML = projects.length ? projects.map(p => `<button class="project-card" data-project="${p.id}"><span><strong>${escapeHTML(p.name)}</strong><small>${p.canvas.width} × ${p.canvas.height} · ${p.layers.length} layers · ${new Date(p.modified).toLocaleDateString()}</small></span>${icon('arrow-up-right')}</button>`).join('') : '<p>No saved projects yet. Create a document, then choose Save.</p>';
  } catch (error) { $('#project-list').textContent = 'Saved projects could not be loaded.'; toast(error.message, true); }
}
async function exportPNG() {
  toolController.cancel(); finishEdit(); workspace.finish(); if (exporting) return;
  exporting = true; const button = $('[data-action=export]'); button.disabled = true;
  try {
    const snapshot = clone(doc), blob = await renderer.exportPNG(snapshot, assets), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `${snapshot.name.replace(/[<>:"/\\|?*]/g, '-') || 'Dither'}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); toast('PNG exported at full document resolution.');
  } catch (error) { toast(error.message, true); }
  finally { exporting = false; button.disabled = false; }
}
const actions = {
  new: () => { finishEdit(); $('#new-error').textContent = ''; $('#new-dialog').showModal(); }, open: openPicker, save, export: exportPNG,
  'new-layer': () => toolController.newPaint(),
  import: () => $('#image-input').click(), undo: () => { workspace.finish(true); history.undo(); }, redo: () => history.redo(),
  'open-image': () => $('#open-image-input').click(),
  text: (atPointer = false) => addLayer('text', atPointer), rectangle: (atPointer = false) => addLayer('rectangle', atPointer), ellipse: (atPointer = false) => addLayer('ellipse', atPointer), line: (atPointer = false) => addLayer('line', atPointer), arrow: (atPointer = false) => addLayer('arrow', atPointer),
  duplicate: () => { const source = selected(); if (!source || source.locked) return; const layer = clone(source); layer.id = uid(); layer.name += ' copy'; layer.transform.x += 20; layer.transform.y += 20; layer.effects.forEach(e => { e.id = uid(); }); selectedId = layer.id; history.execute(insertCommand(doc, layer, doc.layers.indexOf(source) + 1)); },
  delete: () => { const layer = selected(); if (layer && !layer.locked) history.execute(deleteCommand(doc, layer)); },
  raise: () => reorder(1), lower: () => reorder(-1), 'bring-to-top': () => reorder(doc.layers.length),
  'flip-x': () => flip('flipX'), 'flip-y': () => flip('flipY'), rasterise,
  'zoom-in': () => workspace.zoomAt(1.2), 'zoom-out': () => workspace.zoomAt(1 / 1.2), 'zoom-reset': () => workspace.zoomAt(1 / workspace.view.zoom), fit: () => workspace.fit(),
  canvas: () => { selectedId = null; collapsedProperties.delete('canvas'); setTab('properties'); refresh(); $('#inspector').classList.add('mobile-open'); },
  panels: () => { $('#inspector').classList.toggle('mobile-open'); }, help: () => $('#help-dialog').showModal()
};
for (const [name, action] of Object.entries(actions)) actions[name] = (...args) => { toolController.cancel(); return action(...args); };
async function copyLayer() {
  toolController.cancel(); finishEdit(); workspace.finish();
  const layer = selected(); if (!layer) return;
  layerClipboard = { layer: clone(layer), epoch: documentEpoch, token: `Dither layer ${uid()}`,
    blob: layer.type === 'image' ? assets.blobs.get(layer.assetId) : null };
  pixelClipboard = null; updatePixelUI();
  let systemCopy = false;
  try { await navigator.clipboard.writeText(layerClipboard.token); systemCopy = true; } catch { /* The context menu still supports local paste. */ }
  toast(`Layer copied. Use Paste layer${systemCopy ? ' or Ctrl/⌘ V' : ' in the context menu'}.`);
}
async function pasteLayer() {
  if (!layerClipboard || layerPasting) return;
  finishEdit(); workspace.finish();
  const clipboard = layerClipboard, epoch = documentEpoch, destination = assets;
  const layer = clone(clipboard.layer);
  layerPasting = true;
  try {
    if (layer.type === 'image' && (clipboard.epoch !== epoch || !destination.blobs.has(layer.assetId))) {
      const meta = await destination.add(clipboard.blob);
      if (epoch !== documentEpoch) return;
      doc.assets.push(meta); layer.assetId = meta.id;
    }
    layer.id = uid(); layer.name += ' copy'; layer.locked = false;
    layer.transform.x += 20; layer.transform.y += 20;
    layer.effects.forEach(effect => { effect.id = uid(); });
    const index = selected() ? doc.layers.indexOf(selected()) + 1 : doc.layers.length;
    selectedId = layer.id; pixelSelection.clear();
    history.execute({ ...insertCommand(doc, layer, index), label: 'Paste layer' });
    setTool('move'); setTab('properties');
  } catch (error) { toast(error.message, true); }
  finally { layerPasting = false; }
}
function openContextMenu(e, inPanel, keyboard = false) {
  if (isTyping(e.target)) return;
  e.preventDefault();
  finishEdit(); workspace.finish(); pixelSelection.cancelDraft();
  // Capture document coordinates before the pointer moves into the menu.
  const insertionPoint = !inPanel && !keyboard ? workspace.point(e) : false;
  const row = e.target.closest('[data-layer]');
  const layer = inPanel ? doc.layers.find(l => l.id === row?.dataset.layer) : keyboard ? selected() : hitTest(doc.layers, workspace.point(e), 6 / workspace.view.zoom, true);
  selectedId = layer?.id || null;
  document.activeElement?.blur(); refresh();
  const run = action => () => { finishEdit(); Promise.resolve(action()).catch(error => toast(error.message, true)); };
  const item = (label, action, disabled = false, danger = false) => ({ label, run: run(action), disabled, danger });
  const items = [];
  if (layer) {
    const locked = layer.locked, index = doc.layers.indexOf(layer);
    items.push(item('Copy layer', copyLayer), item('Duplicate layer', actions.duplicate, locked));
    items.push(item('Paste layer', pasteLayer, !layerClipboard || layerPasting), null);
    if (['shape', 'text'].includes(layer.type)) items.push(item('Rasterise', rasterise, locked || rasterising));
    items.push(item('Bring to top', actions['bring-to-top'], locked || index === doc.layers.length - 1),
      item('Bring forward', actions.raise, locked || index === doc.layers.length - 1), item('Send backward', actions.lower, locked || index === 0), null);
    items.push(item(layer.visible ? 'Hide layer' : 'Show layer', () => commandPatch(layer, { visible: !layer.visible }, 'Layer visibility')),
      item(locked ? 'Unlock layer' : 'Lock layer', () => commandPatch(layer, { locked: !layer.locked }, 'Lock layer')), null,
      item('Delete layer', actions.delete, locked, true));
  } else {
    items.push(item('Paste layer', pasteLayer, !layerClipboard || layerPasting), null,
      item('Add text', () => addLayer('text', insertionPoint)), item('Add rectangle', () => addLayer('rectangle', insertionPoint)), item('Import image…', actions.import));
    if (!inPanel) items.push(null, item('Fit canvas', actions.fit), item('Canvas settings', actions.canvas));
  }
  const returnFocus = () => inPanel && layer ? $(`[data-layer="${layer.id}"] .layer-select`) || $('#workspace') : $('#workspace');
  const bounds = (returnFocus() || e.currentTarget).getBoundingClientRect();
  contextMenu.open(keyboard ? bounds.left + 20 : e.clientX, keyboard ? bounds.top + 20 : e.clientY, items, returnFocus);
}
for (const [element, inPanel] of [[$('#workspace'), false], [$('#layers'), true]]) {
  element.addEventListener('contextmenu', e => openContextMenu(e, inPanel));
  element.addEventListener('keydown', e => {
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) openContextMenu(e, inPanel, true);
  });
}
function flip(axis) { const layer = selected(); if (layer && !layer.locked) commandPatch(layer, { transform: { ...layer.transform, [axis]: !layer.transform[axis] } }, 'Flip layer'); }
function reorder(direction) { const layer = selected(); if (!layer || layer.locked) return; const index = Math.max(0, Math.min(doc.layers.length - 1, doc.layers.indexOf(layer) + direction)); history.execute(orderCommand(doc, layer, index)); }
document.addEventListener('click', e => {
  const pixelAction = e.target.closest('[data-pixel-action]')?.dataset.pixelAction;
  if (pixelAction) { toolController.cancel(); ({ copy: () => copyPixels(), cut: () => copyPixels(true), paste: pastePixels, delete: deletePixels, deselect: () => pixelSelection.clear(), all: () => pixelSelection.selectAll() })[pixelAction]?.(); }
  const action = e.target.closest('[data-action]'); if (action) { toolController.cancel(); if (action.closest('#document-menu')) $('#document-menu').hidePopover(); finishEdit(); Promise.resolve(actions[action.dataset.action]?.()).catch(error => toast(error.message, true)); }
  const tool = e.target.closest('[data-tool]'); if (tool) setTool(tool.dataset.tool);
  const tab = e.target.closest('[data-tab]'); if (tab) setTab(tab.dataset.tab);
  const close = e.target.closest('[data-close]'); if (close) close.closest('dialog').close();
  const reset = e.target.closest('[data-reset-effect]'); if (reset) {
    finishEdit(); const layer = selected(); if (!layer || layer.locked) return;
    const effects = clone(layer.effects), type = reset.dataset.resetEffect, effect = effects.find(e => e.type === type);
    if (effect) Object.assign(effect, effectDefinitions[type].defaults); else effects.push(createEffect(type));
    effects.sort((a,b) => Object.keys(effectDefinitions).indexOf(a.type) - Object.keys(effectDefinitions).indexOf(b.type));
    commandPatch(layer, { effects }, 'Reset effect');
  }
});
function updateToolAvailability() {
  for (const tool of ['brush', 'eraser', 'fill']) $(`[data-tool="${tool}"]`).disabled = !toolController.canUse(tool);
  if (!toolController.canUse(workspace.tool)) setTool('move');
}
function setTool(tool) {
  textEditor.finish();
  if (!toolController.canUse(tool)) return;
  workspace.setTool(tool); toolController.renderControls(); updatePixelUI();
  for (const el of document.querySelectorAll('[data-tool]')) el.setAttribute('aria-pressed', el.dataset.tool === tool);
  const toggle = $('#selection-tool-toggle'), option = $(`#selection-tool-menu [data-tool="${tool}"]`);
  toggle.setAttribute('aria-pressed', String(isSelectionTool(tool)));
  if (option) {
    toggle.dataset.selectedTool = tool;
    toggle.querySelector('use').setAttribute('href', `./icons/ui.svg#${option.dataset.icon}`);
    toggle.title = `${option.dataset.label} (${option.dataset.shortcut}) - Selection tools`;
    toggle.setAttribute('aria-label', `Selection tools: ${option.dataset.label}`);
  }
  const menu = $('#selection-tool-menu');
  if (menu.matches(':popover-open')) { menu.hidePopover(); toggle.focus({preventScroll:true}); }
}
function positionSelectionMenu() {
  const menu = $('#selection-tool-menu'), rect = $('#selection-tool-toggle').getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.right + 8, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(rect.top, innerHeight - menu.offsetHeight - 8))}px`;
}
$('#selection-tool-menu').addEventListener('toggle', e => {
  $('#selection-tool-toggle').setAttribute('aria-expanded', String(e.newState === 'open'));
  if (e.newState === 'open') { positionSelectionMenu(); const tool = $('#selection-tool-toggle').dataset.selectedTool || 'marquee-rect'; $(`#selection-tool-menu [data-tool="${tool}"]`).focus({preventScroll:true}); }
});
$('#selection-tool-menu').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); $('#selection-tool-menu').hidePopover(); $('#selection-tool-toggle').focus(); return; }
  if (!['ArrowDown','ArrowUp','Home','End'].includes(e.key)) return;
  e.preventDefault(); e.stopPropagation();
  const buttons = [...$('#selection-tool-menu').querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
  buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length-1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
});
window.addEventListener('resize', () => { if ($('#selection-tool-menu').matches(':popover-open')) positionSelectionMenu(); });
$('.tools').addEventListener('scroll', () => { if ($('#selection-tool-menu').matches(':popover-open')) positionSelectionMenu(); });

$('.inspector-tabs').addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const tabs = ['properties', 'effects', 'history'], tab = tabs[(tabs.indexOf(activeTab) + (e.key === 'ArrowRight' ? 1 : 2)) % tabs.length]; setTab(tab); $(`[data-tab=${tab}]`).focus(); } });
$('#history').addEventListener('click', e => {
  const button = e.target.closest('[data-history-state]'); if (!button) return;
  toolController.cancel(); finishEdit(); workspace.finish(true); const state = Number(button.dataset.historyState);
  history.goTo(state); $('#history').querySelector(`[data-history-state="${state}"]`)?.focus({ preventScroll: true });
});
$('#history').addEventListener('keydown', e => {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault(); const buttons = [...$('#history').querySelectorAll('[data-history-state]')], index = buttons.indexOf(e.target);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : index + (e.key === 'ArrowDown' ? 1 : -1);
  buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.click();
});
for (const id of ['properties', 'effects', 'tool-options']) {
  const container = $(`#${id}`);
  container.addEventListener('input', e => { if (e.target.dataset.path) changeField(e.target); });
  container.addEventListener('change', e => {
    if (!e.target.dataset.path) return;
    if (!edit) changeField(e.target);
    finishPropertyEdit();
    if (e.target.type === 'checkbox') {
      const path = e.target.dataset.path; e.target.blur(); refresh();
      container.querySelector(`[data-path="${path}"]`)?.focus({ preventScroll: true });
    } else refresh();
  });
  container.addEventListener('focusout', () => finishPropertyEdit());
}
$('#tool-options').addEventListener('click', e => {
  const action = e.target.closest('[data-text-action]')?.dataset.textAction;
  if (action === 'edit') editText();
  if (action === 'done') finishEdit();
});
$('#effects').addEventListener('toggle', e => { const type = e.target.dataset.effect; if (type) e.target.open ? openedEffects.add(type) : openedEffects.delete(type); }, true);
$('#properties').addEventListener('toggle', e => {
  const section = e.target.dataset.section;
  if (section && e.target.isConnected) e.target.open ? collapsedProperties.delete(section) : collapsedProperties.add(section);
}, true);
$('#layers').addEventListener('click', e => {
  toolController.cancel();
  const button = e.target.closest('[data-layer-action]'), row = button?.closest('[data-layer]'); if (!row) return;
  finishEdit(); const layer = doc.layers.find(l => l.id === row.dataset.layer);
  if (button.dataset.layerAction === 'select' && (selectedId !== layer.id || ['text', 'shape'].includes(layer.type) && workspace.tool !== 'move')) selectLayer(layer.id);
  if (button.dataset.layerAction === 'lock') commandPatch(layer, { locked: !layer.locked }, 'Lock layer');
  if (button.dataset.layerAction === 'visibility') commandPatch(layer, { visible: !layer.visible }, 'Layer visibility');
});
let draggedLayer;
$('#layers').addEventListener('dragstart', e => { const row = e.target.closest('[data-layer]'); if (!row) return; draggedLayer = row.dataset.layer; if (doc.layers.find(l => l.id === draggedLayer)?.locked) { e.preventDefault(); return; } e.dataTransfer.setData('text/plain', draggedLayer); e.dataTransfer.effectAllowed = 'move'; });
$('#layers').addEventListener('dragover', e => { if (draggedLayer) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
$('#layers').addEventListener('drop', e => { e.preventDefault(); const row = e.target.closest('[data-layer]'), layer = doc.layers.find(l => l.id === draggedLayer); if (row && layer && !layer.locked) { finishEdit(); history.execute(orderCommand(doc, layer, doc.layers.findIndex(l => l.id === row.dataset.layer))); } draggedLayer = null; });
$('#layers').addEventListener('dragend', () => { draggedLayer = null; });
$('#image-input').addEventListener('change', e => { importFiles([...e.target.files]); e.target.value = ''; });
$('#open-image-input').addEventListener('change', e => { const file = e.target.files[0]; e.target.value = ''; if (file) openImage(file); });
const area = $('#workspace');
area.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); area.classList.add('drop-active'); } });
area.addEventListener('dragleave', e => { if (!area.contains(e.relatedTarget)) area.classList.remove('drop-active'); });
area.addEventListener('drop', e => { e.preventDefault(); area.classList.remove('drop-active'); if (e.dataTransfer.files.length) importFiles([...e.dataTransfer.files]); });
document.addEventListener('paste', async e => {
  if (isTyping(e.target) || document.querySelector('dialog[open]')) return;
  const files = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
  if (files.length) {
    e.preventDefault(); const epoch = documentEpoch, clipboard = pixelClipboard;
    const internal = files.length === 1 && clipboard && await matchesClipboard(files[0], clipboard);
    if (epoch !== documentEpoch) return;
    if (internal && pixelClipboard === clipboard) await pastePixels(); else await importFiles(files);
  } else if (pixelClipboard && !e.clipboardData?.getData('text/plain')) { e.preventDefault(); await pastePixels(); }
  else if (layerClipboard && (!e.clipboardData?.getData('text/plain') || e.clipboardData.getData('text/plain') === layerClipboard.token)) { e.preventDefault(); await pasteLayer(); }
});
const form = $('#new-form');
setupDocumentPresets(form);
form.elements.background.addEventListener('change', e => { form.elements.colour.disabled = e.target.value === 'transparent'; });
form.addEventListener('submit', e => {
  e.preventDefault();
  try { const next = createDocument({ name: form.elements.name.value.trim() || 'Untitled', width: Number(form.elements.width.value), height: Number(form.elements.height.value), background: form.elements.background.value === 'transparent' ? null : form.elements.colour.value }); if (!canDiscard()) return; replaceDocument(next, new AssetStore()); $('#new-dialog').close(); }
  catch (error) { $('#new-error').textContent = error.message; }
});
$('#project-list').addEventListener('click', async e => {
  const button = e.target.closest('[data-project]'); if (!button || !canDiscard()) return;
  button.disabled = true;
  try { const project = await loadProject(button.dataset.project); replaceDocument(project.doc, project.assets, true); $('#open-dialog').close(); toast('Project opened. Every layer is still editable.'); }
  catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});
function isTyping(target) { return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable=true]'); }
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || document.querySelector('dialog[open]')) return;
  if (e.key === 'Escape' && $('#selection-tool-menu').matches(':popover-open')) { e.preventDefault(); $('#selection-tool-menu').hidePopover(); $('#selection-tool-toggle').focus(); return; }
  const modifier = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
  if (modifier && key === 's') { e.preventDefault(); save(); return; }
  if (isTyping(e.target)) return;
  if (toolController.key(e)) return;
  if (pixelSelection.key(e)) return;
  if (!modifier && !e.altKey && ({i:'eyedropper',b:'brush',f:'fill',p:'pen',g:'gradient'}[key] || key === 'e' && e.shiftKey)) {
    e.preventDefault(); setTool(key === 'e' ? 'eraser' : {i:'eyedropper',b:'brush',f:'fill',p:'pen',g:'gradient'}[key]); return;
  }
  if (modifier && ['z','y'].includes(key)) toolController.cancel();
  if (key === 'escape') { workspace.finish(true); selectedId = null; refresh(); return; }
  if (e.code === 'Space') { e.preventDefault(); workspace.space = true; }
  if (modifier) {
    if (key === 'a' && pixelSelection.eligible()) { e.preventDefault(); pixelSelection.selectAll(); return; }
    if (key === 'd' && pixelSelection.current()) { e.preventDefault(); pixelSelection.clear(); return; }
    if ((key === 'c' || key === 'x') && pixelSelection.current()) { e.preventDefault(); if (!e.repeat) copyPixels(key === 'x'); return; }
    if (key === 'c' && selected()) { e.preventDefault(); if (!e.repeat) copyLayer(); return; }
    const action = key === 'z' ? e.shiftKey ? 'redo' : 'undo' : key === 'y' ? 'redo' : key === 'd' ? 'duplicate' : key === 'o' ? 'open' : key === '+' || key === '=' ? 'zoom-in' : key === '-' ? 'zoom-out' : key === '0' ? 'fit' : null;
    if (action) { e.preventDefault(); finishEdit(); actions[action](); } return;
  }
  if (key.startsWith('arrow')) {
    toolController.cancel();
    const layer = selected(); if (!layer || layer.locked) return; e.preventDefault(); const delta = e.shiftKey ? 10 : 1, t = clone(layer.transform);
    if (key === 'arrowleft') t.x -= delta; if (key === 'arrowright') t.x += delta; if (key === 'arrowup') t.y -= delta; if (key === 'arrowdown') t.y += delta;
    commandPatch(layer, { transform: t }, 'Nudge layer'); return;
  }
  if (key === 'delete' || key === 'backspace') { e.preventDefault(); if (pixelSelection.current()) deletePixels(); else actions.delete(); }
  if (key === 'm' || key === 'q') { e.preventDefault(); setTool(key === 'm' ? e.shiftKey ? 'marquee-ellipse' : 'marquee-rect' : e.shiftKey ? 'polygon-lasso' : 'lasso'); }
  if (key === 'v' || key === 'h') setTool(key === 'v' ? 'move' : 'hand');
  if (!e.repeat && !e.altKey && { t: 'text', r: 'rectangle', e: 'ellipse', l: 'line', a: 'arrow' }[key]) actions[{ t: 'text', r: 'rectangle', e: 'ellipse', l: 'line', a: 'arrow' }[key]](true);
});
document.addEventListener('keyup', e => { if (e.code === 'Space') workspace.space = false; });
window.addEventListener('blur', () => { toolController.cancel(); pixelSelection.cancelDraft(); workspace.space = false; workspace.finish(true); finishEdit(); });
window.addEventListener('beforeunload', e => { finishEdit(); if (history.dirty) { e.preventDefault(); e.returnValue = ''; } });
let installPrompt;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; $('#install-button').hidden = false; });
$('#install-button').addEventListener('click', async () => { if (!installPrompt) return; await installPrompt.prompt(); installPrompt = null; $('#install-button').hidden = true; });
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js', { type: 'module' }).then(registration => {
    const offerUpdate = () => { if (registration.waiting && navigator.serviceWorker.controller) { $('#update-button').hidden = false; $('.document-menu-toggle').classList.add('has-update'); $('.document-menu-toggle').title = 'Document actions · update available'; } };
    offerUpdate(); registration.addEventListener('updatefound', () => { registration.installing?.addEventListener('statechange', offerUpdate); });
    $('#update-button').addEventListener('click', async () => { if (history.dirty) { toast('Save your changes before applying the update.'); return; } registration.waiting?.postMessage({ type: 'ACTIVATE_UPDATE' }); });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!$('#update-button').hidden) location.reload(); });
  }).catch(() => toast('Offline installation is unavailable. Editing and local saves still work.', true));
}
setupPanelResizer($('#inspector'), $('#layers-resizer'), $('#layers-panel'));
refresh(); workspace.fit(); $('#new-dialog').showModal();

// Browser zoom and moving between displays can change the backing pixel density.
window.addEventListener('resize', () => workspace.draw());
