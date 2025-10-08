import fetch from "node-fetch";
import { JSDOM } from "jsdom";

export default async function handler(req, res) {
  const target = req.query.url;
  if (!target) {
    res.status(400).send("Missing ?url=");
    return;
  }

  try {
    // Fetch the target page server-side
    const upstream = await fetch(target, {
      headers: { "user-agent": "Mozilla/5.0 (proxy)" },
    });

    const contentType = upstream.headers.get("content-type") || "";

    // If the response is not HTML (image, JS, CSS), return it directly
    if (!contentType.includes("text/html")) {
      res.setHeader("Content-Type", contentType);
      const buffer = await upstream.arrayBuffer();
      res.send(Buffer.from(buffer));
      return;
    }

    // Parse HTML
    const html = await upstream.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const proxyEndpoint = "/api/rewrite?url=";

    // Rewrite all <a> tags to stay within the proxy
    doc.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href");
      if (!href.startsWith("#") && !href.startsWith("javascript:")) {
        const absoluteUrl = new URL(href, target).href;
        a.href = `${proxyEndpoint}${encodeURIComponent(absoluteUrl)}`;
        // Force new tab links to open proxied
        if (a.target === "_blank") {
          a.target = "_blank";
          a.rel = "noopener";
        }
      }
    });

    // Rewrite <img>, <script>, <link> and other src/href assets
    doc.querySelectorAll("img[src], script[src], link[href]").forEach(el => {
      const attr = el.src ? "src" : "href";
      const val = el[attr];
      if (val && !val.startsWith("data:")) {
        const absoluteUrl = new URL(val, target).href;
        el[attr] = `${proxyEndpoint}${encodeURIComponent(absoluteUrl)}`;
      }
    });

    // Rewrite inline styles with url(...) references
    doc.querySelectorAll("[style]").forEach(el => {
      el.style.cssText = el.style.cssText.replace(/url\(["']?(.*?)["']?\)/g, (match, p1) => {
        const absoluteUrl = new URL(p1, target).href;
        return `url(${proxyEndpoint}${encodeURIComponent(absoluteUrl)})`;
      });
    });

    // Add <base> tag to fix relative paths
    const base = doc.createElement("base");
    base.href = target;
    doc.head.prepend(base);

    // Set response headers
    res.setHeader("Content-Type", "text/html");
    res.send(dom.serialize());

  } catch (err) {
    console.error(err);
    res.status(500).send("Rewrite error");
  }
}
