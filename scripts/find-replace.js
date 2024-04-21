import * as process from 'process';
import * as fs from 'fs';

// two modes of operation...

// 1. (for batch operation) node find-replace.js <json>
// 2. (NOT IMPL YET as sensible cli utility) node find-replace.js <pattern> <replacement> <file>

const usage = () => console.log(`Usage:
  node find-replace.js <json>
  node find-replace.js <pattern> <replacement> <file>
`);

if (process.argv.length > 3) {
  console.log("mode 2 unimplemented.")
  usage();
}

const json = process.argv[2];
const data = JSON.parse(json);

// format: { file: "filepath", find: "re pattern", replace: "replacement" | replaceFile: "filepath" }
data.forEach((item) => {
  const fileContents = fs.readFileSync(item.filePath);
});
