import * as types from '@babel/types';
import traverse from '@babel/traverse';
console.warn('traverse', traverse);

export default function(_babel) {
  const t = types;

  return {
    name: "inlining calls to grab code from source",
    visitor: {
      CallExpression(path) {
        const callee = path.node.callee;
        if (
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'readFileSync'
        ) {
          const objectName = callee.object.name;
          const arg = findFirstIdentifierByRegex(path, /__dirname\d*/);
          console.warn(`Found readFileSync call on`, objectName, arg, path.node.loc.start);
        }
      },
    }
  }
}


function findFirstIdentifierByRegex(path, regex) {
  let matchingNode = null;

  // Here, we use `path.traverse` which automatically handles the context correctly
  path.traverse({
    Identifier(subPath) {
      if (regex.test(subPath.node.name)) {
        matchingNode = subPath.node;
        subPath.stop(); // Stop traversal as soon as we find the first match
      }
    }
  });

  return matchingNode;
}
