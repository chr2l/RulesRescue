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
  while (path && pages++ < 40) {
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

async function deployedAt(addr) {
  try { const c = await vget(`/contract/${addr}`, 300); return !c.error; } catch { return false; }
}


const MARKET = "0x01fea6c39f413ee5a5d81704e4fc45d814c86711947b2973f8df2a733d6d9937";
const FULFILL = "0x377cbc684ca4dbfb21e6b0171e1753221b0bc29d43dd82a782039fd43f2e856";
const RPC = "https://api.zan.top/public/starknet-mainnet";
const CORS = { "access-control-allow-origin": "*" };

async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200)); return j.result;
}

function parseItem(d, i) {
  const v = Number(BigInt(d[i]));
  if (v === 1) return [{ t: "erc20", amt: (BigInt(d[i + 2]) + (BigInt(d[i + 3]) << 128n)).toString() }, i + 4];
  if (v === 3) return [{ t: "erc1155", id: (BigInt(d[i + 2]) + (BigInt(d[i + 3]) << 128n)).toString() }, i + 6];
  return [{ t: "other" }, i + 1];
}

async function marketEvents() {
  const key = new Request("https://cache.local/market-events-v1");
  const hit = await caches.default.match(key);
  if (hit) return hit.json();
  const out = []; let token = null, guard = 0;
  do {
    const f = { address: MARKET, keys: [[FULFILL]], from_block: { block_number: 0 }, to_block: { block_number: 760000 }, chunk_size: 1000 };
    if (token) f.continuation_token = token;
    const r = await rpc("starknet_getEvents", { filter: f });
    for (const e of r.events) {
      const d = e.data; const [a, i] = parseItem(d, 3); const [b] = parseItem(d, i);
      out.push({ b: e.block_number, tx: e.transaction_hash, from: d[1], to: d[2], offer: a, cons: b });
    }
    token = r.continuation_token || null;
  } while (token && guard++ < 30);
  await caches.default.put(key, new Response(JSON.stringify(out), { headers: { "content-type": "application/json", "cache-control": "max-age=604800" } }));
  return out;
}

async function history(addr) {
  const me = BigInt(addr);
  let path = `/nft-transfers?contract_address=${addr}&type=erc1155&limit=100`, pages = 0; const tr = [];
  while (path && pages++ < 40) {
    const j = await vget(path, 300);
    for (const t of j.items || []) if (BigInt(t.nftContractAddress) === BigInt(CONTRACT)) tr.push(t);
    if (!(j.items || []).length) break;
    path = j.pagination && j.pagination.next ? j.pagination.next : null;
  }
  const s = { transfers: tr.length, packsReceived: 0, packsOpened: 0, cardsFromPacks: 0, cardsReceived: 0, cardsSent: 0, packsSent: 0, packsReceivedFromUsers: 0, firstActivity: null, lastActivity: null, partners: 0 };
  const partners = new Set(), src = new Map();
  for (const t of tr) {
    const q = Number(t.quantity || 1), pack = BigInt(t.tokenId) < (1n << 64n);
    const from = BigInt(t.fromAddress), to = BigInt(t.toAddress);
    const ts = t.timestamp; if (!s.firstActivity || ts < s.firstActivity) s.firstActivity = ts; if (!s.lastActivity || ts > s.lastActivity) s.lastActivity = ts;
    if (to === me && from === 0n) { if (pack) s.packsReceived += q; else s.cardsFromPacks += q; }
    else if (from === me && to === 0n) { if (pack) s.packsOpened += q; }
    else if (to === me) { if (pack) s.packsReceivedFromUsers += q; else s.cardsReceived += q; partners.add(t.fromAddress); const k = norm(t.fromAddress), o = src.get(k) || { a: k, q: 0, t: ts }; o.q += q; if (ts > o.t) o.t = ts; src.set(k, o); }
    else if (from === me) { if (pack) s.packsSent += q; else s.cardsSent += q; partners.add(t.toAddress); }
  }
  s.partners = partners.size;
  s.sources = [...src.values()].sort((x, y) => y.q - x.q).slice(0, 10);
  const ev = await marketEvents();
  const sales = [], buys = [];
  for (const e of ev) {
    if (BigInt(e.from) === me) (e.offer.t === "erc1155" ? sales : buys).push(e);
    if (BigInt(e.to) === me) (e.offer.t === "erc1155" ? buys : sales).push(e);
  }
  const eth = list => list.reduce((x, e) => x + BigInt(e.offer.t === "erc20" ? e.offer.amt : e.cons.t === "erc20" ? e.cons.amt : "0"), 0n);
  s.marketTotal = ev.length;
  s.sold = sales.length; s.soldEth = (Number(eth(sales)) / 1e18).toFixed(4);
  s.bought = buys.length; s.boughtEth = (Number(eth(buys)) / 1e18).toFixed(4);
  return s;
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
        const addr = norm(raw), h = await holdings(addr);
        if (u.searchParams.get("format") === "ids") {
          return new Response(JSON.stringify(h.map(([id, q]) => ({ id, q }))), {
            headers: { "content-type": "application/json", "content-disposition": "attachment; filename=cartes.json" } });
        }
        return json({ address: addr, deployed: await deployedAt(addr), items: h.map(([id, q]) => ({ id, q })) });
      }
      if (u.pathname === "/api/history") {
        const raw = u.searchParams.get("address") || "";
        if (!/^0x[0-9a-fA-F]{1,64}$/.test(raw)) return json({ error: "adresse invalide" }, 400);
        const r = await history(norm(raw));
        return new Response(JSON.stringify(r), { headers: { "content-type": "application/json; charset=utf-8", ...CORS } });
      }
      if (u.pathname === "/api/cdx") {
        const q = u.searchParams.get("q") || "";
        if (!/^[a-z0-9.\/*_-]{3,120}$/i.test(q) || !/rules\.art/.test(q)) return json({ error: "requête invalide" }, 400);
        const r = await fetch("https://web.archive.org/cdx/search/cdx?url=" + encodeURIComponent(q) + "&output=json&collapse=urlkey&fl=original,mimetype,timestamp&filter=statuscode:200&limit=" + Math.min(Number(u.searchParams.get("limit")) || 200, 2000), { headers: { "user-agent": UA } });
        return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", ...CORS } });
      }
      if (u.pathname === "/api/meta") {
        const ids = (u.searchParams.get("ids") || "").split(",").filter(x => /^\d{1,80}$/.test(x)).slice(0, 40);
        const out = {};
        for (let i = 0; i < ids.length; i += 5) {
          await Promise.all(ids.slice(i, i + 5).map(async id => {
            try { const { img, ...m } = await meta(id); out[id] = m; } catch { out[id] = null; }
          }));
        }
        return json(out);
      }
      if (u.pathname.startsWith("/ipfs/")) {
        const cid = u.pathname.slice(6);
        if (!/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]{50,60})$/.test(cid)) return new Response("bad cid", { status: 400 });
        const h = { "user-agent": UA }; const range = req.headers.get("range"); if (range) h.range = range;
        const r = await fetch("https://gateway.pinata.cloud/ipfs/" + cid, { headers: h, cf: { cacheTtl: 86400 * 30, cacheEverything: true } });
        const out = new Headers({ "cache-control": "public, max-age=2592000, immutable", "accept-ranges": "bytes" });
        for (const k of ["content-type", "content-length", "content-range"]) { const v = r.headers.get(k); if (v) out.set(k, v); }
        return new Response(r.body, { status: r.status, headers: out });
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
      // Page profil privée : protégée en amont par Cloudflare Access (application rules.elie.place/moi).
      if (u.pathname === "/moi") {
        if (!req.headers.get("cf-access-authenticated-user-email")) return new Response("Accès réservé.", { status: 403 });
        const html = (await env.SITE.get("html") || "").replace("</head>", '<script>window.RR_ME="0xADMIN_ADDR";</script></head>');
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
      }
      if (u.pathname === "/" || u.pathname === "/index.html") return new Response(await env.SITE.get("html") || "Site en cours de mise à jour.", { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
      return new Response("Not found", { status: 404 });
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
  },
};
