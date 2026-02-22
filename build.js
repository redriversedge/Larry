#!/usr/bin/env node
/**
 * LARRY v2 — Build Script
 * Validates JS syntax, checks for non-ASCII chars,
 * and packages the app for deployment.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const JS_FILES = [
  'js/core.js',
  'js/espn.js',
  'js/engines.js',
  'js/tabs.js',
  'js/chat.js'
];
const SERVERLESS_FILES = [
  'netlify/functions/espn-proxy.js',
  'netlify/functions/larry-chat.js'
];

let errors = 0;

console.log('=== LARRY v2 BUILD ===\n');

// 1. Syntax check all JS
console.log('1. Syntax check...');
[...JS_FILES, ...SERVERLESS_FILES].forEach(f => {
  const fp = path.join(ROOT, f);
  if (!fs.existsSync(fp)) {
    console.log(`   SKIP  ${f} (not found)`);
    return;
  }
  try {
    execSync(`node --check "${fp}"`, { stdio: 'pipe' });
    console.log(`   PASS  ${f}`);
  } catch (e) {
    console.log(`   FAIL  ${f}`);
    console.log(`         ${e.stderr.toString().trim()}`);
    errors++;
  }
});

// 2. Non-ASCII character check
console.log('\n2. ASCII verification...');
JS_FILES.forEach(f => {
  const fp = path.join(ROOT, f);
  if (!fs.existsSync(fp)) return;
  const content = fs.readFileSync(fp, 'utf8');
  const nonAscii = [];
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    if (code > 127 && code !== 8232 && code !== 8233) {
      // Find line number
      const line = content.substring(0, i).split('\n').length;
      const char = content[i];
      nonAscii.push({ line, char, code });
    }
  }
  if (nonAscii.length > 0) {
    console.log(`   WARN  ${f}: ${nonAscii.length} non-ASCII chars`);
    nonAscii.slice(0, 5).forEach(n => {
      console.log(`         Line ${n.line}: U+${n.code.toString(16).toUpperCase()} "${n.char}"`);
    });
    // Check specifically for smart quotes
    const smartQuotes = nonAscii.filter(n => [0x201C, 0x201D, 0x2018, 0x2019].includes(n.code));
    if (smartQuotes.length > 0) {
      console.log(`   ERROR Smart quotes detected! ${smartQuotes.length} instances`);
      errors++;
    }
  } else {
    console.log(`   PASS  ${f}`);
  }
});

// 3. File reference check
console.log('\n3. File reference verification...');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const manifest = fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8');

// Check HTML references
const htmlRefs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(r => !r.startsWith('http'));
htmlRefs.forEach(ref => {
  const fp = path.join(ROOT, ref);
  if (fs.existsSync(fp)) {
    console.log(`   PASS  ${ref}`);
  } else {
    console.log(`   FAIL  ${ref} (not found)`);
    errors++;
  }
});

// Check manifest icon references
const manifestData = JSON.parse(manifest);
if (manifestData.icons) {
  manifestData.icons.forEach(icon => {
    const fp = path.join(ROOT, icon.src);
    if (fs.existsSync(fp)) {
      console.log(`   PASS  ${icon.src} (${icon.sizes})`);
    } else {
      console.log(`   FAIL  ${icon.src} (not found)`);
      errors++;
    }
  });
}

// 4. Summary
console.log('\n=== BUILD RESULT ===');
if (errors > 0) {
  console.log(`FAILED: ${errors} error(s) found.`);
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED');
  
  // List file sizes
  console.log('\nFile sizes:');
  const allFiles = ['index.html', 'css/larry.css', ...JS_FILES, 'sw.js', 'manifest.json'];
  let total = 0;
  allFiles.forEach(f => {
    const fp = path.join(ROOT, f);
    if (fs.existsSync(fp)) {
      const size = fs.statSync(fp).size;
      total += size;
      console.log(`  ${(size / 1024).toFixed(1)}KB  ${f}`);
    }
  });
  console.log(`  ${(total / 1024).toFixed(1)}KB  TOTAL`);
}
