import fetch from "node-fetch";
import { JSDOM } from "jsdom";

export default async function handler(req, res) {
  const target = req.query.url;
  if (!target) {
    res.status(400).send("Missing ?url=");
    return;
  }

  try {
    // Fetch the original page
    const upstream = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Proxy-Browser)"
      }
    });

    const contentType = upstream.headers.get("content-type") || "";

    // If it's not HTML (e.g., image, JS, CSS), just proxy directly
    if (!contentType.includes("text/html")) {
      const buffer = await upstream.arrayBuffer();
      res.setHeader("Content-Type", contentType);
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.send(Buffer.from(buffer));
    }

    // Parse HTML
    const html = await upstream.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Add CORS headers to make iframeable
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Content-Security-Policy", "frame-ancestors *");

    // Fix base for relative URLs
    const base = doc.querySelector("base") || doc.createElement("base");
    base.href = target;
    if (!doc.querySelector("base")) doc.head.prepend(base);

    // Rewrite <a> links to go through the proxy
    doc.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      const absoluteHref = new URL(href, target).href;
      a.href = `/api/rewrite?url=${encodeURIComponent(absoluteHref)}`;
    });

    // Rewrite assets: images, scripts, CSS, fonts, videos, iframes
    const selectors = "img[src], script[src], link[href], video[src], audio[src], source[src], iframe[src]";
    doc.querySelectorAll(selectors).forEach(el => {
      const attr = el.src ? "src" : "href";
      const val = el[attr];
      if (!val || val.startsWith("data:")) return;

      const absoluteURL = new URL(val, target).href;

      // Prevent rewriting our own proxy URLs (avoid 404)
      if (absoluteURL.startsWith("https://rewriter-roan.vercel.app/api/")) {
        el[attr] = absoluteURL;
      } else {
        el[attr] = `/api/rewrite?url=${encodeURIComponent(absoluteURL)}`;
      }
    });

    // Serialize and return the rewritten HTML
    res.setHeader("Content-Type", "text/html");
    res.send(dom.serialize());

  } catch (err) {
    console.error("Rewrite error:", err);
    res.status(500).send("Rewrite error");
  }
}
