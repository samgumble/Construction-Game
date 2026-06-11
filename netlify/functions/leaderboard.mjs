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
  const txt = await r.text();
  if (!txt) return [];
  let v;
  try {
    v = JSON.parse(txt);
  } catch {
    return [];
  }
  if (Array.isArray(v)) return v;
  // Some API versions return a signed URL envelope instead of the content.
  if (v && typeof v.url === "string") {
    const r2 = await fetch(v.url);
    if (r2.status === 404) return [];
    if (!r2.ok) throw new Error("blob fetch failed: " + r2.status);
    try {
      const v2 = await r2.json();
      return Array.isArray(v2) ? v2 : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function writeList(list) {
  const { token, siteID } = cfg();
  const body = JSON.stringify(list);
  // The Blobs API stores the request body directly on PUT.
  const r = await fetch(`${API}/${siteID}/${STORE}/${KEY}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body,
  });
  if (!r.ok) throw new Error("blob write failed: " + r.status);
  // Some API versions instead respond with a presigned URL to upload to.
  const txt = await r.text();
  if (txt) {
    let v = null;
    try {
      v = JSON.parse(txt);
    } catch {
      return; // non-JSON response body; direct write succeeded
    }
    if (v && typeof v.url === "string") {
      const up = await fetch(v.url, {
        method: "PUT",
        body,
        headers: { "Content-Type": "application/json" },
      });
      if (!up.ok) throw new Error("blob upload failed: " + up.status);
    }
  }
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
