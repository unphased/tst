// BE AWARE of import related sequencing dangers. Mainly that we cannot define any tests (call the test() registrar) from ... not sure... this file specifically.

import * as path from 'path';
import { fileURLToPath } from 'url';
import { hrTimeMs, red } from 'ts-utils';
import { TFun, TestMetadata, testFnRegistry } from '../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// the global test function registries are needed for the import process below to implicitly register the tests as the
// test function gets called. To reduce state management headaches, the hop over global vars is constrained to this
// one, and subsequent test handling will be done functionally
export async function trigger_dynamic_imports(files_filtered: string[])
{
  const stats: { [k: string]: number } = {
    files: 0,
    all_exported_items_count: 0,
    exported_test_fns: 0,
    dynamic_import_duration: 0
  };
  const start = process.hrtime();
  await Promise.all(files_filtered.map(file => import(path.join(__dirname, "..", "..", file)).then(exports => {
    // l("imported", exports, 'from', file);
    stats.files += 1;
    for (const [name, fn] of Object.entries(exports as { [key: string]: any; })) {
      stats.all_exported_items_count += 1;
      if (typeof fn !== 'function') continue;
      const got = testFnRegistry.get(fn as TFun | ((...args: Parameters<TFun>) => Promise<void>));
      if (typeof got === 'object') {
        stats.exported_test_fns += 1;
        got.name = name || fn.name;
        if (!got.name) {
          console.error(`${red('Warning')}: Test function ${fn} from ${file} has no name.`);
        }
        got.filename = file;
        // console.error('test tracing runTests():', got);
        // } else {
        // console.log(`The export ${name} from ${file} is not a registered test`);
      }
    }
  }).catch(err => {
    throw new Error(`dynamic import failed on ${file}: ${err}`);
  })));
  stats.dynamic_import_duration = hrTimeMs(process.hrtime(start));
  console.error('test dispatch', 'trigger_dynamic_import stats', stats);
  return {
    registry: new Map<TFun | ((...args: Parameters<TFun>) => Promise<void>), TestMetadata>([...testFnRegistry.entries()]),
    stats
  };
}

