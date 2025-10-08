import fetch from "node-fetch";
import { JSDOM } from "jsdom";

export default async function handler(req, res) {
  const target = req.query.url;
  if (!target) {
    res.status(400).send("Missing ?url=");
    return;
  }

  try {
    // Use fetch with proper headers and follow redirects
    const upstream = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (proxy)",
        "Accept": "*/*",
        "Referer": target,
        "Origin": target
      },
      redirect: "follow"
    });

    const contentType = upstream.headers.get("content-type") || "";

    // If not HTML (images, CSS, fonts, JS, etc.) just stream it back
    if (!contentType.includes("text/html")) {
      // Copy headers from upstream
      upstream.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      const buffer = await upstream.arrayBuffer();
      res.status(200).send(Buffer.from(buffer));
      return;
    }

    // --- HTML processing ---
    const html = await upstream.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Rewrite all <a> links to go through proxy
    doc.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href");
      if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
        const newHref = new URL(href, target).href;
        a.href = `/api/rewrite?url=${encodeURIComponent(newHref)}`;
      }
    });

    // Rewrite scripts, CSS, images, fonts
    doc.querySelectorAll("img[src], script[src], link[href]").forEach(el => {
      const attr = el.src ? "src" : "href";
      const val = el[attr];
      if (val && !val.startsWith("data:")) {
        const absolute = new URL(val, target).href;
        el[attr] = `/api/rewrite?url=${encodeURIComponent(absolute)}`;
      }
    });

    // Inject base tag to keep relative URLs working
    const base = doc.createElement("base");
    base.href = target;
    if (doc.head) doc.head.prepend(base);

    // Return rewritten HTML
    res.setHeader("Content-Type", "text/html");
    res.status(200).send(dom.serialize());

  } catch (err) {
    console.error("Rewrite error:", err);
    res.status(500).send("Rewrite error");
  }
}
