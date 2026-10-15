import { effectDefinitions, effectTypes } from '../model/effects.js';
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const icon = name => `<svg class="icon" aria-hidden="true" focusable="false"><use href="./icons/ui.svg#${name}"></use></svg>`;
export const layerIcon = layer => layer.type === 'image' ? 'image' : layer.type === 'text' ? 'text-t' : ({ rectangle: 'square', ellipse: 'circle', line: 'line', arrow: 'arrow-up-right', path: 'pen' }[layer.shape.kind]);
export const hasShapeToolbar = layer => layer?.type === 'shape' && ['rectangle', 'ellipse', 'arrow', 'line'].includes(layer.shape.kind);
const field = (label, path, value, type = 'number', extra = '') => `<label>${label}<input data-path="${path}" type="${type}" value="${escapeHTML(value)}" ${extra}></label>`;
const select = (label, path, value, choices) => `<label>${label}<select data-path="${path}">${choices.map(([id, name]) => `<option value="${id}" ${String(value) === id ? 'selected' : ''}>${name}</option>`).join('')}</select></label>`;
const check = (label, path, value) => `<label class="inline-check"><input type="checkbox" data-path="${path}" ${value ? 'checked' : ''}>${label}</label>`;
const section = html => `<div class="property-section">${html}</div>`;
const num = (label, path, value, min, max, step = 1) => field(label, path, Number(value.toFixed(2)), 'number', `min="${min}" max="${max}" step="${step}"`);
const toolbarSlider = (label, path, value, min, max, step = 1) => `<label><span>${label}</span><input aria-label="${label}" data-path="${path}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;

export function propertiesHTML(doc, layer, collapsed = new Set()) {
  const group = (key, title, html) => `<details class="property-section" data-section="${key}" ${collapsed.has(key) ? '' : 'open'}><summary class="section-heading"><span>${title}</span>${icon('chevron-down')}</summary><div class="property-body">${html}</div></details>`;
  if (!layer) return group("canvas", "Canvas", `<label class="field-full">Project name<input id="project-name" data-path="name" type="text" value="${escapeHTML(doc.name)}" maxlength="100"></label><div class="field-grid">${num('Width', 'canvas.width', doc.canvas.width, 1, 8192)}${num('Height', 'canvas.height', doc.canvas.height, 1, 8192)}</div><div class="field-full">${check('Transparent background', 'transparent', doc.canvas.background === null)}</div>${field('Background colour', 'canvas.background', doc.canvas.background || '#ffffff', 'color')}`);
  const t = layer.transform;
  let html = section(`${field('Layer name', 'name', layer.name, 'text', 'maxlength="100"')}<div class="layer-property-actions">${check('Lock layer', 'locked', layer.locked)}</div>`);
  html += `<fieldset ${layer.locked ? 'disabled' : ''} style="border:0;padding:0;margin:0;min-width:0">`;
  if (['shape', 'text'].includes(layer.type)) {
    const action = (attribute, label, glyph) => `<button type="button" ${attribute}>${icon(glyph)}<span>${label}</span></button>`;
    let actions = '';
    if (layer.shape?.kind === 'path') actions += action('data-tool="pen"', 'Edit path anchors', 'pen') + action('data-tool-action="smooth"', 'Smooth anchor', 'bezier-curve') + action('data-tool-action="corner"', 'Corner anchor', 'square');
    if (layer.shape?.kind === 'path' && layer.shape.closed) {
      actions += action('data-tool="gradient"', 'Edit gradient fill', 'color-background');
      if (layer.shape.gradient) actions += action('data-tool-action="solid"', 'Use solid fill', 'paint-bucket');
    }
    actions += action('class="rasterise-button" data-action="rasterise" title="Convert to an image, including current effects. Undo restores the editable layer."', 'Rasterise', 'image');
    html += section(`<div class="property-action-buttons" role="group" aria-label="Layer actions">${actions}</div>`);
  }
  if (layer.type === 'shape' && !hasShapeToolbar(layer)) {
    const s = layer.shape, isLine = ['line', 'arrow'].includes(s.kind);
    html += group("shape", s.kind, `<div class="field-grid">${isLine ? '' : field('Fill', 'shape.fill', s.fill, 'color') + num('Fill opacity', 'shape.fillOpacity', s.fillOpacity, 0, 1, 0.01)}${field('Stroke', 'shape.stroke', s.stroke, 'color')}${num('Stroke width', 'shape.strokeWidth', s.strokeWidth, 0, 100)}${num('Stroke opacity', 'shape.strokeOpacity', s.strokeOpacity, 0, 1, 0.01)}${s.kind === 'rectangle' ? num('Corner radius', 'shape.radius', s.radius, 0, 1000) : ''}${s.kind === 'arrow' ? num('Arrowhead size', 'shape.arrowSize', s.arrowSize, 1, 200) + check('Start arrowhead', 'shape.startArrow', s.startArrow) + check('End arrowhead', 'shape.endArrow', s.endArrow) : ''}</div>`);
  }
  html += group("transform", "Transform", `<div class="field-grid">${num('X · centre', 'transform.x', t.x, -100000, 100000, 0.1)}${num('Y · centre', 'transform.y', t.y, -100000, 100000, 0.1)}${num('Width', 'transform.width', t.width, 1, 8192, 0.1)}${num('Height', 'transform.height', t.height, 1, 8192, 0.1)}${num('Rotation °', 'transform.rotation', t.rotation, -36000, 36000, 0.1)}${num('Opacity', 'opacity', layer.opacity, 0, 1, 0.01)}</div><div class="button-row"><button data-action="flip-x" aria-pressed="${t.flipX}">${icon('flip-horizontal')} Flip H</button><button data-action="flip-y" aria-pressed="${t.flipY}">${icon('flip-vertical')} Flip V</button></div>`);
  return html + '</fieldset>';
}
export function effectsHTML(layer, opened = new Set()) {
  if (!layer) return '<p class="inspector-empty">Select a layer to edit effects.</p>';
  return `<fieldset ${layer.locked ? 'disabled' : ''} style="border:0;padding:0;margin:0;min-width:0">` + effectTypes.map((type, index) => {
    const definition = effectDefinitions[type], effect = layer.effects.find(e => e.type === type), settings = effect || definition.defaults;
    const fields = definition.fields.map(([key, label, min, max, step]) => min === 'color' ? field(label, `effect:${type}.${key}`, settings[key], 'color') : `<label class="range-field wide"><span>${label}<output>${settings[key]}</output></span><input type="range" data-path="effect:${type}.${key}" min="${min}" max="${max}" step="${step}" value="${settings[key]}" aria-label="${definition.label} ${label}"></label>`).join('');
    return `${index === 0 ? '<h3 class="effects-heading">ADJUSTMENTS</h3>' : index === 2 ? '<h3 class="effects-heading">EFFECTS</h3>' : ''}<details class="effect-card" data-effect="${type}" ${opened.has(type) ? 'open' : ''}><summary><input type="checkbox" data-path="effect:${type}.enabled" aria-label="Enable ${definition.label}" ${effect?.enabled ? 'checked' : ''}>${icon(type === 'dither' ? 'grid' : type === 'brightness' ? 'weather-sunny' : type === 'contrast' ? 'dark-theme' : 'options')} ${definition.label}</summary><div class="effect-body"><fieldset ${effect?.enabled ? '' : 'disabled'} style="border:0;margin:0;padding:0"><div class="field-grid">${fields}</div></fieldset>${type === 'dither' ? '<p class="property-note">Floyd–Steinberg · monochrome<br>A little noise. A lot of character.</p>' : type === 'stroke' ? '<p class="property-note">Outside contour · square joins</p>' : ''}<button data-reset-effect="${type}">${icon('arrow-reset')} Reset settings</button></div></details>`;
  }).join('') + '</fieldset>';
}
export function layersHTML(doc, selected) {
  if (!doc.layers.length) return '';
  return [...doc.layers].reverse().map(layer => `<div class="layer-row ${layer.id === selected ? 'selected' : ''} ${layer.visible ? '' : 'hidden-layer'}" data-layer="${layer.id}" draggable="true"><button class="layer-select" data-layer-action="select" aria-pressed="${layer.id === selected}" title="Select ${escapeHTML(layer.name)}"><span class="layer-thumb">${icon(layerIcon(layer))}</span><span class="layer-name">${escapeHTML(layer.name)}</span></button><button data-layer-action="lock" aria-label="${layer.locked ? 'Unlock' : 'Lock'} ${escapeHTML(layer.name)}" title="${layer.locked ? 'Unlock' : 'Lock'} layer">${icon(layer.locked ? 'lock-closed' : 'lock-open')}</button><button data-layer-action="visibility" aria-label="${layer.visible ? 'Hide' : 'Show'} ${escapeHTML(layer.name)}" title="${layer.visible ? 'Hide' : 'Show'} layer">${icon(layer.visible ? 'eye' : 'eye-off')}</button></div>`).join('');
}

export function historyHTML(history, hasSaved) {
  const entries = history.entries, current = entries.findIndex(entry => entry.state === history.state);
  return '<div class="history-actions"><button data-action="undo" aria-label="Undo" title="Undo (Ctrl/⌘ Z)">' + icon('arrow-undo') + ' Undo</button><button data-action="redo" aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)">' + icon('arrow-redo') + ' Redo</button></div><ol class="history-list" aria-label="Document history">' + entries.map((entry, index) => `<li><button data-history-state="${entry.state}" class="history-entry ${index > current ? 'undone' : ''}" ${entry.state === history.state ? 'aria-current="step"' : ''}><span class="history-marker">${icon(entry.state === history.state ? 'checkmark-circle' : 'history')}</span><span class="history-label">${escapeHTML(entry.label)}</span>${hasSaved && entry.state === history.saved ? '<small>Saved</small>' : ''}</button></li>`).join('') + '</ol>';
}

export function typographyHTML(layer, editing = false) {
  const p = layer.text;
  return `${icon('text-t')}<fieldset class="typography-options" ${layer.locked || !layer.visible ? 'disabled' : ''}>
    ${select('Font', 'text.fontFamily', p.fontFamily === 'Noto' ? 'Noto Sans' : p.fontFamily, [['Arial','Arial'],['Courier New','Courier New'],['Georgia','Georgia'],['Inter','Inter'],['Noto Emoji','Noto Emoji'],['Noto Sans','Noto Sans'],['Times New Roman','Times New Roman'],['Trebuchet MS','Trebuchet MS'],['Verdana','Verdana']])}
    ${num('Size', 'text.fontSize', p.fontSize, 1, 600)}
    ${select('Weight', 'text.fontWeight', p.fontWeight, [['400','Regular'],['500','Medium'],['700','Bold'],['900','Heavy']])}
    ${select('Style', 'text.fontStyle', p.fontStyle, [['normal','Normal'],['italic','Italic']])}
    ${select('Alignment', 'text.align', p.align, [['left','Left'],['center','Centre'],['right','Right']])}
    ${num('Line height', 'text.lineHeight', p.lineHeight, .5, 4, .05)}
    ${num('Letter spacing', 'text.letterSpacing', p.letterSpacing, -10, 50, .1)}
    ${field('Colour', 'text.colour', p.colour, 'color')}
    <button type="button" data-text-action="${editing ? 'done' : 'edit'}">${editing ? 'Done' : 'Edit text'}</button>
    </fieldset>`;
}

export function shapeOptionsHTML(layer) {
  const s = layer.shape, filled = ['rectangle', 'ellipse'].includes(s.kind);
  return `${icon(layerIcon(layer))}<fieldset class="shape-options" ${layer.locked || !layer.visible ? 'disabled' : ''}>
    ${filled ? field('Fill', 'shape.fill', s.fill, 'color') + toolbarSlider('Fill opacity', 'shape.fillOpacity', s.fillOpacity, 0, 1, .05) : ''}
    ${field('Stroke', 'shape.stroke', s.stroke, 'color')}
    ${toolbarSlider('Stroke width', 'shape.strokeWidth', s.strokeWidth, 1, 100)}
    ${toolbarSlider('Stroke opacity', 'shape.strokeOpacity', s.strokeOpacity, 0, 1, .05)}
    ${s.kind === 'rectangle' ? toolbarSlider('Corner radius', 'shape.radius', s.radius, 0, 100, 10) : ''}
    ${s.kind === 'arrow' ? toolbarSlider('Arrowhead size', 'shape.arrowSize', s.arrowSize, 10, 500) + check('Start arrowhead', 'shape.startArrow', s.startArrow) + check('End arrowhead', 'shape.endArrow', s.endArrow) : ''}
    ${filled ? '<button type="button" data-tool="gradient">Edit gradient fill</button>' : ''}
    ${filled && s.gradient ? '<button type="button" data-tool-action="solid">Use solid fill</button>' : ''}
    </fieldset>`;
}
