const { BUILTIN_TYPES } = require('../consts')

module.exports = function indexTypes (packageName, aliases, astIndex, oldSchema, newSchema) {
  let typeMap = mapTypes(aliases, astIndex, packageName)
  let typeIndex = {}
  for (let msg of newSchema.messages) {
    // TODO: do a real backward/forward compatibility check and bump version.
    let version = '1.0'
    let fieldMap = msg.fields.reduce((acc, field) => {
      if (!BUILTIN_TYPES.has(field.type)) {
        acc[field.name] = typeMap.get(field.type)
      }
      return acc
    }, {})
    typeIndex[msg.name] = {
      version,
      fieldMap
    }
  }
  return typeIndex
}

function mapTypes (aliases, astIndex, packageName) {
  let index = new Map()
  for (let alias of aliases) {
    index.set(alias.alias, { name: alias.name, package: alias.packageName })
  }
  for (let [name, idx] of astIndex) {
    if (index.get(name)) continue
    index.set(name, { name, package: packageName })
  }
  return index
}
