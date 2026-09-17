// Bouwt de app en pusht `dist` naar de branch gh-pages (GitHub Pages).
// Gebruik: npm run deploy   (vereist een ingelogde git met push-rechten op origin)
//
// Domein: staat er een DEPLOY_DOMAIN (in .env of de omgeving, bijv. navimoto.vos-oss.nl), dan wordt de
// app op het basispad "/" gebouwd en een CNAME-bestand meegeleverd. Zonder domein draait de app op
// https://ryanvos5.github.io/navimoto/ (basispad "/navimoto/").
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

function readDotEnv() {
  if (!existsSync('.env')) return {};
  const out = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const dotenv = readDotEnv();
const domain = (process.env.DEPLOY_DOMAIN || dotenv.DEPLOY_DOMAIN || '').trim();
const BASE = process.env.VITE_BASE || (domain ? '/' : '/navimoto/');
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
run('npx vite build', { env: { ...process.env, VITE_BASE: BASE } });
copyFileSync('dist/index.html', 'dist/404.html');
if (domain) writeFileSync('dist/CNAME', domain + '\n');
rmSync('dist/.git', { recursive: true, force: true });
const inDist = { cwd: 'dist' };
run('git init -q -b gh-pages', inDist);
run('git add -A', inDist);
run('git -c user.name="Navimoto deploy" -c user.email="deploy@navimoto.local" commit -q -m "Deploy Navimoto naar GitHub Pages"', inDist);
run(`git push -f "${remote}" gh-pages`, inDist);
rmSync('dist/.git', { recursive: true, force: true });
const url = domain ? `https://${domain}/` : `https://ryanvos5.github.io${BASE}`;
console.log(`\nKlaar. De site wordt binnen ~1 minuut bijgewerkt op ${url}`);
