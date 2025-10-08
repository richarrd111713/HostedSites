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
      redirect: "follow"
    });

    const contentType = upstream.headers.get("content-type") || "";

    // Copy all headers except some that break
    upstream.headers.forEach((value, key) => {
      if (!["content-length", "access-control-allow-origin"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    // Always set CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");

    // If it's not HTML, stream directly
    if (!contentType.includes("text/html")) {
      const buffer = await upstream.arrayBuffer();
      res.setHeader("Content-Type", contentType);
      res.send(Buffer.from(buffer));
      return;
    }

    // Parse and rewrite HTML
    const html = await upstream.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Rewrite all links to go through proxy
    doc.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href");
      if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
        const newHref = new URL(href, target).href;
        a.href = `/api/rewrite?url=${encodeURIComponent(newHref)}`;
      }
    });

    // Rewrite images, scripts, CSS, fonts, and other linked assets
    doc.querySelectorAll("img[src], script[src], link[href], source[src], video[src], audio[src]").forEach(el => {
      const attr = el.src ? "src" : "href";
      const val = el[attr];
      if (val && !val.startsWith("data:")) {
        const absolute = new URL(val, target).href;
        el[attr] = `/api/rewrite?url=${encodeURIComponent(absolute)}`;
      }
    });

    // Rewrite inline CSS URLs
    doc.querySelectorAll("style").forEach(style => {
      style.innerHTML = style.innerHTML.replace(
        /url\((['"]?)(.*?)\1\)/g,
        (match, q, url) => {
          if (!url.startsWith("data:")) {
            const absolute = new URL(url, target).href;
            return `url('${`/api/rewrite?url=${encodeURIComponent(absolute)}`}')`;
          }
          return match;
        }
      );
    });

    // Rewrite base tag
    const base = doc.createElement("base");
    base.href = target;
    doc.head.prepend(base);

    // Send rewritten HTML
    res.setHeader("Content-Type", "text/html");
    res.send(dom.serialize());

  } catch (err) {
    console.error(err);
    res.status(500).send("Rewrite error");
  }
}
