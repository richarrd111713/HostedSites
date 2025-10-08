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

    // If not HTML (CSS, JS, images, fonts), return directly
    if (!contentType.includes("text/html")) {
      const buffer = await upstream.arrayBuffer();
      res.setHeader("Content-Type", contentType);
      // Make assets CORS friendly
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.send(Buffer.from(buffer));
      return;
    }

    // Parse HTML
    const html = await upstream.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Rewrite all links to stay in proxy
    doc.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href.startsWith("#") && !href.startsWith("javascript:")) {
        const newHref = new URL(href, target).href;
        a.href = `/api/rewrite?url=${encodeURIComponent(newHref)}`;
      }
    });

    // Rewrite scripts, images, and CSS
    doc.querySelectorAll("img[src], script[src], link[href]").forEach((el) => {
      const attr = el.src ? "src" : "href";
      const val = el[attr];
      if (val && !val.startsWith("data:")) {
        const newURL = new URL(val, target).href;
        el[attr] = `/api/rewrite?url=${encodeURIComponent(newURL)}`;
      }
    });

    // Inject base tag so relative paths work
    const base = doc.createElement("base");
    base.href = target;
    doc.head.prepend(base);

    // Force iframeable headers
    res.setHeader("Content-Type", "text/html");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader(
      "Content-Security-Policy",
      "default-src * 'unsafe-inline' 'unsafe-eval'; frame-ancestors *"
    );
    res.setHeader("Access-Control-Allow-Origin", "*");

    res.send(dom.serialize());
  } catch (err) {
    console.error(err);
    res.status(500).send("Rewrite error");
  }
}
