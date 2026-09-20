const fs = require('fs');

const mx = fs.readFileSync('dist/mx-a3f8b2c1.js', 'utf8');

const idx = mx.indexOf('async function vr(');
console.log(mx.substring(idx, idx + 2500));
