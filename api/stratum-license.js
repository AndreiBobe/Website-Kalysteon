// Stratum : date de fin des mises a jour d'une licence.
//
// Stratum envoie { license_key } en POST. On repond
// { ok, tier, updates_until: "AAAA-MM-JJ", renew_url }.
//
// Regle : un achat inclut 1 an de mises a jour. Chaque annee payee sur
// l'abonnement de renouvellement ajoute 1 an, a la suite de la periode en
// cours (renouveler en avance ne fait rien perdre). Le logiciel lui-meme ne
// s'arrete jamais : il garde toutes les versions sorties avant cette date.
//
// La cle API Lemon Squeezy est dans les variables d'environnement Vercel
// (LEMONSQUEEZY_API_KEY). Elle ne doit jamais etre ecrite ici.

const LS = "https://api.lemonsqueezy.com/v1";
const DAY = 24 * 3600 * 1000;
const YEAR = 365 * DAY;

// Produits licence -> palier (mode reel, puis mode test)
const TIERS = { 1367704: "indie", 1367705: "studio", 1152322: "indie", 1152341: "studio" };
// Abonnements de renouvellement par palier
const RENEWAL_PRODUCT = { indie: 1367707, studio: 1367712 };
const RENEW_URL = {
  indie: "https://kalysteon.lemonsqueezy.com/checkout/buy/fb5e6655-13b7-426b-9142-96524942c034",
  studio: "https://kalysteon.lemonsqueezy.com/checkout/buy/9878d4e8-b6cb-4804-803a-30c8cf241add",
};

function day(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Periode payee d'un abonnement, ou null s'il n'a jamais ete paye.
function paidSpan(sub) {
  const a = sub.attributes || {};
  const start = Date.parse(a.created_at);
  let end = null;
  if (a.status === "active" || a.status === "past_due") end = Date.parse(a.renews_at);
  else if (a.status === "cancelled" || a.status === "expired") end = Date.parse(a.ends_at);
  if (!start || !end || end <= start) return null;
  return { start, length: end - start };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const key = String(body.license_key || "").trim();
  if (!key || key.length > 200) return res.status(400).json({ ok: false, error: "missing key" });

  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: "server not configured" });

  try {
    // 1. La cle existe-t-elle, et pour quel produit ? (endpoint public)
    const v = await fetch(LS + "/licenses/validate", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ license_key: key }).toString(),
    });
    const vj = await v.json().catch(() => ({}));
    const meta = vj.meta || {};
    const lk = vj.license_key || {};
    const tier = TIERS[meta.product_id];
    if (!vj.valid || !tier) return res.status(404).json({ ok: false, error: "invalid key" });

    const bought = Date.parse(lk.created_at);
    if (!bought) return res.status(502).json({ ok: false, error: "no purchase date" });

    // 2. Les renouvellements payes par le meme client
    const q = new URLSearchParams({
      "filter[store_id]": String(meta.store_id || ""),
      "filter[product_id]": String(RENEWAL_PRODUCT[tier]),
      "filter[user_email]": String(meta.customer_email || ""),
      "page[size]": "100",
    });
    const s = await fetch(LS + "/subscriptions?" + q.toString(), {
      headers: { Accept: "application/vnd.api+json", Authorization: "Bearer " + apiKey },
    });
    if (!s.ok) return res.status(502).json({ ok: false, error: "subscriptions " + s.status });
    const sj = await s.json();

    const spans = (sj.data || [])
      .filter((sub) => !meta.customer_id || (sub.attributes || {}).customer_id === meta.customer_id)
      .map(paidSpan)
      .filter(Boolean)
      .sort((a, b) => a.start - b.start);

    // 3. 1 an inclus, puis chaque periode payee s'ajoute a la suite
    let until = bought + YEAR;
    for (const span of spans) until = Math.max(until, span.start) + span.length;

    const email = meta.customer_email ? "?checkout[email]=" + encodeURIComponent(meta.customer_email) : "";
    return res.status(200).json({
      ok: true,
      tier,
      updates_until: day(until),
      renew_url: RENEW_URL[tier] + email,
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: "lemon squeezy unreachable" });
  }
};
