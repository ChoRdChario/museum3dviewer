#!/usr/bin/env node
/**
 * relpath_patch.js
 * Fix bare module specifiers for three.js and JSM helpers to relative paths.
 * Usage:
 *   node relpath_patch.js [projectRoot='.'] [threeBase='./lib/three']
 *
 * This script walks .js/.mjs files and applies safe, idempotent replacements:
 *   'three'                                   -> <threeBase>/build/three.module.js
 *   'three/examples/jsm/<...>.js' (bare)      -> <threeBase>/examples/jsm/<...>.js
 * It does NOT touch already-relative ('./', '../', '/') imports.
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(process.argv[2] || '.');
const threeBase = process.argv[3] || './lib/three';

const JS_EXT = new Set(['.js','.mjs']);
const SKIP_DIRS = new Set(['node_modules','.git','.next','dist','build','out']);

const stats = { filesScanned:0, filesPatched:0, replacements:0, changed:[] };

function shouldScanDir(dir) {
  const base = path.basename(dir);
  return !SKIP_DIRS.has(base);
}

function readFile(p) {
  try { return fs.readFileSync(p,'utf8'); }
  catch(e){ return null;}
}

function writeFile(p, data) {
  fs.writeFileSync(p, data, 'utf8');
}

function replaceImports(code) {
  // Guard: skip if no 'from' or 'import(' present
  if (!/from\s+['"]|import\(/.test(code)) return { code, count: 0 };

  let count = 0;
  // 1) three bare -> relative
  //    import * as THREE from 'three';
  //    import('three')
  code = code.replace(
    /(\bfrom\s+['"])three(['"])/g,
    (_,p1,p2)=>{ count++; return `${p1}${threeBase}/build/three.module.js${p2}`; }
  );
  code = code.replace(
    /(import\(\s*['"])three(['"]\s*\))/g,
    (_,p1,p2)=>{ count++; return `${p1}${threeBase}/build/three.module.js${p2}`; }
  );

  // 2) JSM helpers bare -> relative (GLTFLoader etc.).
  //    Accept both with or without trailing ".js"
  const jsmNames = [
    'loaders/GLTFLoader','loaders/DRACOLoader','loaders/RGBELoader',
    'loaders/EXRLoader','loaders/TextureLoader','controls/OrbitControls',
    'utils/BufferGeometryUtils','curves/NURBSCurve','curves/NURBSUtils',
    'libs/meshopt_decoder.module'
  ];
  for (const name of jsmNames) {
    const bare = new RegExp(`(from\\s+['"])three\\/examples\\/jsm\\/${name}(\\.js)?(['"])`,'g');
    code = code.replace(bare, (_,p1,_dot,p3)=>{ count++; return `${p1}${threeBase}/examples/jsm/${name}.js${p3}`; });

    const dyn = new RegExp(`(import\\(\\s*['"])three\\/examples\\/jsm\\/${name}(\\.js)?(['"]\\s*\\))`,'g');
    code = code.replace(dyn, (_,p1,_dot,p3)=>{ count++; return `${p1}${threeBase}/examples/jsm/${name}.js${p3}`; });
  }

  return { code, count };
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldScanDir(full)) walk(full);
      continue;
    }
    const ext = path.extname(entry.name);
    if (!JS_EXT.has(ext)) continue;
    stats.filesScanned++;
    const src = readFile(full);
    if (src == null) continue;
    // Don't touch already-relative JSM imports (./ or ../ or /)
    // We only replace "bare" specifiers which start exactly with "three"
    if (!/['"]three(\/|['"])/.test(src)) continue;

    const { code, count } = replaceImports(src);
    if (count > 0 && code !== src) {
      writeFile(full, code);
      stats.filesPatched++;
      stats.replacements += count;
      stats.changed.push(full);
    }
  }
}

console.log(`[relpath-patch] scanning: ${projectRoot}`);
walk(projectRoot);
console.log(`[relpath-patch] done. files scanned=${stats.filesScanned}, patched=${stats.filesPatched}, replacements=${stats.replacements}`);
if (stats.changed.length) {
  console.log('[relpath-patch] changed files:');
  for (const f of stats.changed) console.log(' -', path.relative(projectRoot, f));
}
