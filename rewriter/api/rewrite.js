import fetch from "node-fetch";
import { JSDOM } from "jsdom";

// Utility to rewrite URLs to go through our proxy
function rewriteUrl(originalUrl, proxyBase) {
  return `${proxyBase}?url=${encodeURIComponent(originalUrl)}`;
}

export default async function handler(req, res) {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing ?url=");

  const proxyBase = `${process.env.PROXY_BASE || "https://gltsclasstools.segundoazjustin633.workers.dev/api/proxy"}`;

  try {
    const upstream = await fetch(target, {
      headers: { "user-agent": "Mozilla/5.0 (proxy)" },
      redirect: "follow",
    });

    const contentType = upstream.headers.get("content-type") || "";

    // Pass non-HTML files directly
    if (!contentType.includes("text/html")) {
      const buffer = await upstream.arrayBuffer();
      res.setHeader("Content-Type", contentType);
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.send(Buffer.from(buffer));
    }

    // Parse HTML and rewrite
    const html = await upstream.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Remove CSP / X-Frame-Options
    res.removeHeader("content-security-policy");
    res.removeHeader("x-frame-options");

    // Rewrite <a> links
    doc.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href");
      if (!href.startsWith("#") && !href.startsWith("javascript:")) {
        a.href = rewriteUrl(new URL(href, target).href, proxyBase);
      }
    });

    // Rewrite assets: images, scripts, styles
    doc.querySelectorAll("img[src], script[src], link[href]").forEach(el => {
      const attr = el.src ? "src" : "href";
      const val = el[attr];
      if (val && !val.startsWith("data:")) {
        el[attr] = rewriteUrl(new URL(val, target).href, proxyBase);
      }
    });

    // Rewrite forms
    doc.querySelectorAll("form[action]").forEach(form => {
      const action = form.getAttribute("action");
      if (action && !action.startsWith("#")) {
        form.action = rewriteUrl(new URL(action, target).href, proxyBase);
      }
    });

    // Rewrite base tag to avoid relative issues
    const base = doc.createElement("base");
    base.href = target;
    doc.head.prepend(base);

    res.setHeader("Content-Type", "text/html");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(dom.serialize());

  } catch (err) {
    console.error("Rewrite error:", err);
    res.status(500).send("Proxy error");
  }
}
