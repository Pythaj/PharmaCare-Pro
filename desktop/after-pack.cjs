/*
 * PharmaCare Pro — electron-builder afterPack hook (CommonJS).
 *
 * electron-builder normally embeds the app icon + version metadata into the
 * Windows executable using rcedit from the winCodeSign package. On machines
 * without Developer Mode / elevation that toolset cannot be unpacked (it
 * contains macOS symlinks), so we perform the same step ourselves here with a
 * vendored rcedit. Runs against the packed executable in appOutDir BEFORE the
 * NSIS/portable targets are assembled — so the installers carry a branded EXE.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_VERSION = '1.0.0.0';
const APP_DISPLAY_VERSION = '1.0.0';
const PRODUCT = 'PharmaCare Pro';
const COMPANY = 'PharmaCare Pro';

function editResources(context) {
  const { appOutDir, packager } = context;
  const exeName = `${packager.appInfo.productFilename}.exe`;
  const exePath = path.join(appOutDir, exeName);

  if (!fs.existsSync(exePath)) {
    throw new Error(`afterPack: executable not found at ${exePath}`);
  }

  const rcedit = path.join(__dirname, 'build', 'tools', 'rcedit-x64.exe');
  if (!fs.existsSync(rcedit)) {
    console.log('[after-pack] rcedit not present — skipping resource editing');
    return;
  }

  const icon = path.join(__dirname, 'build', 'icon.ico');
  const args = [
    exePath,
    '--set-icon', icon,
    '--set-version-string', 'ProductName', PRODUCT,
    '--set-version-string', 'CompanyName', COMPANY,
    '--set-version-string', 'FileDescription', `${PRODUCT} — Pharmacy Management System`,
    '--set-version-string', 'InternalName', exeName,
    '--set-version-string', 'OriginalFilename', exeName,
    '--set-version-string', 'LegalCopyright', `Copyright © 2026 ${COMPANY}`,
    '--set-version-string', 'ProductVersion', APP_DISPLAY_VERSION,
    '--set-file-version', APP_VERSION,
    '--set-product-version', APP_VERSION,
  ];

  console.log(`[after-pack] embedding icon + version metadata into ${exeName}`);
  execFileSync(rcedit, args, { stdio: 'pipe' });
  console.log('[after-pack] done');
}

exports.default = editResources;