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
      redirect: "follow",
      headers: {
        "user-agent": req.headers["user-agent"] || "Mozilla/5.0 (proxy)",
        accept: req.headers["accept"] || "*/*",
      },
    });

    if (!upstream.ok) {
      res.status(upstream.status).send(`Upstream returned ${upstream.status}`);
      return;
    }

    const contentType = upstream.headers.get("content-type") || "";
    const buffer = await upstream.arrayBuffer();

    // For non-HTML (fonts, CSS, JS, images) — just stream it through.
    if (!contentType.includes("text/html")) {
      res.setHeader("Content-Type", contentType);
      if (upstream.headers.get("cache-control"))
        res.setHeader("Cache-Control", upstream.headers.get("cache-control"));
      if (upstream.headers.get("content-length"))
        res.setHeader("Content-Length", upstream.headers.get("content-length"));
      res.status(upstream.status);
      res.send(Buffer.from(buffer));
      return;
    }

    // --- HTML Rewriting ---
    const html = Buffer.from(buffer).toString("utf8");
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Fix <base> to resolve relative URLs
    const base = doc.createElement("base");
    base.href = target;
    doc.head.prepend(base);

    // Rewrite anchors
    doc.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      const abs = new URL(href, target).href;
      a.setAttribute("href", `/api/rewrite?url=${encodeURIComponent(abs)}`);
    });

    // Rewrite src/href in assets
    doc.querySelectorAll("img[src], script[src], link[href]").forEach(el => {
      const attr = el.src ? "src" : "href";
      const val = el[attr];
      if (!val || val.startsWith("data:")) return;
      const abs = new URL(val, target).href;
      el[attr] = `/api/rewrite?url=${encodeURIComponent(abs)}`;
    });

    res.setHeader("Content-Type", "text/html");
    res.send(dom.serialize());

  } catch (err) {
    console.error("Rewrite error:", err);
    res.status(500).send("Rewrite error: " + err.message);
  }
}
