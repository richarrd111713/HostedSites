import fetch from "node-fetch";
import { JSDOM } from "jsdom";

export default async function handler(req, res) {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing ?url=");

  try {
    const upstream = await fetch(target, {
      headers: {
        "user-agent": req.headers["user-agent"] || "Mozilla/5.0 (ProxyBrowser)",
        accept: req.headers["accept"] || "*/*",
      },
    });

    // --- 1️⃣ Remove restrictive headers ---
    const headers = Object.fromEntries(upstream.headers.entries());
    delete headers["content-security-policy"];
    delete headers["x-frame-options"];
    delete headers["frame-ancestors"];

    const contentType = headers["content-type"] || "";

    // --- 2️⃣ Directly return non-HTML content (images, JS, CSS, etc.) ---
    if (!contentType.includes("text/html")) {
      res.setHeader("Content-Type", contentType);
      const buffer = await upstream.arrayBuffer();
      res.send(Buffer.from(buffer));
      return;
    }

    // --- 3️⃣ Parse and rewrite HTML ---
    const html = await upstream.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const proxyBase = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/api/rewrite?url=`;

    // Helper for rewriting absolute URLs
    const rewriteUrl = (url) => {
      if (!url) return url;
      if (url.startsWith("data:") || url.startsWith("blob:")) return url;
      const absolute = new URL(url, target).href;
      return proxyBase + encodeURIComponent(absolute);
    };

    // --- 4️⃣ Rewrite anchors (links) ---
    doc.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      a.href = rewriteUrl(href);
    });

    // --- 5️⃣ Rewrite src/href attributes of common elements ---
    doc.querySelectorAll("[src], [href]").forEach((el) => {
      const attr = el.hasAttribute("src") ? "src" : "href";
      const val = el.getAttribute(attr);
      if (!val || val.startsWith("#") || val.startsWith("javascript:")) return;
      el.setAttribute(attr, rewriteUrl(val));
    });

    // --- 6️⃣ Fix <base> ---
    const base = doc.createElement("base");
    base.href = target;
    doc.head.prepend(base);

    // --- 7️⃣ Inject JS to neutralize CSP + X-Frame runtime restrictions ---
    const bypassScript = doc.createElement("script");
    bypassScript.textContent = `
      // Disable frame-busting
      if (window.top !== window.self) {
        window.onbeforeunload = null;
        document.querySelectorAll('script').forEach(s => {
          if (s.innerText.includes('top.location')) s.remove();
        });
      }
      // Patch window.open to open inside proxy
      const _open = window.open;
      window.open = function(url, name, specs) {
        const newUrl = '${proxyBase}' + encodeURIComponent(new URL(url, '${target}').href);
        return _open(newUrl, name || '_blank', specs);
      };
      // Patch location changes
      const _assign = window.location.assign.bind(window.location);
      window.location.assign = (u) => _assign('${proxyBase}' + encodeURIComponent(new URL(u, '${target}').href));
    `;
    doc.body.appendChild(bypassScript);

    // --- 8️⃣ Return clean HTML ---
    res.setHeader("Content-Type", "text/html");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

    res.send(dom.serialize());
  } catch (err) {
    console.error("Rewrite error:", err);
    res.status(500).send("Rewrite error: " + err.message);
  }
}
