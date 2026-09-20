const cp = require('child_process');
try {
  const out = cp.execSync('wmic process where "name=\'chrome.exe\'" get ProcessId,CommandLine /format:csv', {encoding: 'utf8'});
  const lines = out.split('\r\n').filter(l => l.includes('.turboflow-chrome-profile'));
  console.log('Turboflow instances count:', lines.length);
  lines.forEach(l => console.log(l));
} catch (e) {
  console.log('Error:', e.message);
}
