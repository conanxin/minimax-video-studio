const { execSync } = require('child_process');
const fs = require('fs');

const FORBIDDEN = [
  'MINIMAX_API_KEY=',
  'Bearer ',
  'https://',
  'http://',
  'sk-',
];

function runGitLsFiles() {
  return execSync('git ls-files', { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
}

function checkPaths() {
  const files = runGitLsFiles();
  const denied = files.filter((file) => {
    const lower = file.toLowerCase();
    return (
      lower.includes('reports/local') ||
      lower.startsWith('node_modules/') ||
      lower.endsWith('.env') ||
      lower.includes('data/') && /\.(db|sqlite)$/.test(lower)
    );
  });
  if (denied.length > 0) {
    console.warn('Potentially sensitive tracked paths found:');
    denied.forEach((item) => console.warn(` - ${item}`));
  } else {
    console.log('No obvious sensitive paths found in tracked files.');
  }
}

function scanFileContent() {
  const files = runGitLsFiles();
  let hits = 0;
  for (const file of files) {
    if (file.includes('.git/') || file.includes('node_modules/') || file.includes('reports/local')) {
      continue;
    }
    const content = fs.readFileSync(file, 'utf8');
    if (FORBIDDEN.some((token) => content.includes(token))) {
      const matched = FORBIDDEN.find((token) => content.includes(token));
      console.warn(`Possible sensitive token in ${file}: ${matched}`);
      hits += 1;
      if (hits > 20) break;
    }
  }
  if (hits === 0) {
    console.log('No obvious sensitive token patterns found in tracked files.');
  }
}

checkPaths();
scanFileContent();
console.log('open-source check finished.');
