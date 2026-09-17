// Bouwt de app met het GitHub Pages-basispad en pusht `dist` naar de branch gh-pages.
// Gebruik: npm run deploy   (vereist een ingelogde git met push-rechten op origin)
import { execSync } from 'node:child_process';
import { copyFileSync, rmSync } from 'node:fs';

const BASE = process.env.VITE_BASE || '/navimoto/';
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
run('npx vite build', { env: { ...process.env, VITE_BASE: BASE } });
copyFileSync('dist/index.html', 'dist/404.html');
rmSync('dist/.git', { recursive: true, force: true });
const inDist = { cwd: 'dist' };
run('git init -q -b gh-pages', inDist);
run('git add -A', inDist);
run('git -c user.name="Navimoto deploy" -c user.email="deploy@navimoto.local" commit -q -m "Deploy Navimoto naar GitHub Pages"', inDist);
run(`git push -f "${remote}" gh-pages`, inDist);
rmSync('dist/.git', { recursive: true, force: true });
console.log(`\nKlaar. De site wordt binnen ~1 minuut bijgewerkt op https://ryanvos5.github.io${BASE}`);
