const { execSync } = require('child_process');
const txt = execSync('adb -s emulator-5554 shell dumpsys activity top', { encoding: 'utf8' });
const lines = txt.split('\n');
const textLines = lines.filter(l => l.includes('ReactTextView') || l.includes('text=') || l.includes('mText='));
console.log('Total text view lines:', textLines.length);
textLines.slice(0, 30).forEach(l => console.log(l.trim()));
