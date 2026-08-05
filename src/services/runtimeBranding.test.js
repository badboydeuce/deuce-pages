import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeBrandingDataUrl,
  packageBrandingPath,
  runtimeBrandingLimits
} from "./runtimeBranding.js";

const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";

test("runtime branding accepts only validated raster data images", () => {
  const image = decodeBrandingDataUrl(tinyPng);
  assert.equal(image?.contentType, "image/png");
  assert.equal(image?.buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");

  assert.equal(decodeBrandingDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), null);
  assert.equal(decodeBrandingDataUrl("data:image/png;base64,ZmFrZQ=="), null);

  const oversized = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    Buffer.alloc(runtimeBrandingLimits.maxBytes)
  ]).toString("base64");
  assert.equal(decodeBrandingDataUrl(`data:image/png;base64,${oversized}`), null);
});

test("runtime branding selects declared logo assets and rejects unsafe paths", () => {
  assert.equal(packageBrandingPath({
    packageManifest: {
      thumbnailPath: "assets/marketplace.png",
      files: ["index.html", "assets/marketplace.png", "screens/home.png"]
    }
  }), "assets/marketplace.png");

  assert.equal(packageBrandingPath({
    packageManifest: {
      thumbnailPath: "../private/logo.png",
      files: ["index.html", "screens/home.png", "assets/logo.webp"]
    }
  }), "assets/logo.webp");

  assert.equal(packageBrandingPath({
    packageManifest: {
      thumbnailPath: "assets/logo.svg",
      files: ["index.html", "assets/logo.svg", "screens/home.png"]
    }
  }), "");
});
