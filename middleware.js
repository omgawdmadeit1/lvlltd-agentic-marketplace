// Vercel Routing Middleware: Accept: text/markdown content negotiation for agents (HTML stays the default).
export const config = { matcher: ['/', '/buy'] };

export const MD_TWIN = { '/': '/index.md', '/buy': '/buy.md' };

export function wantsMarkdown(accept) {
  return String(accept || '').split(',').some((part) => {
    const [type, ...params] = part.trim().toLowerCase().split(';').map((s) => s.trim());
    if (type !== 'text/markdown') return false;
    const q = params.find((p) => p.startsWith('q='));
    return !q || parseFloat(q.slice(2)) > 0;
  });
}

export default async function middleware(request) {
  if (!wantsMarkdown(request.headers.get('accept'))) return; // fall through to static HTML
  const url = new URL(request.url);
  const src = MD_TWIN[url.pathname];
  if (!src) return;
  const res = await fetch(new URL(src, url.origin), { headers: { accept: 'text/markdown' } });
  if (!res.ok) return;
  const body = await res.text();
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'vary': 'Accept',
      'x-markdown-tokens': String(Math.ceil(body.length / 4)),
      'link': `<${url.origin}${url.pathname}>; rel="canonical"; type="text/html"`,
    },
  });
}
