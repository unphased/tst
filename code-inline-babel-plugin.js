import * as types from '@babel/types';

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
          const filename = path.node.arguments[0];
          console.warn(`Found readFileSync call on`, objectName, filename, path.node.loc.start);
        }
      },
    }
  }
}

