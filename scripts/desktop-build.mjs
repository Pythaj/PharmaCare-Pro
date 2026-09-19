/*
 * PharmaCare Pro — Desktop build orchestrator (ESM).
 *
 * Assembles the self-contained desktop payload (`desktop/nextapp`) from the
 * Next.js standalone build, provisions the seeded SQLite template database,
 * generates the Windows application icon, and invokes electron-builder to
 * produce the Setup + Portable installers.
 *
 * Precondition: `prisma generate` and `next build` must have already run so
 * that `.next/standalone` exists and the Prisma client is up to date.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STANDALONE = path.join(ROOT, '.next', 'standalone');
const PUBLIC = path.join(ROOT, 'public');
const NEXTAPP = path.join(ROOT, 'desktop', 'nextapp');
const SCHEMA = path.join(ROOT, 'prisma', 'schema.prisma');
const PRISMA_CLI = path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js');
const SEED = path.join(__dirname, 'desktop-seed.cjs');
const TEMPLATE_DB = path.join(NEXTAPP, 'db', 'template.db');

const ok = (msg) => console.log(`  \x1b[32m✔\x1b[0m ${msg}`);
const fail = (msg, err) => {
  console.error(`  \x1b[31m✘\x1b[0m ${msg}`);
  if (err?.stdout?.toString()) console.error(err.stdout.toString());
  if (err?.stderr?.toString()) console.error(err.stderr.toString());
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts, shell: false });
  if (res.status !== 0) throw Object.assign(new Error(`${cmd} failed`), res);
  return res;
}

function copyRecursive(src, dest, excludes = []) {
  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
    // dereference: true follows junctions/symlinks and writes real files —
    // required because the Next.js standalone trace uses node_modules
    // junctions, which cannot be recreated without admin privileges, and
    // because the installed app must be fully self-contained.
    dereference: true,
    filter: (p) => !excludes.some((e) => p === e || p.startsWith(e + path.sep) || p.endsWith(path.sep + e)),
  });
}

function rmdir(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

console.log('\n=== PharmaCare Pro — Desktop build ===\n');

// 1. Validate preconditions.
if (!fs.existsSync(path.join(STANDALONE, 'server.js'))) {
  fail('Missing .next/standalone/server.js — run `next build` first.', null);
}
if (!fs.existsSync(PRISMA_CLI)) {
  fail('Missing prisma CLI — run `npm install` first.', null);
}
ok('Preconditions satisfied (standalone build + prisma CLI present)');

// 2. Assemble desktop/nextapp.
console.log('\n[1/5] Assembling desktop/nextapp...');
rmdir(NEXTAPP);
fs.mkdirSync(path.join(NEXTAPP, 'db'), { recursive: true });

copyRecursive(STANDALONE, NEXTAPP, ['.env', '.env.production']);
ok(`copied standalone build -> ${path.relative(ROOT, NEXTAPP)}`);

copyRecursive(PUBLIC, path.join(NEXTAPP, 'public'));
ok('copied public/ assets');

fs.cpSync(
  path.join(ROOT, '.next', 'static'),
  path.join(NEXTAPP, '.next', 'static'),
  { recursive: true, force: true }
);
ok('copied .next/static');

// 3. Ensure the Prisma runtime is fully present inside nextapp (the Next.js
//    file-tracer can miss Prisma's dynamic requires).
console.log('\n[2/5] Bundling Prisma runtime...');
for (const pkg of ['@prisma/client']) {
  const src = path.join(ROOT, 'node_modules', pkg);
  const dst = path.join(NEXTAPP, 'node_modules', pkg);
  if (fs.existsSync(src)) copyRecursive(src, dst);
}
const dotPrisma = path.join(ROOT, 'node_modules', '.prisma');
if (fs.existsSync(dotPrisma)) {
  copyRecursive(dotPrisma, path.join(NEXTAPP, 'node_modules', '.prisma'));
}
const engine = path.join(NEXTAPP, 'node_modules', '.prisma', 'client', 'query_engine-windows.dll.node');
if (!fs.existsSync(engine)) {
  fail('Prisma query engine DLL not found after bundling — `prisma generate` may not have run.', null);
}
ok('Prisma client + Windows query engine bundled');

// 4. Provision the seeded SQLite template database.
console.log('\n[3/5] Provisioning seeded SQLite template...');
fs.mkdirSync(path.join(NEXTAPP, 'db'), { recursive: true });
const templateUrl = `file:${TEMPLATE_DB.replace(/\\/g, '/')}`;
rmdir(TEMPLATE_DB); // ensure a clean template
run('node', [PRISMA_CLI, 'db', 'push', '--schema', SCHEMA, '--skip-generate', '--accept-data-loss'], {
  env: { ...process.env, DATABASE_URL: templateUrl, DATABASE_PROVIDER: 'sqlite' },
});
ok('database schema pushed into template');
run('node', [SEED], { env: { ...process.env, DATABASE_URL: templateUrl, DATABASE_PROVIDER: 'sqlite' } });
ok('default users seeded into template');
if (!fs.existsSync(TEMPLATE_DB)) fail('Template DB was not created', null);

// 5. Windows application icon (multi-size BMP-based ICO generated from the
//    shipped PNG master). rcedit/Explorer require a classic bitmap ICO — the
//    PNG-compressed ICO that libvips writes is rejected, so we assemble the
//    ICO container + BITMAPINFOHEADER entries ourselves in pure Node.
console.log('\n[4/5] Generating Windows icon...');
{
  const buildDir = path.join(ROOT, 'desktop', 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  const icoOut = path.join(buildDir, 'icon.ico');

  const sharp = (await import('sharp')).default;
  const srcPng = path.join(PUBLIC, 'icon-512x512.png');
  const sizes = [16, 32, 48, 64, 128, 256];

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);

  const entries = [];
  const images = [];
  let offset = header.length + sizes.length * 16;

  for (const size of sizes) {
    const { data, info } = await sharp(srcPng)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width;
    const h = info.height;
    const stride = w * 4;

    // Bottom-up BGRA XOR bitmap.
    const xor = Buffer.alloc(h * stride);
    for (let row = 0; row < h; row++) {
      const srcRow = data.subarray(row * stride, (row + 1) * stride);
      const dstRow = (h - 1 - row) * stride;
      for (let i = 0; i < stride; i += 4) {
        xor[dstRow + i] = srcRow[i + 2]; // B
        xor[dstRow + i + 1] = srcRow[i + 1]; // G
        xor[dstRow + i + 2] = srcRow[i]; // R
        xor[dstRow + i + 3] = srcRow[i + 3]; // A
      }
    }

    // Monochrome AND mask (1 bit per pixel, padded to 4-byte rows) — all
    // transparent-only entries → mask is empty for a fully opaque icon.
    const andW = Math.ceil(w / 32) * 4;
    const and = Buffer.alloc(h * andW);

    // BITMAPINFOHEADER (DIB) + XOR + AND.
    const dib = Buffer.alloc(40);
    dib.writeUInt32LE(40, 0);
    dib.writeInt32LE(w, 4);
    dib.writeInt32LE(h * 2, 8);
    dib.writeUInt16LE(1, 12);
    dib.writeUInt16LE(32, 14);
    dib.writeUInt32LE(0, 16); // BI_RGB
    dib.writeUInt32LE(h * stride, 20);
    dib.writeInt32LE(0, 24);
    dib.writeInt32LE(0, 28);
    dib.writeUInt32LE(0, 32);
    dib.writeUInt32LE(0, 36);

    const image = Buffer.concat([dib, xor, and]);
    images.push(image);

    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // colors
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bit count
    entry.writeUInt32LE(image.length, 8); // size
    entry.writeUInt32LE(offset, 12); // offset
    entries.push(entry);
    offset += image.length;
  }

  fs.writeFileSync(icoOut, Buffer.concat([header, ...entries, ...images]));
  const icoBytes = fs.readFileSync(icoOut);
  if (icoBytes[0] !== 0 || icoBytes[1] !== 0 || icoBytes[2] !== 1 || icoBytes[3] !== 0) {
    fail('Invalid ICO produced', null);
  }
  ok(`write ${path.relative(ROOT, icoOut)} (${sizes.join('/')}px)`);
}

// 6. Invoke electron-builder.
console.log('\n[5/5] Running electron-builder (NSIS + Portable)...');
const electronBuilderCli = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js');
try {
  run('node', [
    electronBuilderCli,
    '--win',
    '--projectDir', path.join(ROOT, 'desktop'),
  ], {
    // Never attempt code signing — we have no certificate, and local signing
    // tools would trigger the winCodeSign cache download that cannot unpack on
    // this machine without elevation.
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  });
} catch (err) {
  fail('electron-builder failed', err);
}

console.log('\n=== Desktop build complete ===');
console.log(`Installers are in: ${path.join(ROOT, 'release')}\n`);