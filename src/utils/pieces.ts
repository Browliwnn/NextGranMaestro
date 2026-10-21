// Piezas de ajedrez dibujadas a mano para NextGranMaestro (diseño propio, sin licencias de terceros).
// Cada pieza es un SVG 45x45. Los degradados (#pg-w, #pg-b) se definen una vez con <PieceDefs />.
const base = '<path d="M9 40h27v-2.2c0-1.4-1-2.3-2.4-2.3H11.4C10 35.5 9 36.4 9 37.8z"/>';
const body: Record<string, string> = {
  p: '<circle cx="22.5" cy="12.5" r="5.2"/><path d="M22.5 18c-3.6 0-6 2.6-6 5.8 0 1.8.9 3.2 2.3 4.2-3.4 1.2-6.3 4.4-6.3 7.5h20c0-3.1-2.9-6.3-6.3-7.5 1.4-1 2.3-2.4 2.3-4.2 0-3.2-2.4-5.8-6-5.800z"/>',
  r: '<path d="M11.5 9h4.600v3.600h3.400V9h6v3.600h3.400V9h4.600v8.200l-3.8 3.100v12.800l3.8 2.400v.9H11.500v-.9l3.8-2.400V20.300l-3.8-3.100z"/><path d="M15.3 20.300h14.400M15.3 33h14.4" fill="none"/>',
  n: '<path d="M12.5 37.500c-.4-8 2.2-13.4 6.2-17.2-2.8.1-4.7 1.7-7.2 3.800l-2.3-2.800c3-4.9 7.5-10.2 13.6-11.800l1.7-3.1 2.4 3.400c7.2 2 12.3 8.2 12.3 17.5 0 4-.6 7-1.3 10.200z"/><circle cx="23" cy="14.5" r="1.5" class="eye"/><path d="M13.5 22.500l3.5-1.5" fill="none"/>',
  b: '<path d="M22.5 6.800c-5.4 4.4-8.6 9.3-8.6 14.4 0 3.7 2.4 6 5.2 7.300l-3.1 5.200h13l-3.1-5.200c2.8-1.3 5.2-3.6 5.2-7.3 0-5.1-3.2-10-8.6-14.400z"/><circle cx="22.5" cy="6.3" r="2.4"/><path d="M19 17.500h7M22.5 14v7" fill="none"/>',
  q: '<path d="M9 14.500l4.7 17.500h17.600L36 14.500l-6.8 8.2-3.5-11.7-3.2 11.7-3.2-11.7-3.5 11.700z"/><circle cx="9" cy="13" r="2.2"/><circle cx="15.5" cy="9.5" r="2.2"/><circle cx="22.5" cy="8.5" r="2.2"/><circle cx="29.5" cy="9.5" r="2.2"/><circle cx="36" cy="13" r="2.2"/><path d="M12 32.500h21l1.5 3.500h-24z"/>',
  k: '<rect x="20.8" y="3.5" width="3.4" height="10" rx="1"/><rect x="17.5" y="6.8" width="10" height="3.4" rx="1"/><path d="M22.5 14.500c-6.4 0-10.8 4.2-10.8 9.5 0 3.1 2 5.3 4.3 6.500l-3.2 5h19.400l-3.2-5c2.3-1.2 4.3-3.4 4.3-6.5 0-5.3-4.4-9.5-10.8-9.500z"/><path d="M14 27.500h17" fill="none"/>',
};
export function pieceSvg(color: 'w' | 'b', type: string): string {
  const fill = color === 'w' ? 'url(#pg-w)' : 'url(#pg-b)';
  const stroke = color === 'w' ? '#5a4210' : '#07090d';
  const detail = color === 'w' ? '#8a6a22' : '#8fa0b8';
  return `<svg viewBox="0 0 45 45" class="pcs" aria-hidden="true" focusable="false"><g fill="${fill}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><g style="--d:${detail}">${body[type]}${base}</g></g></svg>`;
}
export const defsSvg = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
<linearGradient id="pg-w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffaf0"/><stop offset=".55" stop-color="#f3dca0"/><stop offset="1" stop-color="#d9a93f"/></linearGradient>
<linearGradient id="pg-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5d6b82"/><stop offset=".5" stop-color="#2a3344"/><stop offset="1" stop-color="#10141c"/></linearGradient>
</defs></svg>`;
