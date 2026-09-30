import { describe, expect, it } from 'vitest'
import { flowConnectionPath, flowLaneSpacing } from '../components/form-flow-path'

describe('flow connector attachment and routing', () => {
  it.each([0, 2, 20, 600])('bounds narrow-layout gutters for %i skipped routes', count => {
    const spacing = flowLaneSpacing(count, true)
    expect(spacing * count).toBeLessThanOrEqual(64)
    expect(flowLaneSpacing(count, false) * count).toBeLessThanOrEqual(160)
    const path = flowConnectionPath({ from: { left: 0, top: 0, width: 214, height: 88 },
      to: { left: 55, top: 600, width: 104, height: 88 }, vertical: true, routed: true,
      lane: Math.max(0, count - 1), laneSpacing: spacing, boundary: 214 })
    const numbers = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
    expect(numbers.filter((_, index) => index % 2 === 0).every(x => x < 310)).toBe(true)
  })

  it('attaches horizontal and vertical direct arrows to the facing edges', () => {
    expect(flowConnectionPath({ from: { left: 0, top: 0, width: 100, height: 80 },
      to: { left: 148, top: 0, width: 264, height: 80 }, vertical: false, routed: false, lane: 0, boundary: 80 }))
      .toBe('M 102 40 C 121 40, 121 40, 140 40')
    expect(flowConnectionPath({ from: { left: 82, top: 0, width: 100, height: 80 },
      to: { left: 0, top: 128, width: 264, height: 80 }, vertical: true, routed: false, lane: 0, boundary: 264 }))
      .toBe('M 132 82 C 132 101, 132 101, 132 120')
  })

  it('routes horizontal skipped pages below all cards and enters from the left', () => {
    const connection = { from: { left: 148, top: 150, width: 240, height: 80 },
      to: { left: 772, top: 0, width: 264, height: 88 }, vertical: false, routed: true, lane: 0, boundary: 330 }
    const path = flowConnectionPath(connection)
    expect(path).toMatch(/^M 390 190 /)
    expect(path).toContain('354')
    expect(path).toMatch(/L 764 44$/)
    expect(flowConnectionPath({ ...connection, lane: 1 })).toContain('370')
  })

  it('routes narrow-layout branches outside page widths and enters from the right', () => {
    const path = flowConnectionPath({ from: { left: 28, top: 100, width: 350, height: 80 },
      to: { left: 0, top: 600, width: 400, height: 88 }, vertical: true, routed: true, lane: 2, boundary: 400 })
    expect(path).toMatch(/^M 380 140 /)
    expect(path).toContain('456')
    expect(path).toMatch(/L 408 644$/)
    expect(path).not.toMatch(/NaN|Infinity/)
  })
})
