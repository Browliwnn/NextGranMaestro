// Flechas SVG sobre un tablero de 800x800 (casillas de 100). Los saltos de caballo se dibujan en forma de L.
const files = 'abcdefgh';
function center(sq: string, flipped: boolean) {
  const f = files.indexOf(sq[0]); const r = Number(sq[1]) - 1;
  return { x: (flipped ? 7 - f : f) * 100 + 50, y: (flipped ? r : 7 - r) * 100 + 50 };
}
export function arrowSvg(from: string, to: string, color: string, w: number, op: number, flipped = false): string {
  const a = center(from, flipped); const b = center(to, flipped);
  const dx = b.x - a.x, dy = b.y - a.y;
  const knight = Math.abs(dx * dy) === 20000; // 100*200
  const pts = knight ? (Math.abs(dx) > Math.abs(dy) ? [a, { x: b.x, y: a.y }, b] : [a, { x: a.x, y: b.y }, b]) : [a, b];
  const p1 = pts[pts.length - 2], p2 = pts[pts.length - 1];
  const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const head = 20 + w * 1.4; const hw = 14 + w * 1.1;
  const tip = p2;
  const bx = tip.x - Math.cos(ang) * head, by = tip.y - Math.sin(ang) * head;
  const startOff = 14;
  const sx = a.x + Math.cos(Math.atan2(pts[1].y - a.y, pts[1].x - a.x)) * startOff;
  const sy = a.y + Math.sin(Math.atan2(pts[1].y - a.y, pts[1].x - a.x)) * startOff;
  const line = [{ x: sx, y: sy }, ...pts.slice(1, -1), { x: bx + Math.cos(ang) * 2, y: by + Math.sin(ang) * 2 }].map((p) => `${p.x},${p.y}`).join(' ');
  const hx1 = bx + Math.cos(ang + Math.PI / 2) * hw, hy1 = by + Math.sin(ang + Math.PI / 2) * hw;
  const hx2 = bx + Math.cos(ang - Math.PI / 2) * hw, hy2 = by + Math.sin(ang - Math.PI / 2) * hw;
  return `<g class="arr" opacity="${op}"><polyline points="${line}" fill="none" stroke="#06140d" stroke-opacity=".5" stroke-width="${w + 6}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<polygon points="${tip.x},${tip.y} ${hx1},${hy1} ${hx2},${hy2}" fill="${color}" stroke="#06140d" stroke-opacity=".5" stroke-width="3" stroke-linejoin="round"/></g>`;
}
