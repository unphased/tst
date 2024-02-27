// Import Madge using dynamic import syntax
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProgramLaunchContext = () => {
  return fileURLToPath(import.meta.url) === process.argv[1];
}
// Which other source files depend on these provided ones?
const computeDependents = async (srcFiles: string[]) => {
  // need to grab actual typescript source location
  let projectDir = path.resolve(__dirname, '..')
  if (projectDir.split('/').pop() === 'build') {
    projectDir = path.resolve(projectDir, '..', 'src');
  }
  console.log('srcdir should be', projectDir);

  const madge = (await import('madge')).default;
  const res = await madge(projectDir, { fileExtensions: ['ts'] });
  console.log('res:', res);
  console.log('res.obj():', res.obj());
};

if (isProgramLaunchContext()) {
  (async () => {
    await computeDependents(process.argv.slice(2));
  })();
}
