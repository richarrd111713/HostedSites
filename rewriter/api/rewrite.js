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

export default async function handler(req, res) {
  // Allow OPTIONS preflight for browser requests (fonts, scripts often trigger CORS preflight)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  const target = req.query.url;
  if (!target) return res.status(400).send("Missing ?url=");

  // Basic validation to reduce SSRF risk
  if (!/^https?:\/\//i.test(target)) return res.status(400).send("Invalid URL");

  try {
    const upstream = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0 (proxy)" },
      redirect: "follow",
    });

    const contentType = upstream.headers.get("content-type") || "";

    // Forward status for non-HTML resources and include CORS header so browser can use them
    if (!contentType.includes("text/html")) {
      const buffer = await upstream.arrayBuffer();

      // Forward useful headers from upstream, excluding hop-by-hop
      upstream.headers.forEach((value, name) => {
        if (!HOP_BY_HOP.includes(name.toLowerCase())) {
          // Don't overwrite our CORS header
          if (name.toLowerCase() === "access-control-allow-origin") return;
          res.setHeader(name, value);
        }
      });

      // Ensure CORS and frame headers so fonts/scripts are loadable in browser contexts
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("X-Frame-Options", "ALLOWALL");
      // Avoid Vercel/Express double-encoding issues by setting Content-Type explicitly
      if (contentType) res.setHeader("Content-Type", contentType);

      // Set status code from upstream
      res.status(upstream.status);
      return res.send(Buffer.from(buffer));
    }

    // HTML: parse and rewrite links/assets/forms
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
