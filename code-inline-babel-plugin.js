import * as util from 'util';
import * as path from 'path';
import * as fs from 'fs';

function findFirstIdentifierByRegex(pth, regex) {
  let matchingNode = null;
  pth.traverse({
    Identifier(subPath) {
      if (regex.test(subPath.node.name)) {
        matchingNode = subPath;
        subPath.stop(); // Stop traversal as soon as we find the first match
      }
    }
  });
  return matchingNode;
}

export default function(_babel) {
  const t = _babel.types;

  return {
    name: "inlining calls to grab code from source",
    visitor: {
      CallExpression(pth, state) {
        const filename = state.file.opts.filename;
        const callee = pth.node.callee;
        if (
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'readFileSync'
        ) {
          const objectName = callee.object.name;
          const arg = findFirstIdentifierByRegex(pth, /__dirname\d*/);
          console.warn(`Found readFileSync call on`, objectName, arg.node.loc.start, pth.node.loc.start);
          const fetchPath = arg.container.filter(c => c.type === 'StringLiteral').map(c => c.value);
          // console.warn('filepath', filename, 'path derived from siblings', util.inspect(fetchPath, { colors: true, depth: 10 }));
          const assembledPath = filename.split('/').slice(0, -1).concat(fetchPath);
          const targetFile = '/' + path.join(...assembledPath);
          const contents = fs.readFileSync(targetFile, 'utf8');
          const newStrLit = t.stringLiteral(contents);
          console.warn('We\'ll be replacing this code', '\x1b[34m' + pth.toString() + '\x1b[39m', 'with contents of', targetFile, 'which has', contents.length, 'chars');
          pth.replaceWith(newStrLit);
        }
      },
    }
  }
}

