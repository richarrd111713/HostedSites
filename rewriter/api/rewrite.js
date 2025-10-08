import fetch from "node-fetch";
import { JSDOM } from "jsdom";

export default async function handler(req, res) {
  const target = req.query.url;
  if (!target) {
    res.status(400).send("Missing ?url=");
    return;
  }

  try {
    const upstream = await fetch(target, {
      headers: { "user-agent": "Mozilla/5.0 (proxy)" },
    });

    const contentType = upstream.headers.get("content-type") || "";

    // If not HTML (e.g. image, JS, CSS), return it directly
    if (!contentType.includes("text/html")) {
      res.setHeader("Content-Type", contentType);
      const buffer = await upstream.arrayBuffer();
      res.send(Buffer.from(buffer));
      return;
    }

    // Parse and rewrite the HTML
    const html = await upstream.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Rewrite all links to stay in proxy
    doc.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href");
      if (!href.startsWith("#") && !href.startsWith("javascript:")) {
        const newHref = new URL(href, target).href;
        a.href = `/api/rewrite?url=${encodeURIComponent(newHref)}`;
      }
    });

    // Rewrite images, scripts, and CSS links
    doc.querySelectorAll("img[src], script[src], link[href]").forEach(el => {
      const attr = el.src ? "src" : "href";
      const val = el[attr];
      if (val && !val.startsWith("data:")) {
        const newURL = new URL(val, target).href;
        el[attr] = `/api/rewrite?url=${encodeURIComponent(newURL)}`;
      }
    });

    // Fix base tag
    const base = doc.createElement("base");
    base.href = target;
    doc.head.prepend(base);

    res.setHeader("Content-Type", "text/html");
    res.send(dom.serialize());

  } catch (err) {
    console.error(err);
    res.status(500).send("Rewrite error");
  }
}
