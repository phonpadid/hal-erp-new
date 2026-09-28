/**
 * Fail the build when a bundled asset did not reach dist.
 *
 * The PDF renderer reads its font from dist/assets/fonts at request time. A build that compiled the
 * code but not the font deploys cleanly, restarts, and then answers every PDF export with a 500 —
 * which is what happened in production on 2026-09-28, when `watchAssets` in nest-cli.json made even
 * a one-off `nest build` copy assets through a file watcher that was closed on a 500ms timer, and on
 * the loaded host it closed before copying the new font. Checked here, the deploy stops before
 * `pm2 restart` and the running API keeps the build it had.
 *
 * Every *.ttf and OFL.txt under src/assets/fonts must be in dist/assets/fonts, byte-for-byte in size.
 */
const { existsSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

const src = join(__dirname, '..', 'src', 'assets', 'fonts');
const dist = join(__dirname, '..', 'dist', 'assets', 'fonts');
const wanted = readdirSync(src).filter((f) => f.endsWith('.ttf') || f === 'OFL.txt');
const missing = wanted.filter((f) => !existsSync(join(dist, f)) || statSync(join(dist, f)).size !== statSync(join(src, f)).size);

if (missing.length) {
  console.error(`build: assets missing from dist/assets/fonts: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`build: ${wanted.length} font assets in dist`);
