# Dither

A local-first image compositor built with native browser APIs. Images, text, shapes, transforms and effects stay editable until export. No CDN, framework, account, backend or production dependency is required.

## Run

Serve this directory with any static HTTP server. With Node.js installed:

```sh
npm start
```

Open http://127.0.0.1:4173.

Alternatively, with Python 3 installed, run this from the repository directory:

```sh
python3 -m http.server 8000;
```

Then open http://localhost:8000.

No install or build step is needed. ES modules, IndexedDB and the service worker require an HTTP origin; opening `index.html` as a `file:` URL is not supported. Installation/offline support requires HTTPS or localhost.

To deploy on GitHub Pages, publish the directory as static files. All app, icon, manifest, worker and module URLs are relative and support a repository subdirectory. No deployment has been performed by this implementation.

## Working capabilities

- Custom documents, common presets, transparent/solid backgrounds, document resizing, zoom, pan and fit.
- PNG/JPEG/WebP import, multi-file import, image drop and clipboard paste.
- Rectangular/elliptical marquees and freehand/polygonal lassos on image layers, with undoable pixel deletion, copy, cut and paste as a new image layer.
- Eyedropper, round brush, eraser, connected flood fill, editable Bézier paths and editable linear/radial gradient fills.
- Ordered image, text, rectangle, ellipse, line, arrow and path layers. Select on canvas or in the layer list; rename, duplicate, delete, reorder, hide, lock and set opacity.
- Move, eight resize handles, rotation and flips. Shift preserves proportions/snaps rotation; Alt/Option resizes from the centre. Numeric transform controls provide keyboard-accessible alternatives.
- Select a text layer to use its typography toolbar: font, weight/style, size, colour, alignment, line height and letter spacing. Double-click text on the canvas or its layer row, or choose **Edit text**, to type directly in its box. Enter inserts a new line; **Done**, Ctrl/⌘ Enter or clicking outside finishes the edit; Escape cancels the current draft. Typing uses native caret selection, clipboard, undo and IME input; completed edits support document undo/redo. Text wraps and clips inside its resizable box. Bundled Inter, Noto Sans and Noto Emoji options work offline; the app UI uses Inter. Older projects using the Noto option now render with Noto Sans.
- Select an ellipse, rectangle, arrow or line to use its appearance toolbar: fill/stroke colours and opacities, stroke width, rectangle corner radius and configurable arrowheads where applicable. Relevant layer actions, including Rasterise and path/gradient editing, also appear in the selected layer’s toolbar. Transform controls and effects stay in the inspector.
- Rasterise text, rectangles, ellipses, lines and arrows from the selected layer’s toolbar into image layers, baking current effects while preserving appearance and stacking order. Undo restores the editable layer during the session.
- Brightness, contrast, monochrome Floyd–Steinberg dithering, colour overlay, outside stroke, blur and drop shadow. Each effect can be enabled, configured and reset independently.
- Command-based undo/redo, including one entry per pointer gesture, slider gesture or committed text edit.
- Explicit browser-local project saves and reopening with original image Blobs stored separately; full-resolution transparent PNG export.
- Installable PWA, offline app shell and local fonts, update notification, dark desktop layout, collapsible inspector on small screens, named controls and visible keyboard focus.

Use the **?** button for keyboard shortcuts. Changes to text fields commit when focus leaves the field. The layer panel displays the topmost layer first. Shape stroke is independent of the optional layer stroke effect.

The document menu at the top of the left toolbar contains New, Open, Save and Export, plus installation/update controls when available. Canvas properties include the project name; use the Canvas properties toolbar button to deselect the current layer and open them. The History inspector tab contains undo/redo and clickable editing states. You can return to later states until a new edit replaces the redo branch. History is session-only and resets when a document is opened.

Creation shortcuts (T, R, E, L, A) place objects centred at the cursor in the workspace, accounting for zoom and pan. Toolbar creation, or shortcuts with the cursor outside the workspace, use the canvas centre. Toasts appear at the workspace's bottom right.

Lines and arrows use two endpoint handles instead of a transform box. Drag either handle to change length and direction while keeping the other end fixed; hold Shift to snap direction to 15° increments. Drag the stroke to move the whole object. Each completed gesture is one history entry, and Escape cancels it. Arrow shafts join the bases of the arrowheads without extending past their tips.

Select an unlocked, visible image layer, then use **M** for rectangular marquee, **Shift M** for elliptical marquee, **Q** for freehand lasso or **Shift Q** for polygonal lasso. Drag marquees/freehand paths; click polygon vertices and close with Enter, double-click or a click on the starting point. Backspace removes a polygon vertex; Escape cancels an unfinished selection or clears a completed one. Hold Space to pan.

The selection tools are grouped in a toolbar menu; its icon follows the chosen marquee or lasso, including keyboard shortcut changes. The selection toolbar provides Select All, Copy, Cut, Paste, Delete and Deselect. Ctrl/⌘ A selects the whole image; C/X/V copy/cut/paste; D clears an active pixel selection (otherwise it duplicates the layer). Delete/Backspace erases selected pixels; the Layers trash button still deletes the whole layer. Text fields retain their normal editing shortcuts. Selections follow the source layer's transforms and clear when another layer is selected, locked or hidden.

Copies use original image resolution with existing erased areas and transparent edges preserved. Pasting creates an independent image layer at the copied region's position, with the source transform, opacity and editable effects; pasting into a different document centres it. The operating-system clipboard receives the source pixels before effects, so pasting into another application does not include Dither effects. A session-local clipboard and Paste button remain available if browser clipboard permission is denied. Active selection outlines and clipboard contents are not saved; erased areas are saved.

Drawing tools use **I** (Eyedropper), **B** (Brush), **Shift E** (Eraser), **F** (Fill), **P** (Pen) and **G** (Gradient); **E** still creates an ellipse. The contextual options bar contains the active tool’s controls; Brush uses the shared foreground colour; Fill shows the foreground colour and tolerance; Eyedropper shows the sampled colour and read-only HEX/RGB values, each with a copy button for HTML/CSS colour values. Eyedropper samples the visible composite, including effects and background; transparent samples leave the current colour unchanged.

Brush, eraser and fill are disabled unless a paintable image is selected. They edit the selected visible, unlocked image before layer effects. Brush and eraser expand stretched bitmap axes to at least one source pixel per document pixel when starting a stroke, preserving higher-resolution source detail on other axes. The expanded bitmap is saved only when the stroke changes pixels and is undoable; fill retains the current source resolution. Use **New layer** in the Layers panel for a blank transparent canvas-sized image, or explicitly **Rasterise** text/shapes. Brush options are RGB colour, size in document pixels and hardness. New brush and eraser marks stay circular on resized, rotated and flipped layers; resizing a layer later still transforms its existing pixels; brush strokes use full opacity. Hold **Shift** and scroll over the canvas to increase (up) or decrease (down) brush or eraser size by approximately 10%, with a minimum one-pixel step and a 1–1024 px range. The cursor and size input update together; unmodified scrolling still zooms. Size changes apply between strokes. Eraser options are opacity, size and hardness; fill uses full opacity, four-connected pixels and a 0–255 premultiplied-RGBA tolerance. Brush and eraser strokes may start outside the layer and cross into it; marks are clipped to the layer boundary, including dabs whose centres are outside but overlap the edge. Strokes that never affect any pixels create no undo entry. Active pixel selections clip painting. Each edit creates an independent immutable PNG asset, so duplicates remain unchanged. Existing erasures are baked into the new pixels; painting can restore colour over them. Painting is limited to 8192 pixels per bitmap edge and 32 million bitmap pixels, including expansion for stretched layers. Pressure dynamics are not included.

With Pen, click anchors and drag for curves. Click the first point to close a path or press Enter for an open path. The second anchor creates and selects a new path layer immediately. Further anchors extend that layer until you choose **Finish path**, press Enter or close it. Drawing again starts a separate layer automatically, even when the finished path remains selected. Select a path and activate Pen to move anchors and handles; Alt-drag breaks handle symmetry. Select anchors directly on the canvas; the options bar supplies corner/smooth conversion and anchor deletion. Finish path appears only while extending a newly created path. Close shape is available for open paths with at least three anchors, while drawing or after finishing, and is undoable. A finished path needs at least two anchors. Pen options expose path fill/stroke colours, fill opacity, stroke width and stroke opacity, synchronized with the selected path and Properties. With no path selected they set the style for the next path; defaults are a two-pixel black stroke and no fill. Fill appears on closed paths. Choosing a fill colour replaces a gradient with a solid fill.

Gradient drags apply to a selected rectangle, ellipse or closed path, otherwise create a document-sized Gradient rectangle above the selected layer. Choose linear/radial and move the start/end geometry handles on the canvas. Each stop has an RGBA swatch with colour, opacity and eyedropper controls. Stop controls and labels follow their positions from the start to the end of the gradient, updating as handles cross. The original two stops stay at 0% and 100% and cannot be removed; only added stops have position handles and trash buttons. Drag those handles or use arrow keys (1%, Shift for 10%) to reposition them. Add stop interpolates the largest interval, up to six stops. Older gradients with more stops remain editable but cannot add stops until below six. With no gradient selected, options configure the next gradient. Return to **Solid fill** in the selected shape or path toolbar. Radial start is the centre and end defines radius. Gradients are vector fills, not raster-selection paint.

Each completed stroke, fill or handle drag is one undo entry. Pen creates one entry for the initial two-anchor layer, then one for each added anchor or closure. Escape, changing tools or leaving the window discards uncommitted gestures; path anchors already added to a layer remain. Space/middle-button still pans. Tool controls and selection outlines are session state; committed pixels, paths and gradients save locally and export through the same renderer.

Projects belong to the browser profile and origin where they were saved. Clearing that origin's storage removes local projects. PNG exports are flattened images; portable editable project files are a future addition.

## Architecture and files

```text
index.html                  Semantic editor shell and dialogs
css/app.css                 Dark theme, responsive layout and focus states
manifest.webmanifest        Installation metadata and local icons
sw.js                       Versioned offline cache, scoped to deployment path
js/app.js                   Explicit editor state and application orchestration
js/model/                   Document/layer factories, validation, effect defaults
js/rendering/               Canvas renderer, effect registry, pixel worker, dither
js/interaction/             Shared geometry, object hit testing, viewport and gestures
js/history/                 Reversible commands and saved-state checkpoints
js/storage/                 IndexedDB projects, binary assets and decoded image lifetime
js/components/              Escaped property/effect/layer panel templates
icons/                      Fluent UI icons, generated UI sprite and app installation icons
tests/                      Node unit tests and optional real-browser integration checks
tools/                      Dependency-free dev server and optional icon regeneration
```

**Document model.** Version 2 is plain JSON (version-1 projects migrate on load): document ID/name/timestamps, canvas dimensions/background, an ordered `layers` array and asset metadata. Every layer has a stable ID, name, visibility, locking, opacity, transform and effects. Variants add `assetId`, `text` or `shape`. Transforms use centre coordinates, positive dimensions, degrees and explicit flip flags. Selection, history, decoded images, viewport and caches are session state, outside project JSON. `validateDocument` rejects unsupported versions, invalid properties and broken asset references.

**Drawing tools.** `interaction/tools.js` routes selection and drawing gestures before workspace transforms. `model/vector.js` validates and traces paths/gradients. `rendering/paint.js` maps source pixels, creates selection masks and composites round strokes; `fill-worker.js` runs the iterative flood-fill algorithm. Raster previews are transient renderer overrides; commits swap asset references with stale-document checks.

**Image selections.** `model/pixel-region.js` supplies normalized paths, validation and source-pixel crop bounds. `interaction/pixel-selection.js` owns transient selection gestures and SVG outlines. `rendering/image-pixels.js` extracts cropped PNGs and applies the optional image-layer `eraseRegions` paths using even-odd alpha subtraction before effects. Original assets remain immutable. Erasure commands store the affected path lists; the renderer includes those paths in its cache key while still reusing pixel processing during movement. Older version-1 documents without paths remain valid.

**Rendering.** `DocumentRenderer.renderDocument(document, assets, canvas)` draws document state independently of the UI. A layer is rasterised in local coordinates, processed through its ordered effects, transformed and composited with layer opacity. The screen uses a viewport-sized canvas at display pixel density, drawing shapes and text without enabled effects directly at the current zoom. Images and enabled pixel effects retain document-resolution rendering. An independent SVG overlay provides sharp editor handles at every zoom; export uses a separate document-resolution canvas and never includes the overlay. `exportPNG` returns a Blob. Text wraps/clips to its editable box; transforms never overwrite image source data.

**Effects.** Defaults/UI field definitions live in `model/effects.js`; processors live in `rendering/effects.js`. The initial ordering is brightness → contrast → dither → colour overlay → stroke → blur → drop shadow. Each effect has an ID, type, enabled flag and parameters. Rendering follows the stored order. Brightness, contrast, dithering and alpha dilation run in a module worker; Canvas handles compositing and native blur where a pixel probe confirms support. Browsers without working Canvas filters use a worker-based, premultiplied-alpha Gaussian approximation (three box passes) for blur and soft drop shadows; the same processing applies to preview and PNG export. Stroke is an outside alpha contour with square joins. Layer buffers include padding for strokes, arrowheads, blur and shadow. Add algorithms in the image-processing modules without modifying toolbar code.

**Interaction/history.** Shared inverse geometry implements object-bound selection. `Workspace` owns viewport and transient pointer gestures, committing one reversible transform command on pointer release; Escape restores the starting transform. The history manager stores changed properties, affected layer objects or ordering, not full-document snapshots. It tracks saved command states, clears redo on divergent edits and keeps up to 150 commands. Undo history resets when a project is opened.

**Storage/assets.** IndexedDB `dither` has `projects` and `assets` stores. `saveProject` writes the versioned JSON and referenced source Blobs in one transaction. `loadProject` validates and decodes the required assets before replacing the open document. `AssetStore` caches ImageBitmaps and closes them when switching documents. Shared immutable image IDs allow duplicates without copying sources. Failed/quota-limited saves leave the open project intact.

**Performance.** Render requests are coalesced with animation frames. Local layer caches exclude position, rotation, flip and layer opacity; those edits reuse processed pixels. Effects process at document resolution so preview and export agree. Worker processing leaves the UI event loop free. The current limits are 8192 pixels per document/layer edge, 32 million document/layer pixels, 40 million padded layer pixels and 80 million imported source pixels.

**Offline updates.** The service worker caches the shell, modules, worker, icons and both local font files. It does not force an update while editing. Bump the cache version in `sw.js` when publishing changed static assets, and include any new runtime module in its shell list. Cache namespaces include the deployment path. Applying an offered update requires saved changes first.

## Verification

Run the dependency-free unit suite with Node.js (verified with Node 24):

```sh
npm test
```

The optional integration suite uses Playwright with an installed Edge browser. Playwright is a development tool only and is not shipped or needed to run Dither. To use a separately installed package on PowerShell:

```powershell
$env:DITHER_PLAYWRIGHT_PATH = 'C:/path/to/playwright/index.mjs'
node tests/browser.mjs
node tests/editor-ui.mjs
node tests/line-editing.mjs
node tests/pixel-selection.mjs
node tests/rasterise.mjs
node tests/fonts.mjs
node tests/drawing-tools.mjs
node tests/pen-paths.mjs
node tests/painting-engine.mjs
node tests/blur.mjs
node tests/text-editing.mjs
node tests/shape-toolbars.mjs
node tests/eyedropper.mjs
```

Start the static server first. `DITHER_URL` can target a subdirectory deployment (include the trailing slash); `DITHER_BROWSER` overrides the default `msedge` channel. Each integration run uses a fresh temporary browser profile and writes screenshots and a PNG to `.test-results/`.

The integration suite exercises image import, native pointer transforms, modifiers, all layer types/effects, keyboard actions, save/reload/reopen, exact preview/export pixel agreement, stroke/shadow padding, alpha, quota errors, missing assets, unsupported versions, corrupt imports, local fonts, responsive panels, installability and offline reopening. It also processes a 12-megapixel image and verifies that movement reuses its processed layer cache. Synthetic drop/paste events cover those import handlers; operating-system clipboard permission behaviour is browser-dependent.

## Limitations and risks

- Verified in current desktop Chromium/Edge. Safari, Firefox, touch-only editing and actual operating-system installation still need separate manual coverage.
- PNG export and monochrome Floyd–Steinberg only. Effect order is stored and honoured but cannot yet be reordered in the UI. Stroke has square joins and outside placement only.
- One selected layer at a time; selection uses object bounds, including transparent image areas, except lines/arrows which are selected near their stroke and heads. The six system font options depend on installed fonts; Inter, Noto Sans and Noto Emoji are bundled.
- Pixel selection supports one region on one image layer at a time. Selection union/subtraction, feathering, inverse selection, selection movement and general mask editing are not implemented. Freehand paths are limited to 4096 samples; ellipses use 128 segments. Copied regions are limited to 40 million source pixels. Cropped dimensions below one document pixel use the layer's existing one-pixel minimum. Erasures can be reversed through session history; there is no mask-restoration UI after reopening.
- No autosave, portable `.dither` container, project deletion UI, grouping, blend modes or advanced colour management.
- Large documents can still consume substantial memory. Full-resolution compositing and browser-native blur are main-thread operations. Layer caches currently have no global memory budget; worker errors are surfaced and later processing falls back to the main thread.
- Assets referenced by the document and undo/redo history remain in session memory; discarded history assets are released. Obsolete IndexedDB assets are not garbage-collected yet; repeated replacement of source images can grow storage. Local saves are not a cross-device backup.
- Browser canvas/font rasterisation determines rendering fidelity. Effect padding uses three blur radii; very faint blur tails can be truncated.

## Next steps

1. Add portable project import/export and a local project manager with safe asset garbage collection.
2. Add Atkinson/Bayer algorithms, colour palettes, JPEG/WebP export and effect reordering UI.
3. Add memory-budgeted caches, cancellable worker jobs and a reduced-resolution interaction preview for oversized effects.
4. Extend cross-browser, touch and assistive-technology checks, then consider grouping and alignment tools.

UI icons use Microsoft Fluent UI System Icons under the MIT licence (see `icons/fluent-LICENSE`). Run `node tools/generate-fluent-icons.mjs` after changing the icon selection to rebuild the committed `icons/ui.svg` sprite from `icons/fluent`; no build step is needed to run the app. Legacy Bootstrap assets retain their bundled MIT licence notices. App installation PNGs are derived from the supplied `icons/app-icon.svg`; `tools/generate-icons.mjs` is an optional maintenance helper, not a build requirement.
