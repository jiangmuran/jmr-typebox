import { describe, it, expect } from 'vitest'
import {
  degToRad, radToDeg, fitContain, placeLayer, localCorners,
  localToWorld, worldToLocal, corners, hitTest, topLayerAt,
  handlePositions, hitHandle, scaleFromHandle, rotationFromHandle,
  snapAngle, orderForDraw, visibleInDrawOrder, moveLayer, HALF_PI,
} from '../composeMath'

const layer = (o = {}) => ({ cx: 100, cy: 100, w: 100, h: 100, rotation: 0, visible: true, ...o })
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

describe('deg/rad', () => {
  it('converts both ways', () => {
    expect(near(degToRad(180), Math.PI)).toBe(true)
    expect(near(radToDeg(Math.PI), 180)).toBe(true)
    expect(degToRad('x')).toBe(0)
  })
})

describe('fitContain', () => {
  it('contains preserving aspect ratio', () => {
    expect(fitContain(200, 100, 100, 100)).toEqual({ w: 100, h: 50, scale: 0.5 })
    expect(fitContain(100, 200, 100, 100)).toEqual({ w: 50, h: 100, scale: 0.5 })
  })
  it('never returns zero and tolerates bad input', () => {
    const r = fitContain(0, 0, 10, 10)
    expect(r.w).toBeGreaterThan(0)
    expect(r.h).toBeGreaterThan(0)
  })
})

describe('placeLayer', () => {
  it('centres the layer on the stage', () => {
    const r = placeLayer(100, 100, 800, 600)
    expect(r.cx).toBe(400)
    expect(r.cy).toBe(300)
  })
  it('keeps small images at natural size but shrinks oversized ones', () => {
    expect(placeLayer(100, 100, 800, 600).w).toBe(100)           // small: natural
    const big = placeLayer(2000, 2000, 800, 600, 0.9)            // oversized: contained to 90%
    expect(big.w).toBeCloseTo(540)                               // 600 * 0.9
    expect(big.w).toBe(big.h)
  })
})

describe('localCorners / corners order', () => {
  it('returns TL,TR,BR,BL', () => {
    expect(localCorners(100, 40)).toEqual([
      { x: -50, y: -20 }, { x: 50, y: -20 }, { x: 50, y: 20 }, { x: -50, y: 20 },
    ])
  })
  it('places world corners around the centre (no rotation)', () => {
    const cs = corners(layer({ w: 100, h: 100 }))
    expect(cs[0]).toEqual({ x: 50, y: 50 })   // TL
    expect(cs[2]).toEqual({ x: 150, y: 150 }) // BR
  })
})

describe('world/local round-trip', () => {
  it('is an inverse pair at an arbitrary rotation', () => {
    const L = layer({ rotation: 0.7, w: 120, h: 60 })
    const p = { x: 133, y: 87 }
    const back = localToWorld(worldToLocal(p, L), L)
    expect(near(back.x, p.x)).toBe(true)
    expect(near(back.y, p.y)).toBe(true)
  })
})

describe('hitTest', () => {
  it('detects points inside/outside an axis-aligned box', () => {
    const L = layer({ w: 100, h: 40 })
    expect(hitTest({ x: 140, y: 110 }, L)).toBe(true)  // local (40,10)
    expect(hitTest({ x: 140, y: 130 }, L)).toBe(false) // local (40,30) — outside h/2=20
  })
  it('respects rotation', () => {
    const L = layer({ w: 100, h: 40, rotation: HALF_PI }) // 90° → tall & narrow in world
    // A point that is outside the un-rotated box but inside the rotated one.
    expect(hitTest({ x: 115, y: 145 }, L)).toBe(true)
    expect(hitTest({ x: 145, y: 115 }, L)).toBe(false)
  })
})

describe('topLayerAt', () => {
  it('returns the front-most (lowest index) hit and skips hidden layers', () => {
    const a = layer({ cx: 100, cy: 100 })          // index 0 = front
    const b = layer({ cx: 100, cy: 100 })          // index 1 = behind
    expect(topLayerAt({ x: 100, y: 100 }, [a, b])).toBe(0)
    expect(topLayerAt({ x: 100, y: 100 }, [{ ...a, visible: false }, b])).toBe(1)
    expect(topLayerAt({ x: 5, y: 5 }, [a, b])).toBe(-1)
  })
})

describe('handlePositions', () => {
  it('puts the rotate handle above top-centre at rotation 0', () => {
    const { corners: cs, top, rotate } = handlePositions(layer({ w: 100, h: 100 }), 28)
    expect(top).toEqual({ x: 100, y: 50 })
    expect(rotate.x).toBeCloseTo(100)
    expect(rotate.y).toBeCloseTo(22)  // 50 - 28
    expect(cs[2]).toEqual({ x: 150, y: 150 })
  })
})

describe('hitHandle', () => {
  it('finds the rotate handle, a corner, or nothing', () => {
    const L = layer({ w: 100, h: 100 })
    expect(hitHandle(L, { x: 100, y: 22 })).toEqual({ type: 'rotate' })
    expect(hitHandle(L, { x: 150, y: 150 })).toEqual({ type: 'corner', index: 2 })
    expect(hitHandle(L, { x: 100, y: 100 })).toBe(null) // centre: no handle
  })
})

describe('scaleFromHandle', () => {
  it('keeps the opposite corner pinned (free scale)', () => {
    const L = layer({ w: 100, h: 100 })            // corners TL(50,50) … BR(150,150)
    const r = scaleFromHandle(L, 2, { x: 200, y: 120 }, { keepAspect: false })
    expect(r).toMatchObject({ w: 150, h: 70 })
    // The anchor (TL corner) must not move.
    const tl = corners({ ...L, ...r })[0]
    expect(near(tl.x, 50)).toBe(true)
    expect(near(tl.y, 50)).toBe(true)
  })
  it('keeps aspect ratio by following the dominant axis', () => {
    const L = layer({ w: 100, h: 100 })
    const r = scaleFromHandle(L, 2, { x: 200, y: 120 }, { keepAspect: true })
    expect(r.w).toBeCloseTo(150)
    expect(r.h).toBeCloseTo(150) // locked to ratio 1, width dominates
  })
  it('enforces a minimum size', () => {
    const L = layer({ w: 100, h: 100 })
    const r = scaleFromHandle(L, 2, { x: 50, y: 50 }, { keepAspect: false, min: 8 })
    expect(r.w).toBe(8)
    expect(r.h).toBe(8)
  })
  it('pins the opposite corner even when rotated', () => {
    const L = layer({ w: 100, h: 60, rotation: 0.6 })
    const anchorBefore = corners(L)[0]
    const r = scaleFromHandle(L, 2, { x: 220, y: 180 }, { keepAspect: false })
    const anchorAfter = corners({ ...L, ...r })[0]
    expect(near(anchorAfter.x, anchorBefore.x, 1e-6)).toBe(true)
    expect(near(anchorAfter.y, anchorBefore.y, 1e-6)).toBe(true)
  })
})

describe('rotationFromHandle', () => {
  it('is 0 when the pointer is directly above the centre', () => {
    expect(near(rotationFromHandle(layer(), { x: 100, y: 40 }), 0)).toBe(true)
  })
  it('is +90° when the pointer is to the right', () => {
    expect(near(rotationFromHandle(layer(), { x: 160, y: 100 }), HALF_PI)).toBe(true)
  })
})

describe('snapAngle', () => {
  it('snaps within tolerance and leaves others alone', () => {
    expect(near(snapAngle(degToRad(88), 15, 6), degToRad(90))).toBe(true)
    expect(near(snapAngle(degToRad(82), 15, 6), degToRad(82))).toBe(true) // 82 is 7° from 75, 8° from 90
  })
})

describe('compositing order', () => {
  it('paints back-to-front (front-first array reversed)', () => {
    const a = { id: 'a', visible: true }, b = { id: 'b', visible: true }, c = { id: 'c', visible: true }
    expect(orderForDraw([a, b, c]).map(l => l.id)).toEqual(['c', 'b', 'a'])
  })
  it('drops hidden layers from the draw sequence', () => {
    const a = { id: 'a', visible: true }, b = { id: 'b', visible: false }, c = { id: 'c', visible: true }
    expect(visibleInDrawOrder([a, b, c]).map(l => l.id)).toEqual(['c', 'a'])
  })
})

describe('moveLayer', () => {
  it('moves an element and returns a new array', () => {
    const arr = ['a', 'b', 'c']
    expect(moveLayer(arr, 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveLayer(arr, 2, 0)).toEqual(['c', 'a', 'b'])
    expect(arr).toEqual(['a', 'b', 'c']) // original untouched
  })
  it('clamps out-of-range targets and ignores bad sources', () => {
    expect(moveLayer(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a'])
    expect(moveLayer(['a', 'b', 'c'], 5, 0)).toEqual(['a', 'b', 'c'])
  })
})
