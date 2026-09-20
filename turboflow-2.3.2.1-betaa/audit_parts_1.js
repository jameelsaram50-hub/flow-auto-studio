const fs = require('fs');

const mx = fs.readFileSync('dist/mx-a3f8b2c1.js', 'utf8');

function extractFunc(name) {
  const idx = mx.indexOf(name);
  if (idx === -1) return `NOT FOUND: ${name}`;
  return mx.substring(idx, Math.min(mx.length, idx + 1200));
}

console.log('--- 1. Qe (Authorization) ---');
console.log(extractFunc('async function Qe('));

console.log('--- 2. Sr (Main Controller) ---');
console.log(extractFunc('async function Sr('));

console.log('--- 3. Rr (Image Generation Loop) ---');
console.log(extractFunc('async function Rr('));

console.log('--- 4. Ut (Boq Image Gen) ---');
console.log(extractFunc('async function Ut('));

console.log('--- 5. xt (Batchexecute RPC) ---');
console.log(extractFunc('async function xt('));
