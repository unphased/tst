import * as util from 'util';
function findFirstIdentifierByRegex(path, regex) {
  let matchingNode = null;
  path.traverse({
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
      CallExpression(path, state) {
        const callee = path.node.callee;
        if (
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'readFileSync'
        ) {
          const objectName = callee.object.name;
          const arg = findFirstIdentifierByRegex(path, /__dirname\d*/);
          console.warn(`Found readFileSync call on`, objectName, arg.node.loc.start, path.node.loc.start);
          console.warn('filepath', state.file.opts.filename, 'path derived from siblings', util.inspect(arg.container.filter(c => c.type === 'StringLiteral').map(c => c.value), { colors: true, depth: 10 }));
        }
      },
    }
  }
}

