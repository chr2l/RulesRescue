// Rules Rescue — Cloudflare Worker (rules.elie.place)
// Sert la page, et lit les cartes Rules d'une adresse via l'API publique de Voyager.
const CONTRACT = "0x05b456031650c1de9eec123d3e7d06a684d321a346d4a7cac9fd86c2b77cf70f";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const H = { "user-agent": UA, accept: "application/json", referer: "https://voyager.online/" };
const RAR = { common: "C", holographic: "H", platinium: "P", platinum: "P", halloween: "W", live: "L" };
// La page et le script sont des fichiers statiques du Worker (binding ASSETS, construits par site/build.py
// à chaque commit sur main par Workers Builds). Le KV (binding SITE) ne garde que les données du Dex.
const page = async (env, req) => { const r = await env.ASSETS.fetch(new URL("/", req.url)); return r.ok ? r.text() : null; };

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

async function cached(name, ttl, build) {
  const key = new Request("https://cache.local/" + name);
  const hit = await caches.default.match(key);
  if (hit) return hit.json();
  const out = await build();
  await caches.default.put(key, new Response(JSON.stringify(out), { headers: { "content-type": "application/json", "cache-control": "max-age=" + ttl } }));
  return out;
}

async function allEvents(address, k, to_block, max = 30) {
  const out = []; let token = null, guard = 0;
  do {
    const f = { address, keys: [[k]], from_block: { block_number: 0 }, to_block, chunk_size: 1000 };
    if (token) f.continuation_token = token;
    const r = await rpc("starknet_getEvents", { filter: f });
    out.push(...r.events);
    token = r.continuation_token || null;
  } while (token && guard++ < max);
  return out;
}

// Marché Cairo 1 (fin 2023 →) : événements FulfillOrder.
const marketEvents = () => cached("market-events-v1", 604800, async () =>
  (await allEvents(MARKET, FULFILL, { block_number: 760000 })).map(e => {
    const d = e.data; const [a, i] = parseItem(d, 3); const [b] = parseItem(d, i);
    return { b: e.block_number, tx: e.transaction_hash, from: d[1], to: d[2], offer: a, cons: b };
  }));

// Ancien marché Cairo 0 (2022 → 2023, adresse tirée de l'historique de ruleslabs/sdk-core) :
// OfferCreated(id.low, id.high, vendeur, prix) puis OfferAccepted(id.low, id.high, acheteur).
const OLD_MARKET = "0x063a4b3b0122cdaa6ba244739add94aed1d31e3330458cda833a8d119f28cbe8";
const OFFER_CREATED = "0x3dfc158c05b32ed2ffabe664bf6edb241c38aa671d19165307582cde75743b6";
const OFFER_ACCEPTED = "0x309058ad25cd782e894bb5ed51758424e0fcfaf9b0e2996dec721837242fd4d";
const oldSales = () => cached("old-market-sales-v1", 604800, async () => {
  const created = await allEvents(OLD_MARKET, OFFER_CREATED, "latest", 40);
  const accepted = await allEvents(OLD_MARKET, OFFER_ACCEPTED, "latest", 40);
  const evs = [...created.map(e => ({ e, c: 1 })), ...accepted.map(e => ({ e, c: 0 }))]
    .sort((x, y) => x.e.block_number - y.e.block_number || x.c - y.c);
  const offer = new Map(), out = [];
  for (const { e, c } of evs) {
    const d = e.data, id = (BigInt(d[0]) + (BigInt(d[1]) << 128n)).toString();
    if (c) offer.set(id, { seller: d[2], wei: BigInt(d[3]).toString() });
    else { const o = offer.get(id); out.push({ b: e.block_number, tx: e.transaction_hash, id, seller: o ? o.seller : null, buyer: d[2], wei: o ? o.wei : "0", old: 1 }); }
  }
  return out;
});

// Toutes les ventes, sous une forme commune { b, tx, id, seller, buyer, wei }.
async function sales() {
  const out = [];
  for (const e of await marketEvents()) {
    if (e.offer.t === "erc1155" && e.cons.t === "erc20") out.push({ b: e.b, tx: e.tx, id: e.offer.id, seller: e.from, buyer: e.to, wei: e.cons.amt });
    else if (e.offer.t === "erc20" && e.cons.t === "erc1155") out.push({ b: e.b, tx: e.tx, id: e.cons.id, seller: e.to, buyer: e.from, wei: e.offer.amt });
  }
  let oldOk = true;
  try { out.push(...await oldSales()); } catch (e) { oldOk = false; }
  out.oldOk = oldOk;
  return out;
}

const ethOf = w => Number(BigInt(w || 0)) / 1e18;
async function market() {
  return cached("market-summary-v1", 86400, async () => {
    const all = await sales(), M = (1n << 128n) - 1n, byModel = {}, byToken = {};
    for (const s of all.sort((x, y) => x.b - y.b)) {
      const v = ethOf(s.wei); if (!(v > 0)) continue;
      const m = (BigInt(s.id) & M).toString(16);
      const g = byModel[m] = byModel[m] || { n: 0, sum: 0, min: v, max: v, last: 0, lb: 0 };
      g.n++; g.sum += v; g.min = Math.min(g.min, v); g.max = Math.max(g.max, v); g.last = v; g.lb = s.b;
      const t = byToken[s.id] = byToken[s.id] || { n: 0, last: 0 };
      t.n++; t.last = v;
    }
    for (const g of Object.values(byModel)) { g.avg = +(g.sum / g.n).toFixed(5); delete g.sum; }
    return { sales: all.length, old: all.filter(s => s.old).length, oldOk: all.oldOk, byModel, byToken };
  });
}

// Historique d'une carte : transferts (Voyager) + ventes trouvées sur les deux marchés.
async function token(id) {
  const big = BigInt(id), tr = [];
  try {
    let path = `/nft-transfers?contract_address=${CONTRACT}&token_id=${id}&type=erc1155&limit=100`, pages = 0;
    while (path && pages++ < 3) {
      const j = await vget(path, 3600);
      for (const t of j.items || []) if (t.tokenId && BigInt(t.tokenId) === big && BigInt(t.nftContractAddress) === BigInt(CONTRACT)) tr.push({ t: t.timestamp, from: norm(t.fromAddress), to: norm(t.toAddress), q: Number(t.quantity || 1), tx: t.txHash || t.transactionHash || null });
      if (!(j.items || []).length) break;
      path = j.pagination && j.pagination.next ? j.pagination.next : null;
    }
  } catch (e) {}
  const sl = (await sales()).filter(s => BigInt(s.id) === big).map(s => ({ b: s.b, tx: s.tx, seller: s.seller && norm(s.seller), buyer: norm(s.buyer), eth: ethOf(s.wei), old: !!s.old }));
  return { id, transfers: tr.sort((x, y) => x.t - y.t), sales: sl.sort((x, y) => x.b - y.b) };
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
  const partners = new Set(), src = new Map(); const mints = [];
  for (const t of tr) {
    const q = Number(t.quantity || 1), pack = BigInt(t.tokenId) < (1n << 64n);
    const from = BigInt(t.fromAddress), to = BigInt(t.toAddress);
    const ts = t.timestamp; if (!s.firstActivity || ts < s.firstActivity) s.firstActivity = ts; if (!s.lastActivity || ts > s.lastActivity) s.lastActivity = ts;
    if (to === me && from === 0n) { if (pack) s.packsReceived += q; else { s.cardsFromPacks += q; mints.push([ts, q]); } }
    else if (from === me && to === 0n) { if (pack) s.packsOpened += q; }
    else if (to === me) { if (pack) s.packsReceivedFromUsers += q; else s.cardsReceived += q; partners.add(t.fromAddress); const k = norm(t.fromAddress), o = src.get(k) || { a: k, q: 0, t: ts }; o.q += q; if (ts > o.t) o.t = ts; src.set(k, o); }
    else if (from === me) { if (pack) s.packsSent += q; else s.cardsSent += q; partners.add(t.toAddress); }
  }
  s.partners = partners.size;
  s.sources = [...src.values()].sort((x, y) => y.q - x.q).slice(0, 10);
  // Cartes créées par Rules regroupées dans le temps (≤ 2 min d'écart) : un groupe de 3 à 5 = une ouverture de pack probable.
  mints.sort((x, y) => x[0] - y[0]); const groups = [];
  for (const [t, q] of mints) { const g = groups[groups.length - 1]; if (g && t - g.e <= 120) { g.n += q; g.e = t; } else groups.push({ b: t, e: t, n: q }); }
  const hist = {}; groups.forEach(g => hist[g.n] = (hist[g.n] || 0) + 1);
  s.mintGroups = { total: groups.length, sizes: hist, packs: groups.filter(g => g.n >= 3 && g.n <= 5).length, big: groups.filter(g => g.n > 5).map(g => ({ t: g.b, n: g.n })) };
  const ev = await sales();
  const sold = ev.filter(e => e.seller && BigInt(e.seller) === me), bought = ev.filter(e => BigInt(e.buyer) === me);
  const eth = list => list.reduce((x, e) => x + BigInt(e.wei || 0), 0n);
  s.marketTotal = ev.length; s.marketOld = ev.filter(e => e.old).length; s.marketOldOk = ev.oldOk;
  s.sold = sold.length; s.soldEth = (Number(eth(sold)) / 1e18).toFixed(4);
  s.bought = bought.length; s.boughtEth = (Number(eth(bought)) / 1e18).toFixed(4);
  return s;
}

// Admin d'elie.place : le portail pose le cookie de session elie_s sur .elie.place.
// On demande au portail qui est connecté (seul ce cookie est transmis). Rôle admin + double facteur exigés.
const ME = { a: "0xADMIN_ADDR", n: "ADMIN_NAME" };
async function elieAdmin(req) {
  const m = /(?:^|;\s*)elie_s=([^;\s]+)/.exec(req.headers.get("cookie") || "");
  if (!m) return false;
  try {
    const r = await fetch("https://elie.place/api/moi", { headers: { cookie: "elie_s=" + m[1], accept: "application/json" }, signal: AbortSignal.timeout(3000) });
    if (!r.ok) return false;
    const me = await r.json();
    return me.role === "admin" && me.status === "active" && me.totp === true;
  } catch (e) { return false; }
}

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    try {
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
      if (u.pathname === "/api/market") return new Response(JSON.stringify(await market()), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600", ...CORS } });
      if (u.pathname === "/api/token") {
        const id = u.searchParams.get("id") || "";
        if (!/^\d{1,80}$/.test(id)) return json({ error: "id invalide" }, 400);
        return new Response(JSON.stringify(await token(id)), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=600", ...CORS } });
      }
      if (u.pathname === "/api/dex") return new Response(await env.SITE.get("dex") || "[]", { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600", ...CORS } });
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
      if (u.pathname === "/rules_rescue.py") return new Response((await env.ASSETS.fetch(new URL("/rules_rescue.py", req.url))).body, { headers: { "content-type": "text/x-python; charset=utf-8", "content-disposition": "attachment; filename=rules_rescue.py" } });
      if (u.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      // Page profil privée : protégée en amont par Cloudflare Access (application rules.elie.place/moi).
      if (u.pathname === "/moi") {
        if (!req.headers.get("cf-access-authenticated-user-email")) return new Response("Accès réservé.", { status: 403 });
        const html = ((await page(env, req)) || "").replace("</head>", `<script>window.RR_ME="${ME.a}";window.RR_ADMIN=${JSON.stringify(ME)};</script></head>`);
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
      }
      if (u.pathname === "/" || u.pathname === "/index.html") {
        let html = (await page(env, req)) || "Site en cours de mise à jour.";
        if (await elieAdmin(req)) html = html.replace("</head>", `<script>window.RR_ADMIN=${JSON.stringify(ME)};</script></head>`);
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-cache", "vary": "cookie" } });
      }
      return new Response("Not found", { status: 404 });
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
  },
};
