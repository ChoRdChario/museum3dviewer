#!/usr/bin/env node
/**
 * relpath_patch.js v2
 * 
 * 使い方:
 *   node relpath_patch.js [root='.'] [threeBase='./lib/three']
 * 
 * - import "three" → ./lib/three/build/three.module.js
 * - import "three/examples/jsm/..." → ./lib/three/examples/jsm/...
 * - dynamic import も対応
 */

const fs = require("fs");
const path = require("path");

const root = process.argv[2] || ".";
const threeBase = process.argv[3] || "./lib/three";

const threeModule = path.posix
  .join(threeBase.replace(/^\.(?=\/)/, ""), "build/three.module.js")
  .replace(/\\/g, "/");
const threeExamples = path.posix
  .join(threeBase.replace(/^\.(?=\/)/, ""), "examples/jsm/")
  .replace(/\\/g, "/");

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build"]);
const JS_EXTS = new Set([".js", ".mjs"]);

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!IGNORE_DIRS.has(ent.name)) walk(p, files);
    } else {
      if (JS_EXTS.has(path.extname(ent.name))) files.push(p);
    }
  }
  return files;
}

const RE_STATIC_THREE = /(?<=\bfrom\s*['"])three(?=['"])/g;
const RE_STATIC_EX = /(['"])three\/examples\/jsm\//g;
const RE_DYN_EX = /import\(\s*(['"])three\/(examples\/jsm\/[^'"]+)\1\s*\)/g;
const RE_DYN_THREE = /import\(\s*(['"])three\1\s*\)/g;
const RE_PLAIN_EX = /(['"])three\/examples\/jsm\//g;

let patched = 0;

for (const file of walk(root)) {
  let txt = fs.readFileSync(file, "utf8");
  const orig = txt;

  txt = txt.replace(RE_STATIC_THREE, threeModule);
  txt = txt.replace(RE_STATIC_EX, (_m, q) => `${q}${threeExamples}`);
  txt = txt.replace(RE_DYN_EX, (_m, q, rest) => `import(${q}${threeExamples}${rest.replace(/^examples\/jsm\//,"")}${q})`);
  txt = txt.replace(RE_DYN_THREE, (_m, q) => `import(${q}${threeModule}${q})`);
  txt = txt.replace(RE_PLAIN_EX, (_m, q) => `${q}${threeExamples}`);

  if (txt !== orig) {
    fs.writeFileSync(file, txt, "utf8");
    patched++;
    console.log("[patched]", file);
  }
}

console.log("Done. Patched files:", patched);
