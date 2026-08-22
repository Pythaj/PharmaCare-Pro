/**
 * Replaces symlink/junction entries under .next/node_modules with real copies.
 *
 * Why: Next.js 16 + Turbopack emits hashed external-module aliases such as
 *   .next/node_modules/@prisma/client-<hash>  →  junction → node_modules/@prisma/client
 * Junctions/symlinks are lost when build output is packaged for deploy, so
 * production crashes at runtime with:
 *   "Cannot find module '@prisma/client-<hash>'"
 * Materialising the link targets keeps those paths resolvable everywhere.
 *
 * Runs as part of the Netlify build command (see netlify.toml).
 * Harmless on CI/Linux builds where no links exist.
 */
import { existsSync, lstatSync, statSync, realpathSync, readdirSync, rmSync, cpSync, copyFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = '.next/node_modules';
let fixed = 0;

function walk(dir) {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // unreadable — leave as-is
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let lst;
    try {
      lst = lstatSync(full);
    } catch {
      continue;
    }

    if (lst.isSymbolicLink()) {
      // Resolve the real target BEFORE removing the link itself
      let target;
      try {
        target = realpathSync(full);
      } catch {
        console.warn(`[fix-junctions] dangling link skipped: ${relative('.', full)}`);
        continue;
      }
      if (!existsSync(target)) {
        console.warn(`[fix-junctions] missing target skipped: ${relative('.', full)}`);
        continue;
      }
      const isDir = statSync(target).isDirectory();
      rmSync(full, { recursive: true, force: true });
      if (isDir) {
        cpSync(target, full, { recursive: true });
      } else {
        copyFileSync(target, full);
      }
      fixed++;
      console.log(`[fix-junctions] materialised: ${relative('.', full)} -> ${relative('.', target)}`);
    } else if (lst.isDirectory()) {
      walk(full);
    }
  }
}

walk(ROOT);

/**
 * Second pass — Turbopack's server runtime resolves external aliases with an
 * externalRequire that walks the PROJECT-LEVEL node_modules only (it never
 * looks inside .next/node_modules). So every hashed alias found under
 * .next/node_modules is mirrored 1:1 into node_modules, giving the runtime
 * a resolvable real package at the exact name it requires.
 */
const ALIAS_ROOT = join(ROOT, '@prisma');
const MIRROR = join('node_modules', '@prisma');
if (existsSync(ALIAS_ROOT)) {
  for (const entry of readdirSync(ALIAS_ROOT)) {
    if (!/^client-[0-9a-f]+$/.test(entry)) continue;
    const linkPath = join(ALIAS_ROOT, entry);
    let lst;
    try {
      lst = lstatSync(linkPath);
    } catch {
      continue;
    }
    const target = lst.isSymbolicLink() ? realpathSync(linkPath) : linkPath;
    if (!existsSync(target) || !statSync(target).isDirectory()) continue;
    // Mirror the FULL package into project-level node_modules, where
    // Turbopack's externalRequire actually resolves.
    const dest = join(MIRROR, entry);
    rmSync(dest, { recursive: true, force: true });
    cpSync(target, dest, { recursive: true });
    // Remove the copy under .next/node_modules entirely: deploy packaging
    // ships it as an EMPTY directory, and Node's resolver stops at the first
    // name match — an empty match would shadow the complete package above.
    if (lst.isSymbolicLink()) {
      rmSync(linkPath, { recursive: true, force: true });
    }
    fixed++;
    console.log(`[fix-junctions] mirrored alias: ${relative('.', dest)} <- ${relative('.', target)} (hollow .next copy removed)`);
  }
}

console.log(`[fix-junctions] done — ${fixed} entrie(s) fixed under ${ROOT} and node_modules`);
