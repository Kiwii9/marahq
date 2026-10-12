// Downloads the REAL design images from Figma into public/assets/.
// Run it on your own computer:   npm run images
// (Figma links last about 7 days. If you see 403/404, the links expired - ask for fresh ones.)
const fs = require("fs");
const path = require("path");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "assets-manifest.json"), "utf8"));
const outDir = path.join(__dirname, "public", "assets");
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  let ok = 0, bad = [];
  for (const [file, url] of Object.entries(manifest)) {
    if (file.startsWith("_")) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      fs.writeFileSync(path.join(outDir, file), Buffer.from(await res.arrayBuffer()));
      ok++; console.log("OK  ", file);
    } catch (e) { bad.push(file); console.log("FAIL", file, "-", e.message); }
  }
  console.log(`\n${ok} downloaded, ${bad.length} failed.` + (bad.length ? " (the placeholder is kept for failed files)" : " Refresh the page!"));
})();
