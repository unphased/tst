import * as process from 'process';
import * as fs from 'fs';
import * as util from 'util';

// this is a possibly ill-advised regex based metaprogramming script. Only intended for targeting esbuild bundles to do
// a specific replacement within them (fs readfilesync's to inline their contents into a string literal).

// TODO make it more generic (more like make a generic one referencing this)
// Emits replaced result on stdout.

const usage = () => {
  console.error(`Usage:
node find-replace.js <files>

Replaces all instances of certain kinds of file reads in given file, which should be a node (js or ts) source file.
`);
  process.exit(1);
};

if (process.argv.length !== 3) {
  usage();
}

// crude but workable.
const re = /(?:fs\d*\.)?readFileSync\((.*), ["']utf-?8["']\)/g;
const file = process.argv[2];
const fileContents = fs.readFileSync(file, 'utf8');
const sourceLocations = [ ...fileContents.matchAll(/^\/\/ (.*)$/mg) ].map(m => [ m.index, m[1] ]).map(e => ({
  offset: e[0],
  parentDirs: e[1].split('/').slice(0, -1)
}));
console.error(sourceLocations);
const parsePathCall = (command) => {
  const matchMethod = command.match(/path\d*\.(\w+)\((.*)\)/);
  const matchPathParsed = [...matchMethod[2].matchAll(/(\s*,\s*(?:"[^"]+"|'[^']+'))/g)].map(e => e[0].replace(/^, /, '').replace(/^['"]/, '').replace(/['"]$/, ''));
  return { pathMethod: matchMethod[1], params: matchMethod[2], path: matchPathParsed };
}
const replacementLocations = [ ...fileContents.matchAll(re) ].map(m => ({ idx: m.index, m0: m[0], m1: m[1], parsed: parsePathCall(m[1]) }));
console.error('replacements:', replacementLocations);
replacementLocations.forEach(r => {
  for (const { offset, parentDirs } of sourceLocations) {
    r.source = parentDirs;
    if (r.idx < offset) {
      break;
    }
  }
});
console.error('replacements:', util.inspect(replacementLocations, {colors: true, depth: 10}));
const r2 = replacementLocations.map(e => fileContents.slice(e.idx, e.idx + e.m0.length));
console.error('r2:', r2);
const repl_paths = replacementLocations.map(e => e.source.concat(e.parsed.path));
console.error('rpaths:', repl_paths);

// CURRENT STATUS OF THIS SCRIPT: More or less doable to extract the paths needed... but splicing/zipping the string of
// the target file is tricky and made me realize this is really a parser's job. Friends don't let friends parse JS with regex, so I'm explicitly abandoning it now...

// process.stdout.write(fileContents.replace(re, (_, m1) => {
//   // this is even more crude. Fetching the source file like this from the bundle is only gonna work if non minifying.
//   console.error('m1', m1);
//   return "lol"
// }));
