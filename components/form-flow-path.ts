type Rect = { left: number; top: number; width: number; height: number }
type Point = { x: number; y: number }
type Connection = { from: Rect; to: Rect; vertical: boolean; routed: boolean; lane: number; boundary: number; laneSpacing?: number }

/** Round orthogonal bends while retaining exact attachment points and arrow direction. */
const roundedPath = (points: Point[]) => {
  let path = `M ${points[0]!.x} ${points[0]!.y}`
  for (let index = 1; index < points.length - 1; index++) {
    const before = points[index - 1]!, corner = points[index]!, after = points[index + 1]!
    const incoming = Math.hypot(corner.x - before.x, corner.y - before.y)
    const outgoing = Math.hypot(after.x - corner.x, after.y - corner.y)
    if (!incoming || !outgoing) continue
    const radius = Math.min(8, incoming / 2, outgoing / 2)
    const entry = { x: corner.x + (before.x - corner.x) * radius / incoming,
      y: corner.y + (before.y - corner.y) * radius / incoming }
    const exit = { x: corner.x + (after.x - corner.x) * radius / outgoing,
      y: corner.y + (after.y - corner.y) * radius / outgoing }
    path += ` L ${entry.x} ${entry.y} Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`
  }
  const end = points[points.length - 1]!
  return `${path} L ${end.x} ${end.y}`
}

/** Bound the route gutter so large forms retain usable cards and canvas space. */
export const flowLaneSpacing = (count: number, vertical: boolean): number =>
  Math.min(16, (vertical ? 64 : 160) / Math.max(1, count))

/** Adjacent pages connect across the gap; branches/skips use lanes outside all cards. */
export const flowConnectionPath = ({ from, to, vertical, routed, lane, boundary, laneSpacing = 16 }: Connection): string => {
  if (!routed) {
    const start = vertical ? { x: from.left + from.width / 2, y: from.top + from.height + 2 }
      : { x: from.left + from.width + 2, y: from.top + from.height / 2 }
    const end = vertical ? { x: to.left + to.width / 2, y: to.top - 8 }
      : { x: to.left - 8, y: to.top + to.height / 2 }
    const midpoint = vertical ? (start.y + end.y) / 2 : (start.x + end.x) / 2
    return vertical
      ? `M ${start.x} ${start.y} C ${start.x} ${midpoint}, ${end.x} ${midpoint}, ${end.x} ${end.y}`
      : `M ${start.x} ${start.y} C ${midpoint} ${start.y}, ${midpoint} ${end.y}, ${end.x} ${end.y}`
  }
  const start = { x: from.left + from.width + 2, y: from.top + from.height / 2 }
  const lanePosition = boundary + 24 + lane * laneSpacing
  if (vertical) return roundedPath([
    start, { x: lanePosition, y: start.y },
    { x: lanePosition, y: to.top + to.height / 2 },
    { x: to.left + to.width + 8, y: to.top + to.height / 2 }
  ])
  const gutterOffset = 12 + lane % 3 * 6
  const exitX = start.x + gutterOffset
  const entryX = to.left - gutterOffset
  const endY = to.top + to.height / 2
  return roundedPath([
    start, { x: exitX, y: start.y }, { x: exitX, y: lanePosition },
    { x: entryX, y: lanePosition }, { x: entryX, y: endY }, { x: to.left - 8, y: endY }
  ])
}
