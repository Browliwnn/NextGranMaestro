// Copia el motor Stockfish "lite" de un solo hilo (1,8 MB, sin cabeceras especiales) a /public/engine
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
const src = 'node_modules/stockfish/bin/';
mkdirSync('public/engine', { recursive: true });
for (const f of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
  if (!existsSync(src + f)) { console.error('Falta ' + f + ' — ejecuta: npm install'); process.exit(1); }
  copyFileSync(src + f, 'public/engine/' + f);
}
copyFileSync('node_modules/stockfish/Copying.txt', 'public/engine/LICENSE-stockfish-GPLv3.txt');
console.log('Motor copiado a public/engine');
