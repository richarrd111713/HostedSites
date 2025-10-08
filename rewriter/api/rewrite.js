import fetch from "node-fetch";
import { JSDOM } from "jsdom";

const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
];

async function fetchFollowServerSide(url, opts = {}, maxRedirects = 5) {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const resp = await fetch(current, { ...opts, redirect: "manual" });
    // If redirect, resolve Location and continue loop
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      if (!loc) return resp;
      try {
        current = new URL(loc, current).href;
        continue;
      } catch {
        return resp;
      }
    }
    // Not a redirect: return final response
    return resp;
  }
  throw new Error("Too many redirects");
}

export default async function handler(req, res) {
  // Always set CORS and common response headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Expose-Headers", "Content-Type,Content-Length");
  if (req.method === "OPTIONS") return res.status(204).end();

  const target = req.query.url;
  if (!target) return res.status(400).send("Missing ?url=");
  if (!/^https?:\/\//i.test(target)) return res.status(400).send("Invalid URL");

  try {
    // Fetch with server-side redirect handling
    const upstream = await fetchFollowServerSide(target, {
      headers: { "User-Agent": "Mozilla/5.0 (proxy)" },
    }, 8);

    const contentType = upstream.headers.get("content-type") || "";

    // If non-HTML, stream the body back with headers, never forward upstream Location or its CORS
    if (!contentType.includes("text/html")) {
      const buffer = await upstream.arrayBuffer();

      // Forward useful headers, excluding hop-by-hop and ACL-Origin and Location
      upstream.headers.forEach((value, name) => {
        const lower = name.toLowerCase();
        if (HOP_BY_HOP.includes(lower)) return;
        if (lower === "access-control-allow-origin") return;
        if (lower === "location") return; // do not forward upstream redirects
        // set header (keep original casing from upstream.name)
        res.setHeader(name, value);
      });

      // Ensure CORS/frame/content-type
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("X-Frame-Options", "ALLOWALL");
      if (contentType) res.setHeader("Content-Type", contentType);

      res.status(upstream.status || 200);
      return res.send(Buffer.from(buffer));
    }

    // HTML case: parse, rewrite assets to route through this proxy, then return HTML
    const html = await upstream.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    doc.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      try {
        const newHref = new URL(href, target).href;
        a.setAttribute("href", `/api/rewrite?url=${encodeURIComponent(newHref)}`);
        a.setAttribute("target", "_self");
      } catch {}
    });

    doc.querySelectorAll("script[src], link[href], img[src], video[src], audio[src], source[src]").forEach(el => {
      const attr = el.tagName === "LINK" ? "href" : "src";
      const val = el.getAttribute(attr);
      if (val && !val.startsWith("data:")) {
        try {
          const newURL = new URL(val, target).href;
          el.setAttribute(attr, `/api/rewrite?url=${encodeURIComponent(newURL)}`);
        } catch {}
      }
    });

    doc.querySelectorAll("form[action]").forEach(f => {
      const action = f.getAttribute("action");
      if (!action || action.startsWith("javascript:")) return;
      try {
        const newAction = new URL(action, target).href;
        f.setAttribute("action", `/api/rewrite?url=${encodeURIComponent(newAction)}`);
      } catch {}
    });

    let base = doc.querySelector("base");
    if (!base) {
      base = doc.createElement("base");
      doc.head.prepend(base);
    }
    base.href = target;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Content-Type", "text/html; charset=utf-8");

    return res.send(dom.serialize());
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(502).send("Proxy rewrite error");
  }
}
