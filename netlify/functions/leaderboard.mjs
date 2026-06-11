// Shared leaderboard for New Tower Stacker.
// Zero-dependency Netlify Function storing a top-10 list in Netlify Blobs
// via the public REST API (https://api.netlify.com/api/v1/blobs).
//
// Required environment variable (Site configuration -> Environment variables):
//   BLOBS_TOKEN  - a Netlify personal access token (User settings -> Applications)
// Optional:
//   BLOBS_SITE_ID - defaults to the SITE_ID Netlify injects at runtime.

const API = "https://api.netlify.com/api/v1/blobs";
const STORE = "leaderboard";
const KEY = "top10";
const ROLES = new Set(["PC", "PM", "DIR"]);
const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function cfg() {
  const token = process.env.BLOBS_TOKEN;
  const siteID = process.env.BLOBS_SITE_ID || process.env.SITE_ID;
  if (!token || !siteID) throw new Error("missing BLOBS_TOKEN / site id");
  return { token, siteID };
}

async function readList() {
  const { token, siteID } = cfg();
  const r = await fetch(`${API}/${siteID}/${STORE}/${KEY}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error("blob read failed: " + r.status);
  return await r.json();
}

async function writeList(list) {
  const { token, siteID } = cfg();
  // PUT to the API returns a presigned upload URL; upload the JSON there.
  const r = await fetch(`${API}/${siteID}/${STORE}/${KEY}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("blob sign failed: " + r.status);
  const { url } = await r.json();
  const up = await fetch(url, {
    method: "PUT",
    body: JSON.stringify(list),
    headers: { "Content-Type": "application/json" },
  });
  if (!up.ok) throw new Error("blob upload failed: " + up.status);
}

export default async (req) => {
  try {
    if (req.method === "GET") {
      const list = await readList();
      return new Response(JSON.stringify(list), { headers: HEADERS });
    }

    if (req.method === "POST") {
      let b;
      try {
        b = await req.json();
      } catch {
        return new Response('{"error":"bad json"}', { status: 400, headers: HEADERS });
      }
      const i = String(b.i || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
      const s = Math.floor(Number(b.s));
      const f = Math.floor(Number(b.f));
      const r = String(b.r || "");
      if (
        !i ||
        !Number.isFinite(s) || s < 1 || s > 1000000 ||
        !Number.isFinite(f) || f < 0 || f > 10000 ||
        !ROLES.has(r)
      ) {
        return new Response('{"error":"invalid entry"}', { status: 400, headers: HEADERS });
      }

      let list = await readList();
      if (!Array.isArray(list)) list = [];
      list.push({ i, s, f, r, t: Date.now() });
      list.sort((a, b2) => b2.s - a.s || (a.t || 0) - (b2.t || 0));
      list = list.slice(0, 10);
      await writeList(list);
      return new Response(JSON.stringify(list), { headers: HEADERS });
    }

    return new Response('{"error":"method not allowed"}', { status: 405, headers: HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err && err.message) || err) }), {
      status: 500,
      headers: HEADERS,
    });
  }
};
