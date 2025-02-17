const fs = require('fs');
const babelTraversePkg = require('@babel/traverse');
const { AstService } = require('../services/AstService.js');

/**
 *  Assume we had:
 *  ```js
 *  const x = 88;
 *  const y = x;
 *  export const myIdentifier = y;
 *  ```
 *  - We started in getSourceCodeFragmentOfDeclaration (looing for 'myIdentifier'), which found VariableDeclarator of export myIdentifier
 *  - getReferencedDeclaration is called with { referencedIdentifierName: 'y', ... }
 *  - now we will look in globalScopeBindings, till we find declaration of 'y'
 *    - Is it a ref? Call ourselves with referencedIdentifierName ('x' in example above)
 *    - is it a non ref declaration? Return the path of the node
 * @param {{ referencedIdentifierName:string, globalScopeBindings:BabelBinding; }} opts
 * @returns {BabelNodePath}
 */
function getReferencedDeclaration({ referencedIdentifierName, globalScopeBindings }) {
  const [, refDeclaratorBinding] = Object.entries(globalScopeBindings).find(
    ([key]) => key === referencedIdentifierName,
  );

  if (refDeclaratorBinding.path.node.init.type === 'Identifier') {
    return getReferencedDeclaration({
      referencedIdentifierName: refDeclaratorBinding.path.node.init.name,
      globalScopeBindings,
    });
  }

  return refDeclaratorBinding.path.get('init');
}

/**
 *
 * @param {{ filePath: string; exportedIdentifier: string; }} opts
 */
async function getSourceCodeFragmentOfDeclaration({ filePath, exportedIdentifier }) {
  const code = fs.readFileSync(filePath, 'utf-8');
  const ast = AstService.getAst(code, 'babel');

  let finalNodePath;

  babelTraversePkg.default(ast, {
    Program(babelPath) {
      babelPath.stop();

      // Situations
      // - Identifier is part of default export (in this case 'exportedIdentifier' is '[default]' )
      //   - declared right away (for instance a class)
      //   - referenced (possibly recursively) by other declaration
      // - Identifier is part of a named export
      //   - declared right away
      //   - referenced (possibly recursively) by other declaration

      const globalScopeBindings = babelPath.get('body')[0].scope.bindings;

      if (exportedIdentifier === '[default]') {
        const defaultExportPath = babelPath
          .get('body')
          .find(child => child.node.type === 'ExportDefaultDeclaration');
        const isReferenced = defaultExportPath.node.declaration?.type === 'Identifier';

        if (!isReferenced) {
          finalNodePath = defaultExportPath.get('declaration');
        } else {
          finalNodePath = getReferencedDeclaration({
            referencedIdentifierName: defaultExportPath.node.declaration.name,
            globalScopeBindings,
          });
        }
      } else {
        const variableDeclaratorPath = babelPath.scope.getBinding(exportedIdentifier).path;
        const isReferenced = variableDeclaratorPath.node.init?.type === 'Identifier';

        if (!isReferenced) {
          // it must be an exported declaration
          finalNodePath = variableDeclaratorPath.node.init
            ? variableDeclaratorPath.get('init')
            : variableDeclaratorPath;
        } else {
          finalNodePath = getReferencedDeclaration({
            referencedIdentifierName: variableDeclaratorPath.node.init
              ? variableDeclaratorPath.node.init.name
              : variableDeclaratorPath.node.id.name,
            globalScopeBindings,
          });
        }
      }
    },
  });

  return {
    sourceNodePath: finalNodePath,
    sourceFragment: code.slice(finalNodePath.node.start, finalNodePath.node.end),
  };
}

module.exports = {
  getSourceCodeFragmentOfDeclaration,
};
