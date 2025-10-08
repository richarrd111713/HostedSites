import fetch from "node-fetch";
import { JSDOM } from "jsdom";

export default async function handler(req, res) {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing ?url=");

  try {
    // Fetch the original content
    const upstream = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0 (proxy)" },
      redirect: "follow", // follow redirects to avoid 400 issues
    });

    const contentType = upstream.headers.get("content-type") || "";

    // Non-HTML resources are sent directly with proper headers
    if (!contentType.includes("text/html")) {
      const buffer = await upstream.arrayBuffer();
      res.setHeader("Content-Type", contentType);
      res.setHeader("Access-Control-Allow-Origin", "*"); // CORS fix
      res.setHeader("X-Frame-Options", "ALLOWALL"); // iframe fix
      return res.send(Buffer.from(buffer));
    }

    // HTML content: parse and rewrite
    const html = await upstream.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Rewrite all <a> links to go through the proxy
    doc.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href");
      if (!href.startsWith("#") && !href.startsWith("javascript:")) {
        try {
          const newHref = new URL(href, target).href;
          a.href = `/api/rewrite?url=${encodeURIComponent(newHref)}`;
          a.setAttribute("target", "_self"); // stay in proxy
        } catch {}
      }
    });

    // Rewrite all assets (script, link, img, video, audio)
    doc.querySelectorAll("script[src], link[href], img[src], video[src], audio[src]").forEach(el => {
      const attr = el.tagName === "LINK" ? "href" : "src";
      const val = el.getAttribute(attr);
      if (val && !val.startsWith("data:")) {
        try {
          const newURL = new URL(val, target).href;
          el.setAttribute(attr, `/api/rewrite?url=${encodeURIComponent(newURL)}`);
        } catch {}
      }
    });

    // Rewrite <form> actions to proxy
    doc.querySelectorAll("form[action]").forEach(f => {
      const action = f.getAttribute("action");
      if (action && !action.startsWith("javascript:")) {
        try {
          const newAction = new URL(action, target).href;
          f.setAttribute("action", `/api/rewrite?url=${encodeURIComponent(newAction)}`);
        } catch {}
      }
    });

    // Add base tag to help relative URLs
    let base = doc.querySelector("base");
    if (!base) {
      base = doc.createElement("base");
      doc.head.prepend(base);
    }
    base.href = target;

    // Add headers to fix CORS and iframe issues
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Content-Type", "text/html");

    // Return the rewritten HTML
    res.send(dom.serialize());
  } catch (err) {
    console.error(err);
    res.status(500).send("Proxy rewrite error");
  }
}
