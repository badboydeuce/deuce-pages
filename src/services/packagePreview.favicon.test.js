import test from "node:test";
import assert from "node:assert/strict";
import {
  injectPreviewFavicon,
  injectPreviewJourney,
  previewFaviconPathForPackage,
  previewFileForPackage,
  previewScreensForPackage,
  resolveRelativePath,
  rewriteCssAssetUrls,
  rewritePreviewAssets
} from "./packagePreview.js";

test("preview favicon detection supports imported SVG logos", () => {
  const pagePackage = {
    packageManifest: {
      files: [{ path: "index.html" }, { path: "assets/site-logo.svg" }]
    }
  };
  assert.equal(previewFaviconPathForPackage(pagePackage), "assets/site-logo.svg");
  assert.match(
    injectPreviewFavicon("<html><head><title>Page</title></head></html>", { basePath: "", pagePackage }),
    /<link rel="icon" href="\/p\/asset\?file=assets%2Fsite-logo\.svg">/
  );
});

test("preview keeps an existing favicon declaration", () => {
  const html = '<html><head><link rel="icon" href="/favicon.ico"></head></html>';
  assert.equal(injectPreviewFavicon(html, { pagePackage: {} }), html);
});

test("root-relative preview assets resolve from the package root", () => {
  assert.equal(resolveRelativePath("pages/login.html", "/favicon.svg"), "favicon.svg");
});

test("preview journey starts at entry and still includes every enabled screen", () => {
  const pagePackage = {
    id: "pkg_complete_journey",
    packageManifest: {
      entryScreenId: "scr_entry",
      screens: [
        { id: "scr_one", file: "page1.html", order: 0, enabled: true },
        { id: "scr_two", file: "page2.html", order: 1, enabled: true },
        { id: "scr_three", file: "page3.html", order: 2, enabled: true },
        { id: "scr_four", file: "page4.html", order: 3, enabled: true },
        { id: "scr_entry", file: "index.html", order: 4, enabled: true },
        { id: "scr_six", file: "page6.html", order: 5, enabled: true }
      ]
    }
  };

  assert.equal(previewFileForPackage(pagePackage), "index.html");
  assert.deepEqual(
    previewScreensForPackage(pagePackage).map((screen) => screen.file),
    ["index.html", "page1.html", "page2.html", "page3.html", "page4.html", "page6.html"]
  );
});

test("preview preserves SVG symbol fragments", () => {
  const html = '<svg><use href="assets/symbols.svg#brand-logo"></use></svg>';
  assert.equal(
    rewritePreviewAssets(html, { file: "index.html" }),
    '<svg><use href="/p/asset?file=assets%2Fsymbols.svg#brand-logo"></use></svg>'
  );
});

test("CSS sprite and font URLs are routed through protected package assets", () => {
  const css = `
    .brand { background-image: url('../images/sprites.png?v=2#brand'); background-position: -32px 0; }
    @font-face { src: url("../fonts/icons.woff2?#iefix") format("woff2"); }
    @import "theme/mobile.css";
    .remote { background: url(https://cdn.example/logo.svg); }
  `;
  const rewritten = rewriteCssAssetUrls(css, {
    file: "styles/main.css",
    assetUrlFor: (file) => `/p/asset?${new URLSearchParams({ file }).toString()}`
  });
  assert.match(rewritten, /url\('\/p\/asset\?file=images%2Fsprites\.png#brand'\)/);
  assert.match(rewritten, /url\("\/p\/asset\?file=fonts%2Ficons\.woff2#iefix"\)/);
  assert.match(rewritten, /@import "\/p\/asset\?file=styles%2Ftheme%2Fmobile\.css"/);
  assert.match(rewritten, /url\(https:\/\/cdn\.example\/logo\.svg\)/);
  assert.match(rewritten, /background-position: -32px 0/);
});

test("preview yields intermediate Continue submissions to multi-step page scripts", () => {
  const html = injectPreviewJourney("<html><body><form></form></body></html>", {
    file: "index.html",
    screens: [{ file: "index.html", name: "Login" }]
  });
  assert.match(html, /function shouldYieldToProgressiveStep\(form, control\)/);
  assert.match(html, /hiddenPassword \|\| visibleIdentity/);
  assert.match(html, /if \(event\.target === progressiveSubmitForm\)/);
  assert.match(html, /if \(shouldYieldToProgressiveStep\(event\.target, event\.submitter\)\) return/);
});

test("preview supports configured email handoff without submitting a result", () => {
  const html = injectPreviewJourney('<html><body><input data-deuce-field-id="fld_destination"></body></html>', {
    file: "destination.html",
    screens: [{ file: "destination.html", name: "Destination" }],
    emailHandoff: {
      enabled: true,
      sourceFieldId: "fld_source",
      destinationFieldId: "fld_destination",
      clearOnFinalScreen: true
    },
    isFinalScreen: true
  });
  assert.match(html, /deuce_preview_email_handoff/);
  assert.match(html, /function rememberHandoffEmail\(\)/);
  assert.match(html, /function applyHandoffEmail\(\)/);
  assert.match(html, /\["input", "change", "keyup"\]/);
  assert.doesNotMatch(html, /\/results/);
});
