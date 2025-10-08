import fetch from "node-fetch";
import { JSDOM } from "jsdom";

export default async function handler(req, res) {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing ?url=");

  try {
    const upstream = await fetch(target, { headers: { "user-agent": "Mozilla/5.0 (proxy)" } });
    const contentType = upstream.headers.get("content-type") || "";

    if (!contentType.includes("text/html")) {
      res.setHeader("Content-Type", contentType);
      const buffer = await upstream.arrayBuffer();
      return res.send(Buffer.from(buffer));
    }

    const html = await upstream.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Rewrite all links
    doc.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href");
      if (!href.startsWith("#") && !href.startsWith("javascript:")) {
        const absolute = new URL(href, target).href;
        a.href = `/api/rewrite?url=${encodeURIComponent(absolute)}`;
        a.setAttribute("target", "_self"); // stay inside the proxy
      }
    });

    // Rewrite images, scripts, styles
    doc.querySelectorAll("img[src], script[src], link[href]").forEach(el => {
      const attr = el.src ? "src" : "href";
      const val = el[attr];
      if (val && !val.startsWith("data:")) {
        const absolute = new URL(val, target).href;
        el[attr] = `/api/rewrite?url=${encodeURIComponent(absolute)}`;
      }
    });

    // Inject client-side fetch/XHR interceptor
    const interceptor = doc.createElement("script");
    interceptor.textContent = `
      const originalFetch = window.fetch;
      window.fetch = function(url, ...args) {
        if (typeof url === "string" && !url.startsWith("/api/rewrite")) {
          url = "/api/rewrite?url=" + encodeURIComponent(new URL(url, window.location.href).href);
        }
        return originalFetch(url, ...args);
      };
      const originalXHROpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        if (!url.startsWith("/api/rewrite")) url = "/api/rewrite?url=" + encodeURIComponent(new URL(url, window.location.href).href);
        return originalXHROpen.call(this, method, url, ...rest);
      };
    `;
    doc.head.appendChild(interceptor);

    res.setHeader("Content-Type", "text/html");
    res.send(dom.serialize());
  } catch (err) {
    console.error(err);
    res.status(500).send("Rewrite error");
  }
}
