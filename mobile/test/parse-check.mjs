import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const babel = require('@babel/core');

const root = process.argv[2];
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : (e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));

const files = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'components')),
               ...walk(path.join(root, 'data')), ...walk(path.join(root, 'services')),
               path.join(root, 'App.js'), path.join(root, 'theme.js')];
let bad = 0;
for (const f of files) {
  try {
    babel.transformSync(fs.readFileSync(f, 'utf8'), {
      filename: f, presets: [['@babel/preset-react', { runtime: 'classic' }]],
      babelrc: false, configFile: false,
    });
  } catch (e) { bad++; console.log('FAIL', path.relative(root, f), '\n   ', e.message.split('\n')[0]); }
}
console.log(`parsed ${files.length} files, ${bad} failed`);
process.exit(bad ? 1 : 0);
