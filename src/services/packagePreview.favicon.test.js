import test from "node:test";
import assert from "node:assert/strict";
import {
  injectPreviewFavicon,
  previewFaviconPathForPackage,
  previewFileForPackage,
  previewScreensForPackage,
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
