const nearley = require('nearley')
const grammar = require('./grammar')

module.exports.compile = async function (packages, tree, manifest) {
  for (let statement in tree) {
    switch (statement.nodeType) {
      case 'import':
        break
      case 'type':
        break
      case 'enum':
        break
      case 'sparql':
        break
      default:
        throw new Error('Invalid node type in parsed spdl file')
    }
  }
}

module.exports.parse = function (rawInterface) {
  const parser = new nearley.Parser(nearley.Grammar.fromCompiled(grammar))
  var trees
  try {
    trees = parser.feed(rawInterface)
  } catch (err) {
    throw new Error('Could not parse spdl file: ' + err)
  }

  // There shouldn't be any ambiguity, so we can just select the first parse.
  let tree = trees[0]

  let aliases = [].concat(...tree.filter(n => n.nodeType === 'import').map(n => {
    return n.types.map(t => {
      return { name: t.name, alias: t.alias, packageName: n.packageName }
    })
  }))

  return { tree, aliases }
}
