// Build de producción: copia public/ → dist/ y minifica JS y CSS (sin source maps).
// Los scripts son clásicos (no módulos) y comparten globales, así que esbuild no renombra
// identificadores de nivel superior al transformar archivo por archivo.
import { cp, rm, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { transform } from 'esbuild';

const SRC = 'public', OUT = 'dist';
await rm(OUT, { recursive: true, force: true });
await cp(SRC, OUT, { recursive: true });

async function* walk(dir) {
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) yield* walk(p); else yield p;
  }
}

let before = 0, after = 0;
for await (const file of walk(OUT)) {
  const ext = extname(file);
  if (ext !== '.js' && ext !== '.css') continue;
  const code = await readFile(file, 'utf8');
  if (!code.trim()) continue;
  const out = await transform(code, { loader: ext.slice(1), minify: true, sourcemap: false, target: ext === '.js' ? 'es2020' : 'chrome90', legalComments: 'none' });
  await writeFile(file, out.code);
  before += code.length; after += out.code.length;
}
console.log(`Minificado: ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB`);
