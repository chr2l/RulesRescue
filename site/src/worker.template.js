// Rules Rescue — Cloudflare Worker (rules.elie.place)
// Sert la page, et lit les cartes Rules d'une adresse via l'API publique de Voyager.
const CONTRACT = "0x05b456031650c1de9eec123d3e7d06a684d321a346d4a7cac9fd86c2b77cf70f";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const H = { "user-agent": UA, accept: "application/json", referer: "https://voyager.online/" };
const RAR = { common: "C", holographic: "H", platinium: "P", platinum: "P", halloween: "W" };
// Le contenu (page + script) vit dans KV (binding SITE), mis à jour par /admin (jeton ADMIN_TOKEN).
const ADMIN_PAGE = `<!doctype html><meta charset="utf-8"><title>Mise à jour</title><body style="font:15px system-ui;padding:24px"><p id="s">Envoi…</p><script>
(async()=>{const s=document.getElementById("s");try{const raw=decodeURIComponent(escape(atob(location.hash.slice(1))));const t=new URLSearchParams(location.search).get("t");
const r=await fetch("/admin/put",{method:"POST",headers:{"x-admin-token":t,"content-type":"application/json"},body:raw});s.textContent=r.ok?"Site mis à jour ("+(await r.text())+")":"Erreur "+r.status+" "+await r.text();
history.replaceState(null,"","/admin");}catch(e){s.textContent="Erreur : "+e.message}})();<\/script>`;

const norm = a => "0x" + BigInt(a).toString(16).padStart(64, "0");

async function vget(path, ttl = 600) {
  const url = "https://voyager.online/api" + path;
  const cache = caches.default, key = new Request(url);
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const r = await fetch(url, { headers: H });
  if (!r.ok) throw new Error("voyager " + r.status);
  const body = await r.text();
  await cache.put(key, new Response(body, { headers: { "content-type": "application/json", "cache-control": `max-age=${ttl}` } }));
  return JSON.parse(body);
}

async function holdings(addr) {
  const me = BigInt(addr);
  let path = `/nft-transfers?contract_address=${addr}&type=erc1155&limit=100`, pages = 0;
  const bal = new Map();
  while (path && pages++ < 60) {
    const j = await vget(path, 300);
    for (const t of j.items || []) {
      if (BigInt(t.nftContractAddress) !== BigInt(CONTRACT)) continue;
      const q = Number(t.quantity || 1), id = t.tokenId;
      if (BigInt(t.toAddress) === me) bal.set(id, (bal.get(id) || 0) + q);
      if (BigInt(t.fromAddress) === me) bal.set(id, (bal.get(id) || 0) - q);
    }
    if (!(j.items || []).length) break;
    path = j.pagination && j.pagination.next ? j.pagination.next : null;
  }
  return [...bal].filter(([, q]) => q > 0);
}

async function meta(id) {
  const m = await vget(`/nft/${CONTRACT}/${id}`, 86400 * 7);
  const a = {}; (m.attributes || []).forEach(x => a[(x.trait_type || "").toLowerCase()] = x.value);
  const pack = !a.artist;
  return {
    id, a: pack ? (m.name || "Pack") : a.artist, r: pack ? "K" : (RAR[(a.rarity || "").toLowerCase()] || "C"),
    n: Number(a["serial number"] || 0), s: Number(a.season || (/S2/.test(m.name || "") ? 2 : 1)),
    img: m.imageUrl || m.imageSmallUrl || null,
  };
}

async function cards(addr) {
  const h = await holdings(addr);
  const out = [];
  for (let i = 0; i < h.length; i += 12) {
    const part = await Promise.all(h.slice(i, i + 12).map(async ([id, q]) => {
      try { return { ...(await meta(id)), q }; } catch { return { id, a: "Carte #" + id.slice(0, 8), r: "C", n: 0, s: 1, q, img: null }; }
    }));
    out.push(...part);
  }
  let deployed = false;
  try { const c = await vget(`/contract/${addr}`, 300); deployed = !c.error; } catch {}
  return { address: addr, deployed, items: out };
}

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    try {
      if (u.pathname === "/admin") return new Response(ADMIN_PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
      if (u.pathname === "/admin/put" && req.method === "POST") {
        if (!env.ADMIN_TOKEN || req.headers.get("x-admin-token") !== env.ADMIN_TOKEN) return new Response("forbidden", { status: 403 });
        const b = await req.json(); const done = [];
        for (const k of ["html", "script"]) if (typeof b[k] === "string" && b[k].length > 100) { await env.SITE.put(k, b[k]); done.push(k + " " + b[k].length); }
        return new Response(done.join(", ") || "rien");
      }
      if (u.pathname === "/api/cards") {
        const raw = u.searchParams.get("address") || "";
        if (!/^0x[0-9a-fA-F]{1,64}$/.test(raw)) return json({ error: "adresse invalide" }, 400);
        const r = await cards(norm(raw));
        if (u.searchParams.get("format") === "ids") {
          return new Response(JSON.stringify(r.items.map(d => ({ id: d.id, q: d.q, nom: d.a }))), {
            headers: { "content-type": "application/json", "content-disposition": "attachment; filename=cartes.json" } });
        }
        return json({ ...r, items: r.items.map(({ img, ...d }) => d) });
      }
      if (u.pathname.startsWith("/img/")) {
        const id = u.pathname.slice(5);
        if (!/^\d{1,80}$/.test(id)) return new Response("bad id", { status: 400 });
        const m = await meta(id);
        if (!m.img) return new Response("no image", { status: 404 });
        const r = await fetch(m.img, { headers: { "user-agent": UA }, cf: { cacheTtl: 86400 * 30, cacheEverything: true } });
        return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "image/jpeg", "cache-control": "public, max-age=2592000" } });
      }
      if (u.pathname === "/rules_rescue.py") return new Response(await env.SITE.get("script") || "# indisponible", { headers: { "content-type": "text/x-python; charset=utf-8", "content-disposition": "attachment; filename=rules_rescue.py" } });
      if (u.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      if (u.pathname === "/" || u.pathname === "/index.html") return new Response(await env.SITE.get("html") || "Site en cours de mise à jour.", { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
      return new Response("Not found", { status: 404 });
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
  },
};
