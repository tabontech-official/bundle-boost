// Builds the storefront widget script (theme app extension asset) from its
// readable source. Shopify limits an app block's JavaScript to 10 KB, so the
// shipped asset is minified. Edit storefront/quantity-breaks.js, then run:
//   npm run build:widget
import { buildSync } from "esbuild";
import { statSync } from "node:fs";

const outfile = "extensions/bundleboost-widget/assets/quantity-breaks.js";
const LIMIT = 10_000;

buildSync({
  entryPoints: ["storefront/quantity-breaks.js"],
  outfile,
  minify: true,
  target: "es2017",
  legalComments: "none",
  banner: { js: "/* BundleBoost quantity breaks. Built from storefront/quantity-breaks.js; don't edit. */" },
});

const size = statSync(outfile).size;
if (size > LIMIT) {
  console.error(`[build-widget] ${outfile} is ${size} B, over Shopify's ${LIMIT} B app block limit.`);
  process.exit(1);
}
console.log(`[build-widget] ${outfile}: ${size} B`);
