/**
 * Copy + web-optimize art from sibling cardgame/assets into public/assets.
 * - art windows → 512² WebP (~q78)
 * - frames → max 480×640 WebP (3:4) or 512² for square frames/backs
 * - icons → 128² WebP (transparency kept)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcRoot = path.resolve(root, '..', 'cardgame', 'assets');
const destRoot = path.join(root, 'public', 'assets');

const FOLDERS = ['art', 'frames', 'icons'];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listPngs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.png$/i.test(f));
}

async function optimizeOne(folder, file) {
  const input = path.join(srcRoot, folder, file);
  const base = file.replace(/\.png$/i, '');
  const outWebp = path.join(destRoot, folder, `${base}.webp`);
  const outPng = path.join(destRoot, folder, `${base}.png`); // keep png fallback for icons if needed
  const img = sharp(input, { failOn: 'none' });
  const meta = await img.metadata();

  let pipeline = sharp(input, { failOn: 'none' });

  if (folder === 'icons') {
    pipeline = pipeline.resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
    await pipeline.webp({ quality: 82, alphaQuality: 90 }).toFile(outWebp);
    // also tiny png for max compatibility
    await sharp(input, { failOn: 'none' })
      .resize(128, 128, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png({ compressionLevel: 9 })
      .toFile(outPng);
  } else if (folder === 'frames') {
    const isSquare = /room_square|back_room/i.test(file);
    if (isSquare) {
      pipeline = pipeline.resize(512, 512, { fit: 'inside' });
    } else {
      pipeline = pipeline.resize(480, 640, { fit: 'inside' });
    }
    await pipeline.webp({ quality: 80 }).toFile(outWebp);
  } else {
    // art windows
    pipeline = pipeline.resize(512, 512, { fit: 'cover' });
    await pipeline.webp({ quality: 78 }).toFile(outWebp);
  }

  const inKb = Math.round(fs.statSync(input).size / 1024);
  const outKb = Math.round(fs.statSync(outWebp).size / 1024);
  return { file, inKb, outKb, w: meta.width, h: meta.height };
}

async function makeAtmosphere() {
  const src = path.join(srcRoot, 'art', 'art_room_entrance.png');
  if (!fs.existsSync(src)) return null;
  const out = path.join(destRoot, 'ui', 'bg-basement.webp');
  ensureDir(path.dirname(out));
  await sharp(src)
    .resize(1600, 900, { fit: 'cover' })
    .modulate({ brightness: 0.55, saturation: 0.85 })
    .blur(1.2)
    .webp({ quality: 70 })
    .toFile(out);
  return out;
}

async function main() {
  if (!fs.existsSync(srcRoot)) {
    console.error('Missing source assets at', srcRoot);
    process.exit(1);
  }

  const force = process.argv.includes('--force');
  const reportPath = path.join(destRoot, 'optimize-report.txt');
  if (!force && fs.existsSync(reportPath) && fs.existsSync(path.join(destRoot, 'art'))) {
    console.log('Optimized assets already present (pass --force to rebuild).');
    return;
  }

  // Wipe prior optimized copies / junctions
  if (fs.existsSync(destRoot)) {
    fs.rmSync(destRoot, { recursive: true, force: true });
  }

  let totalIn = 0;
  let totalOut = 0;
  let count = 0;
  const report = [];

  for (const folder of FOLDERS) {
    ensureDir(path.join(destRoot, folder));
    const files = listPngs(path.join(srcRoot, folder));
    for (const file of files) {
      const r = await optimizeOne(folder, file);
      totalIn += r.inKb;
      totalOut += r.outKb;
      count += 1;
      report.push(`${folder}/${file}: ${r.w}x${r.h} ${r.inKb}KB → ${r.outKb}KB webp`);
    }
  }

  const bg = await makeAtmosphere();
  console.log(`Optimized ${count} images`);
  console.log(`Size: ${totalIn}KB → ~${totalOut}KB WebP (${Math.round((1 - totalOut / totalIn) * 100)}% smaller)`);
  if (bg) console.log('Atmosphere:', bg);
  fs.writeFileSync(path.join(destRoot, 'optimize-report.txt'), report.join('\n'), 'utf8');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
