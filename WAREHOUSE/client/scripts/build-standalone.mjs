// Сборка автономного «Склад.html» одним процессом node (без npm и без && —
// работает в любом шелле, обходит блокировку PowerShell execution policy).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, '..');

execFileSync(
  process.execPath,
  [path.join(clientDir, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.standalone.config.js'],
  { cwd: clientDir, stdio: 'inherit' },
);
execFileSync(process.execPath, [path.join(__dirname, 'make-standalone.mjs')], { cwd: clientDir, stdio: 'inherit' });
