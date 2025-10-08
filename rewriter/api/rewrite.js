import fetch from "node-fetch";
import { JSDOM } from "jsdom";

export default async function handler(req, res) {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing ?url=");

  try {
    const upstream = await fetch(target, {
      headers: { "user-agent": "Mozilla/5.0 (proxy)" },
      redirect: "manual", // Handle redirects ourselves
    });

    // Handle redirects (3xx)
    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get("location");
      if (location) {
        const redirectUrl = new URL(location, target).href;
        return res.redirect(`/api/rewrite?url=${encodeURIComponent(redirectUrl)}`);
      }
    }

    const contentType = upstream.headers.get("content-type") || "";

    // Non-HTML resources: pass through
    if (!contentType.includes("text/html")) {
      const buffer = await upstream.arrayBuffer();
      res.setHeader("Content-Type", contentType);
      res.setHeader("Access-Control-Allow-Origin", "*"); // Fix CORS
      return res.send(Buffer.from(buffer));
    }

    // Parse HTML
    const html = await upstream.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const proxyBase = "/api/rewrite?url=";

    // Rewrite links
    doc.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href.startsWith("#") && !href.startsWith("javascript:")) {
        const newHref = new URL(href, target).href;
        a.href = `${proxyBase}${encodeURIComponent(newHref)}`;
        a.target = "_self"; // Ensure navigation stays in proxy
      }
    });

    // Rewrite scripts, CSS, images, fonts, media
    doc.querySelectorAll(
      "script[src], link[href], img[src], video[src], audio[src], source[src], iframe[src]"
    ).forEach((el) => {
      const attr = el.tagName === "LINK" ? "href" : "src";
      const val = el[attr];
      if (val && !val.startsWith("data:") && !val.startsWith("javascript:")) {
        const newUrl = new URL(val, target).href;
        el[attr] = `${proxyBase}${encodeURIComponent(newUrl)}`;
      }
    });

    // Fix <base> tag
    const base = doc.createElement("base");
    base.href = target;
    doc.head.prepend(base);

    // Inject CORS headers
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(dom.serialize());
  } catch (err) {
    console.error(err);
    res.status(500).send("Rewrite error");
  }
}
