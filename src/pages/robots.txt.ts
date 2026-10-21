import type { APIRoute } from 'astro';
export const GET: APIRoute = ({ site }) => {
  const base = (site?.toString() ?? '').replace(/\/$/, '');
  return new Response(`User-agent: *\nAllow: /\nDisallow: /engine/\nDisallow: /api/\nDisallow: /gracias\nDisallow: /cuenta\nDisallow: /traspasar\nDisallow: /buscar\n\nSitemap: ${base}/sitemap-index.xml\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
