import fetch from "node-fetch";
import { JSDOM } from "jsdom";

export default async function handler(req, res) {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    res.status(400).send("Missing ?url=");
    return;
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "accept": "*/*",
      },
      redirect: "follow",
    });

    const contentType = upstream.headers.get("content-type") || "";

    // Serve non-HTML directly
    if (!contentType.includes("text/html")) {
      const buffer = await upstream.arrayBuffer();
      res.setHeader("Content-Type", contentType);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.send(Buffer.from(buffer));
      return;
    }

    // Parse and rewrite HTML
    const html = await upstream.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Rewrite <a> links
    doc.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href");
      if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
        const fullUrl = new URL(href, targetUrl).href;
        a.href = `/api/rewrite?url=${encodeURIComponent(fullUrl)}`;
      }
    });

    // Rewrite images, scripts, CSS, fonts
    doc.querySelectorAll("img[src], script[src], link[href], video[src], audio[src], source[src], iframe[src]").forEach(el => {
      const attr = el.src ? "src" : "href";
      const val = el[attr];
      if (val && !val.startsWith("data:")) {
        const fullUrl = new URL(val, targetUrl).href;
        el[attr] = `/api/rewrite?url=${encodeURIComponent(fullUrl)}`;
      }
    });

    // Prepend <base> tag
    const base = doc.createElement("base");
    base.href = targetUrl;
    doc.head.prepend(base);

    res.setHeader("Content-Type", "text/html");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(dom.serialize());
  } catch (err) {
    console.error(err);
    res.status(500).send("Rewrite error");
  }
}
