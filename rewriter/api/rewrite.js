// api/rewrite.js
import fetch from "node-fetch";
import { JSDOM } from "jsdom";

export default async function handler(req, res) {
  const target = req.query.url;
  if (!target) {
    res.status(400).send("Missing ?url=");
    return;
  }

  try {
    // Fetch the target page
    const upstream = await fetch(target, {
      headers: { "user-agent": "Mozilla/5.0 (proxy)" },
      redirect: "follow",
    });

    const contentType = upstream.headers.get("content-type") || "";

    // Non-HTML (fonts, JS, CSS, images, etc.)
    if (!contentType.includes("text/html")) {
      const buffer = await upstream.arrayBuffer();

      // Set proper content type
      res.setHeader("Content-Type", contentType);

      // Set CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");

      res.send(Buffer.from(buffer));
      return;
    }

    // HTML page
    const html = await upstream.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Rewrite all links (<a>) to stay in proxy
    doc.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href");
      if (!href.startsWith("#") && !href.startsWith("javascript:")) {
        const newHref = new URL(href, target).href;
        a.href = `/api/rewrite?url=${encodeURIComponent(newHref)}`;
      }
    });

    // Rewrite assets (images, scripts, CSS, fonts, videos, iframes)
    doc.querySelectorAll(
      "img[src], script[src], link[href], video[src], audio[src], source[src], iframe[src]"
    ).forEach(el => {
      const attr = el.src ? "src" : "href";
      const val = el[attr];
      if (val && !val.startsWith("data:")) {
        const newURL = new URL(val, target).href;
        el[attr] = `/api/rewrite?url=${encodeURIComponent(newURL)}`;
      }
    });

    // Inject a <base> to keep relative URLs working
    const base = doc.createElement("base");
    base.href = `/api/rewrite?url=${encodeURIComponent(target)}`;
    doc.head.prepend(base);

    // Add CORS headers for HTML too
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");

    res.send(dom.serialize());
  } catch (err) {
    console.error(err);
    res.status(500).send("Rewrite error");
  }
}
