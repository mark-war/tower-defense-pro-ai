/**
 * Removes wave/enemy/render blocks from GameEngine.js (run once after extract).
 */
import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = join(root, "src/GameEngine.js");
let lines = fs.readFileSync(p, "utf8").split("\n");

// Inclusive 0-based [start, end] line indices to delete; process high → low
const ranges = [
  [2856, 3504],
  [1556, 2599],
  [1499, 1550],
  [1382, 1489],
  [744, 1340],
  [732, 742],
  [552, 730],
  [302, 551],
].sort((a, b) => b[0] - a[0]);

for (const [s, e] of ranges) {
  const n = e - s + 1;
  console.log("splice", s + 1, e + 1, "count", n);
  lines.splice(s, n);
}

fs.writeFileSync(p, lines.join("\n"));
console.log("Stripped GameEngine.js, new lines:", lines.length);
