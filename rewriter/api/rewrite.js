import fetch from "node-fetch";
import { JSDOM } from "jsdom";

export default async function handler(req, res) {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing ?url=");

  try {
    const upstream = await fetch(target, {
      redirect: "manual", // handle redirects manually
      headers: { "user-agent": "Mozilla/5.0 (proxy)" },
    });

    // Handle redirects (302)
    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get("location");
      if (location) {
        const redirectUrl = new URL(location, target).href;
        return res.redirect(`/api/rewrite?url=${encodeURIComponent(redirectUrl)}`);
      }
    }

    const contentType = upstream.headers.get("content-type") || "";
    const buffer = await upstream.arrayBuffer();

    // Add CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");

    if (!contentType.includes("text/html")) {
      res.setHeader("Content-Type", contentType);
      res.send(Buffer.from(buffer));
      return;
    }

    // HTML rewriting (as before)
    const html = Buffer.from(buffer).toString("utf8");
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const base = doc.createElement("base");
    base.href = target;
    doc.head.prepend(base);

    // Rewrite anchors
    doc.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      a.setAttribute("href", `/api/rewrite?url=${encodeURIComponent(new URL(href, target).href)}`);
    });

    // Rewrite assets
    doc.querySelectorAll("img[src], script[src], link[href]").forEach(el => {
      const attr = el.src ? "src" : "href";
      const val = el[attr];
      if (!val || val.startsWith("data:")) return;
      el[attr] = `/api/rewrite?url=${encodeURIComponent(new URL(val, target).href)}`;
    });

    res.setHeader("Content-Type", "text/html");
    res.send(dom.serialize());
  } catch (err) {
    console.error(err);
    res.status(500).send("Rewrite error: " + err.message);
  }
}
