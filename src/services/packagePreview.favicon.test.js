import test from "node:test";
import assert from "node:assert/strict";
import {
  injectPreviewFavicon,
  previewFaviconPathForPackage,
  resolveRelativePath
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
