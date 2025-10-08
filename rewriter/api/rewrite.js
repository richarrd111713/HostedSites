import fetch from "node-fetch";
import { JSDOM } from "jsdom";

export default async function handler(req, res) {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing ?url=");

  try {
    const upstream = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0 (ProxyBrowser)" },
      redirect: "follow",
    });

    const contentType = upstream.headers.get("content-type") || "";

    // If not HTML, return raw
    if (!contentType.includes("text/html")) {
      const buffer = await upstream.arrayBuffer();
      res.setHeader("Content-Type", contentType);
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.send(Buffer.from(buffer));
    }

    // HTML rewriting
    const html = await upstream.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Rewrite all links to go through proxy
    doc.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href");
      if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
        const newHref = new URL(href, target).href;
        a.href = `/api/rewrite?url=${encodeURIComponent(newHref)}`;
        a.target = "_self"; // stay in same iframe
      }
    });

    // Rewrite resources (images, scripts, css, fonts)
    doc.querySelectorAll("img[src], script[src], link[href]").forEach(el => {
      const attr = el.src ? "src" : "href";
      const val = el[attr];
      if (val && !val.startsWith("data:")) {
        el[attr] = `/api/rewrite?url=${encodeURIComponent(new URL(val, target).href)}`;
      }
    });

    // Inject headers to allow iframe embedding
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader(
      "Content-Security-Policy",
      "default-src * 'unsafe-inline' 'unsafe-eval'; frame-ancestors *"
    );
    res.setHeader("Access-Control-Allow-Origin", "*");

    // Fix base tag
    const base = doc.createElement("base");
    base.href = target;
    doc.head.prepend(base);

    res.setHeader("Content-Type", "text/html");
    res.send(dom.serialize());
  } catch (err) {
    console.error(err);
    res.status(500).send("Rewrite error: " + err.message);
  }
}
