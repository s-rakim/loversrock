// Every relative import in the app resolves, and names something real.
//
// This exists because of a build that got all the way to a Gradle server
// before failing: PlaySectionScreen imported `withSectionBar` from
// '../components/SectionBar', and components/SectionBar.js had never been
// written. Nothing caught it. The parse check parses each file in isolation,
// so a file importing a ghost parses perfectly; the render test only mounts
// the handful of screens it names; and Metro is the first thing in the chain
// that actually follows an import — which meant the first report came from a
// release build, eight minutes in, as "Process 'command 'node'' finished
// with non-zero exit value 1".
//
// So: follow every relative import the way Metro would, and additionally
// check that each named specifier is genuinely exported by the file it
// points at. A file that exists but does not export the name is the same
// class of bug and fails just as late — as `undefined is not a function`,
// at runtime, on a phone.
//
// Package imports are deliberately NOT resolved here. Those fail loudly at
// install time and belong to npm, not to this.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// Metro's order, trimmed to the extensions this app actually uses. The
// platform-specific variants matter: a file may exist only as `.android.js`,
// and calling that missing would be a false alarm.
const EXTENSIONS = [
  '.js', '.jsx', '.json', '.ts', '.tsx', '.cjs', '.mjs',
  '.android.js', '.ios.js', '.native.js',
];

const ASSETS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ttf', '.otf', '.mp3', '.wav', '.lottie'];

const SOURCE_DIRS = ['app', 'components', 'data', 'services', 'i18n', 'widgets', 'plugins'];
const SOURCE_FILES = ['App.js', 'theme.js', 'buildInfo.js', 'app.config.js'];

let passed = 0;
let failed = 0;

const pass = (msg) => { passed += 1; console.log(`  PASS  ${msg}`); };
const fail = (msg) => { failed += 1; console.log(`  FAIL  ${msg}`); };

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(js|jsx|mjs|cjs)$/.test(entry.name) ? [full] : [];
  });
}

/** What file, if any, does `spec` resolve to from `fromFile`? */
function resolve(spec, fromFile) {
  const base = path.resolve(path.dirname(fromFile), spec);

  if (ASSETS.includes(path.extname(base).toLowerCase())) {
    return fs.existsSync(base) ? base : null;
  }
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;

  for (const ext of EXTENSIONS) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  // A directory resolves through its index, or through the "main" its own
  // package.json names.
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    const pkg = path.join(base, 'package.json');
    if (fs.existsSync(pkg)) {
      const main = JSON.parse(fs.readFileSync(pkg, 'utf8')).main;
      if (main) {
        const mainPath = path.resolve(base, main);
        if (fs.existsSync(mainPath)) return mainPath;
      }
    }
    for (const ext of EXTENSIONS) {
      if (fs.existsSync(path.join(base, `index${ext}`))) return path.join(base, `index${ext}`);
    }
  }
  return null;
}

const astCache = new Map();

function astOf(file) {
  if (astCache.has(file)) return astCache.get(file);
  let ast = null;
  try {
    ast = parser.parse(fs.readFileSync(file, 'utf8'), {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'classProperties', 'objectRestSpread', 'optionalChaining', 'nullishCoalescingOperator'],
    });
  } catch {
    ast = null;
  }
  astCache.set(file, ast);
  return ast;
}

/**
 * The names a file exports.
 *
 * Returns null when the answer is "cannot tell" — a re-export from a package,
 * a CommonJS `module.exports = something`, a JSON file. The caller treats
 * null as "do not judge", because a test that guesses here would fail on
 * perfectly good code and get switched off.
 */
function exportsOf(file) {
  if (file.endsWith('.json')) return null;
  const ast = astOf(file);
  if (!ast) return null;

  const names = new Set();
  let unknown = false;

  for (const node of ast.program.body) {
    if (node.type === 'ExportDefaultDeclaration') {
      names.add('default');
    } else if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        const d = node.declaration;
        if (d.id?.name) names.add(d.id.name);
        for (const decl of d.declarations || []) {
          if (decl.id.type === 'Identifier') names.add(decl.id.name);
          // `export const { a, b } = ...` — rare, but do not miscount it.
          else unknown = true;
        }
      }
      for (const spec of node.specifiers || []) {
        if (spec.type === 'ExportSpecifier') names.add(spec.exported.name);
        else unknown = true;
      }
      // `export ... from './x'` with no specifiers cannot happen, but
      // `export * from './x'` can, and it hides whatever './x' exports.
    } else if (node.type === 'ExportAllDeclaration') {
      unknown = true;
    } else if (
      node.type === 'ExpressionStatement'
      && node.expression.type === 'AssignmentExpression'
      && /module\.exports|exports\./.test(
        fs.readFileSync(file, 'utf8').slice(node.expression.left.start, node.expression.left.end),
      )
    ) {
      unknown = true;
    }
  }

  return unknown ? null : names;
}

const files = [
  ...SOURCE_DIRS.flatMap((d) => walk(path.join(root, d))),
  ...SOURCE_FILES.map((f) => path.join(root, f)).filter((f) => fs.existsSync(f)),
];

console.log('=== EVERY RELATIVE IMPORT POINTS AT A FILE THAT EXISTS ===');

const missing = [];
const wrongName = [];
let checkedImports = 0;

for (const file of files) {
  const ast = astOf(file);
  if (!ast) {
    fail(`${path.relative(root, file)} does not parse`);
    continue;
  }

  for (const node of ast.program.body) {
    const isImport = node.type === 'ImportDeclaration';
    const isReExport = node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration';
    if (!isImport && !isReExport) continue;

    const spec = node.source?.value;
    if (!spec || !spec.startsWith('.')) continue;

    checkedImports += 1;
    const target = resolve(spec, file);
    if (!target) {
      missing.push(`${path.relative(root, file)} -> ${spec}`);
      continue;
    }

    if (!isImport) continue;
    const available = exportsOf(target);
    if (!available) continue;

    for (const s of node.specifiers) {
      const wanted = s.type === 'ImportDefaultSpecifier' ? 'default'
        : s.type === 'ImportSpecifier' ? s.imported.name
          : null; // namespace import — takes whatever is there
      if (!wanted) continue;
      if (!available.has(wanted)) {
        wrongName.push(
          `${path.relative(root, file)} imports { ${wanted === 'default' ? 'default' : wanted} } `
          + `from ${spec}, which does not export it`,
        );
      }
    }
  }
}

if (missing.length === 0) {
  pass(`all ${checkedImports} relative imports resolve`);
} else {
  for (const m of missing) fail(`unresolved: ${m}`);
}

console.log('\n=== AND NAMES SOMETHING THAT FILE ACTUALLY EXPORTS ===');
if (wrongName.length === 0) {
  pass('every named import is exported by its target');
} else {
  for (const w of wrongName) fail(w);
}

console.log(`\nIMPORT RESULT — PASSED: ${passed}  FAILED: ${failed}`);
process.exit(failed ? 1 : 0);
