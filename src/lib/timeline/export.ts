// Export helpers for the timeline chart: a standalone SVG with every colour
// and font baked in, a PNG rasterised from it, and a one-page PDF through the
// browser's print dialog. No library: the chart is plain SVG, and the browser
// already knows how to shape Arabic, embed fonts and write a PDF.

const STYLE_PROPS = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline", "letter-spacing", "text-transform", "direction"];

let hexCtx: CanvasRenderingContext2D | null = null;
/** Normalise any CSS colour (oklch, rgb, names) to what a canvas accepts: hex or rgba(). */
function toHex(color: string) {
  if (!hexCtx) hexCtx = document.createElement("canvas").getContext("2d");
  if (!hexCtx) return color;
  hexCtx.fillStyle = "#000";
  hexCtx.fillStyle = color;
  return hexCtx.fillStyle;
}

const fontCache = new Map<string, Promise<string>>();

/** @font-face rules for a family, with the font files inlined as data URIs. */
export function inlineFontCss(family: string): Promise<string> {
  const key = family.toLowerCase();
  const cached = fontCache.get(key);
  if (cached) return cached;
  const p = (async () => {
    let css = "";
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const fam = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim().toLowerCase();
        if (fam !== key) continue;
        const src = rule.style.getPropertyValue("src");
        const url = /url\(["']?([^"')]+)["']?\)/.exec(src)?.[1];
        if (!url) continue;
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const buf = new Uint8Array(await res.arrayBuffer());
          let bin = "";
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          const mime = url.endsWith(".woff2") ? "font/woff2" : url.endsWith(".woff") ? "font/woff" : "font/ttf";
          css += rule.cssText.replace(/url\([^)]+\)/, `url(data:${mime};base64,${btoa(bin)})`) + "\n";
        } catch {
          /* leave the fallback font */
        }
      }
    }
    return css;
  })();
  fontCache.set(key, p);
  return p;
}

export type ExportTheme = "light" | "dark";

/**
 * A standalone copy of the chart: computed colours written as attributes,
 * fonts embedded, sized explicitly, in the paper palette unless asked for dark.
 */
export async function standaloneSvg(src: SVGSVGElement, theme: ExportTheme = "light"): Promise<SVGSVGElement> {
  const clone = src.cloneNode(true) as SVGSVGElement;
  // Resolve styles inside a scope that forces the palette: `.light` and `.dark`
  // both redefine the --viz-* roles, so the clone's computed values follow it.
  const host = document.createElement("div");
  host.className = theme;
  host.style.cssText = "position:fixed;left:-100000px;top:0;width:0;height:0;overflow:hidden;";
  host.appendChild(clone);
  document.body.appendChild(host);
  try {
    const all = [clone, ...Array.from(clone.querySelectorAll<SVGElement>("*"))];
    for (const el of all) {
      if (el.tagName === "title") continue;
      const cs = getComputedStyle(el);
      for (const prop of STYLE_PROPS) {
        let v = cs.getPropertyValue(prop);
        if (!v) continue;
        if ((prop === "fill" || prop === "stroke") && v !== "none") v = toHex(v);
        el.setAttribute(prop, v);
      }
      el.removeAttribute("class");
      el.removeAttribute("style");
      el.removeAttribute("tabindex");
      el.removeAttribute("role");
    }
    const width = Number(src.getAttribute("width")) || src.getBoundingClientRect().width;
    const height = Number(src.getAttribute("height")) || src.getBoundingClientRect().height;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(Math.round(width)));
    clone.setAttribute("height", String(Math.round(height)));
    clone.setAttribute("viewBox", `0 0 ${Math.round(width)} ${Math.round(height)}`);
    clone.setAttribute("direction", "ltr");
    const family = getComputedStyle(src).fontFamily.split(",")[0].replace(/["']/g, "").trim();
    const css = family ? await inlineFontCss(family) : "";
    if (css) {
      const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
      style.textContent = css;
      clone.prepend(style);
    }
  } finally {
    host.remove();
  }
  return clone;
}

export function svgMarkup(svg: SVGSVGElement) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
}

export function svgBlob(svg: SVGSVGElement) {
  return new Blob([svgMarkup(svg)], { type: "image/svg+xml;charset=utf-8" });
}

/** Rasterise a standalone SVG at `scale` device pixels per CSS pixel. */
export async function pngBlob(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const w = Number(svg.getAttribute("width"));
  const h = Number(svg.getAttribute("height"));
  // Safari caps canvas area around 16.7 Mpx.
  const s = Math.min(scale, Math.sqrt(16_000_000 / Math.max(1, w * h)));
  const url = URL.createObjectURL(svgBlob(svg));
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error("Could not render the chart"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * s);
    canvas.height = Math.round(h * s);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    const bg = svg.querySelector("rect")?.getAttribute("fill") || "#ffffff";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Could not encode PNG"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFilename(title: string) {
  const base = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return base || "timeline";
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

export interface PrintSection {
  heading: string;
  rows: { date: string; title: string; meta?: string }[];
}

/**
 * Print a one-page handout: title, the chart, then the story as columns.
 * Uses a hidden iframe so no popup is involved; the person picks "Save as PDF".
 */
export async function printTimeline(svg: SVGSVGElement, opts: { title: string; description?: string; sections: PrintSection[]; footer?: string; dir?: "ltr" | "rtl"; lang?: string }) {
  const family = getComputedStyle(document.body).fontFamily.split(",")[0].replace(/["']/g, "").trim();
  const fontCss = family ? await inlineFontCss(family) : "";
  const cols = opts.sections
    .filter((s) => s.rows.length)
    .map(
      (s) => `<section><h2>${esc(s.heading)}</h2><ul>${s.rows
        .map((r) => `<li><span class="d">${esc(r.date)}</span><span class="t">${esc(r.title)}${r.meta ? `<span class="m">${esc(r.meta)}</span>` : ""}</span></li>`)
        .join("")}</ul></section>`,
    )
    .join("");
  const html = `<!doctype html><html lang="${opts.lang ?? "en"}" dir="${opts.dir ?? "ltr"}"><head><meta charset="utf-8"><title>${esc(opts.title)}</title>
<style>
${fontCss}
@page { size: A4 landscape; margin: 12mm; }
html { color-scheme: light; }
body { margin: 0; font-family: ${family ? `"${family}", ` : ""}ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Arabic", sans-serif; color: #1f1f1d; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: -0.01em; }
p.desc { margin: 0 0 10px; color: #6b6a65; font-size: 12px; }
.chart { border: 1px solid #e1e0d9; border-radius: 8px; overflow: hidden; break-inside: avoid; }
.chart svg { display: block; width: 100%; height: auto; direction: ltr; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px 22px; margin-top: 14px; }
h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #6b6a65; margin: 0 0 6px; }
ul { list-style: none; margin: 0; padding: 0; font-size: 11.5px; }
li { display: flex; gap: 10px; padding: 3px 0; border-top: 1px solid #ecebe6; break-inside: avoid; }
.d { flex: 0 0 auto; width: 92px; color: #6b6a65; font-variant-numeric: tabular-nums; }
.t { flex: 1 1 auto; }
.m { display: block; color: #6b6a65; font-size: 10.5px; }
footer { margin-top: 12px; font-size: 10px; color: #8a8982; }
</style></head><body>
<h1>${esc(opts.title)}</h1>
${opts.description ? `<p class="desc">${esc(opts.description)}</p>` : ""}
<div class="chart">${svgMarkup(svg).replace(/^<\?xml[^>]*>\n?/, "")}</div>
<div class="cols">${cols}</div>
${opts.footer ? `<footer>${esc(opts.footer)}</footer>` : ""}
</body></html>`;

  await new Promise<void>((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setTimeout(() => frame.remove(), 500);
      resolve();
    };
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) return finish();
      const go = () => {
        win.addEventListener("afterprint", finish, { once: true });
        win.focus();
        win.print();
        // Safari does not always fire afterprint; tidy up eventually.
        setTimeout(finish, 60_000);
      };
      if ("fonts" in win.document) void (win.document as Document).fonts.ready.then(go, go);
      else go();
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
