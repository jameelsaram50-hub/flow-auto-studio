const { spawn } = require('child_process');
const chromeExe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const p = spawn(chromeExe, [
  '--headless=new',
  '--enable-logging=stderr',
  '--v=1',
  '--user-data-dir=C:\\Users\\saram\\.turboflow-test-profile',
  '--load-extension=C:\\Users\\saram\\.turboflow-extension',
  'about:blank'
]);
p.stdout.on('data', d => console.log('OUT:', d.toString()));
p.stderr.on('data', d => console.log('ERR:', d.toString()));
setTimeout(() => {
  p.kill();
  process.exit(0);
}, 4000);
