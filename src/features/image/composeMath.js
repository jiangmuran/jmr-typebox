// Pure, SSG-safe geometry for the multi-layer image compositor. NO window/document/Canvas/Blob
// access here — every function operates on plain numbers/objects so it can be unit-tested in node
// and imported anywhere. The Vue page (ComposePage.vue) owns all the DOM/canvas + interaction and
// delegates the maths to these helpers.
//
// LAYER MODEL (the numeric part; the page also stores the decoded image + id/name/opacity/visible):
//   { cx, cy,        // centre of the layer on the STAGE, in stage pixels
//     w, h,          // the layer's on-stage box size (pre-rotation), in stage pixels
//     rotation }     // clockwise rotation about the centre, in RADIANS
//
// STACKING: the page's `layers` array is ordered FRONT-first (index 0 = topmost). Compositing must
// paint back-to-front, so `orderForDraw` reverses it. Corner handles are indexed 0..3 as
// TL, TR, BR, BL; the opposite corner of `i` is `(i + 2) % 4` (the fixed anchor when scaling).
import { clamp } from './imageHelpers'

export const HALF_PI = Math.PI / 2
export const MIN_SIZE = 8 // smallest allowed layer box edge, in stage px

export function degToRad(deg) { return (Number(deg) || 0) * Math.PI / 180 }
export function radToDeg(rad) { return (Number(rad) || 0) * 180 / Math.PI }

// Scale (w,h) to fit inside (boxW,boxH) preserving aspect ratio. Returns the contained size + the
// applied scale factor. Never returns zero.
export function fitContain(srcW, srcH, boxW, boxH) {
  const sw = Math.max(1, Number(srcW) || 1)
  const sh = Math.max(1, Number(srcH) || 1)
  const s = Math.min(boxW / sw, boxH / sh)
  return { w: Math.max(1, sw * s), h: Math.max(1, sh * s), scale: s }
}

// Initial placement for a newly-added layer: centred on the stage and, if larger than the stage,
// scaled down to `fill` of it (never upscaled past its natural size). Returns { cx, cy, w, h }.
export function placeLayer(srcW, srcH, stageW, stageH, fill = 0.9) {
  const sw = Math.max(1, Number(srcW) || 1)
  const sh = Math.max(1, Number(srcH) || 1)
  const s = Math.min(1, (stageW * fill) / sw, (stageH * fill) / sh)
  return { cx: stageW / 2, cy: stageH / 2, w: sw * s, h: sh * s }
}

// The 4 corners of an axis-aligned box centred at the origin, in local (un-rotated) space.
// Order: TL, TR, BR, BL.
export function localCorners(w, h) {
  const hw = w / 2, hh = h / 2
  return [
    { x: -hw, y: -hh }, // 0 TL
    { x: hw, y: -hh },  // 1 TR
    { x: hw, y: hh },   // 2 BR
    { x: -hw, y: hh },  // 3 BL
  ]
}

// Map a local point (origin = layer centre, pre-rotation) into stage space.
export function localToWorld(p, layer) {
  const c = Math.cos(layer.rotation), s = Math.sin(layer.rotation)
  return { x: layer.cx + p.x * c - p.y * s, y: layer.cy + p.x * s + p.y * c }
}

// Map a stage point into the layer's local space (origin = centre, axes un-rotated).
export function worldToLocal(p, layer) {
  const dx = p.x - layer.cx, dy = p.y - layer.cy
  const c = Math.cos(-layer.rotation), s = Math.sin(-layer.rotation)
  return { x: dx * c - dy * s, y: dx * s + dy * c }
}

// The layer's 4 corners in stage space (TL, TR, BR, BL).
export function corners(layer) {
  return localCorners(layer.w, layer.h).map(p => localToWorld(p, layer))
}

// Is a stage point inside the layer's rotated/scaled box?
export function hitTest(p, layer) {
  const l = worldToLocal(p, layer)
  return Math.abs(l.x) <= layer.w / 2 && Math.abs(l.y) <= layer.h / 2
}

// Front-most layer under a stage point. `layers` is front-first (index 0 = top), so the first hit
// walking forward is the visually top-most. Skips hidden layers. Returns the index, or -1.
export function topLayerAt(p, layers) {
  for (let i = 0; i < layers.length; i++) {
    if (layers[i].visible === false) continue
    if (hitTest(p, layers[i])) return i
  }
  return -1
}

// Stage-space positions of the interactive handles for the selection box:
//   corners: [TL, TR, BR, BL]  · rotate: the round handle above the box  · top: top-centre (line base)
// `rotateOffset` is the gap (stage px) between the top edge and the rotate handle.
export function handlePositions(layer, rotateOffset = 28) {
  const cs = corners(layer)
  const top = localToWorld({ x: 0, y: -layer.h / 2 }, layer)
  const rotate = localToWorld({ x: 0, y: -layer.h / 2 - rotateOffset }, layer)
  return { corners: cs, top, rotate }
}

// Which handle (if any) is under a stage point. Checks the rotate handle first, then corners.
// Returns { type: 'rotate' } | { type: 'corner', index } | null. `hitRadius` is in stage px.
export function hitHandle(layer, p, { rotateOffset = 28, hitRadius = 14 } = {}) {
  const { corners: cs, rotate } = handlePositions(layer, rotateOffset)
  const r2 = hitRadius * hitRadius
  const near = (a, b) => {
    const dx = a.x - b.x, dy = a.y - b.y
    return dx * dx + dy * dy <= r2
  }
  if (near(p, rotate)) return { type: 'rotate' }
  for (let i = 0; i < cs.length; i++) if (near(p, cs[i])) return { type: 'corner', index: i }
  return null
}

// New box when a corner handle is dragged to `pointer` (stage space). The OPPOSITE corner stays
// pinned. Works in the layer's un-rotated frame so it behaves correctly at any rotation. With
// `keepAspect` the box keeps its current aspect ratio (follows the axis the cursor moved most).
// Returns { cx, cy, w, h }.
export function scaleFromHandle(layer, cornerIndex, pointer, { keepAspect = true, min = MIN_SIZE } = {}) {
  const cs = corners(layer)
  const anchor = cs[(cornerIndex + 2) % 4]
  const c = Math.cos(-layer.rotation), s = Math.sin(-layer.rotation)
  const unrot = (pt) => ({ x: pt.x * c - pt.y * s, y: pt.x * s + pt.y * c })
  const aU = unrot(anchor)
  const pU = unrot(pointer)

  const signX = Math.sign(pU.x - aU.x) || 1
  const signY = Math.sign(pU.y - aU.y) || 1
  let newW = Math.max(1e-3, Math.abs(pU.x - aU.x))
  let newH = Math.max(1e-3, Math.abs(pU.y - aU.y))

  if (keepAspect) {
    const ratio = layer.w / layer.h
    if (newW / newH > ratio) newH = newW / ratio
    else newW = newH * ratio
  }
  newW = Math.max(min, newW)
  newH = Math.max(min, newH)

  // Dragged corner + centre in the un-rotated frame, then rotate the centre back to stage space.
  const cornerU = { x: aU.x + signX * newW, y: aU.y + signY * newH }
  const midU = { x: (aU.x + cornerU.x) / 2, y: (aU.y + cornerU.y) / 2 }
  const c2 = Math.cos(layer.rotation), s2 = Math.sin(layer.rotation)
  return {
    cx: midU.x * c2 - midU.y * s2,
    cy: midU.x * s2 + midU.y * c2,
    w: newW,
    h: newH,
  }
}

// Rotation (radians) so the rotate handle points at `pointer`. The handle sits above top-centre,
// i.e. at local angle -90°, so world-angle(center→handle) = rotation - 90° ⇒ rotation = angle + 90°.
export function rotationFromHandle(layer, pointer) {
  const angle = Math.atan2(pointer.y - layer.cy, pointer.x - layer.cx)
  return angle + HALF_PI
}

// Snap a rotation (radians) to the nearest `stepDeg` when within `tolDeg` — for shift-to-snap.
export function snapAngle(rad, stepDeg = 15, tolDeg = 6) {
  const deg = radToDeg(rad)
  const nearest = Math.round(deg / stepDeg) * stepDeg
  if (Math.abs(deg - nearest) <= tolDeg) return degToRad(nearest)
  return rad
}

// Compositing order: paint back-to-front. `layers` is front-first, so reverse it.
export function orderForDraw(layers) {
  return [...layers].reverse()
}

// Visible layers in paint order (back-to-front) — the exact sequence drawToStage should render.
export function visibleInDrawOrder(layers) {
  return orderForDraw(layers).filter(l => l && l.visible !== false)
}

// Move an array element from index `from` to index `to`, returning a NEW array (pure). Out-of-range
// indices are clamped; a no-op returns a shallow copy.
export function moveLayer(arr, from, to) {
  const out = [...arr]
  if (from < 0 || from >= out.length) return out
  const t = clamp(to, 0, out.length - 1)
  const [item] = out.splice(from, 1)
  out.splice(t, 0, item)
  return out
}
