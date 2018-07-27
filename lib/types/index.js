const { BUILTIN_TYPES } = require('../consts')

module.exports = function indexTypes (packageName, aliases, indexes, oldSchema, newSchema) {
  let typeMap = mapTypes(aliases, indexes, packageName)
  console.log('typeMap:', typeMap)
  let typeIndex = {}
  let typeVersions = {}

  for (let msg of newSchema.messages[0].messages) {
    // TODO: do a real backward/forward compatibility check and bump version.
    let fieldMap = {}
    let fieldVersions = {}
    let msgInfo = typeMap.get(msg.name)
    let parents = getParents(indexes[packageName].index.get(msg.name), indexes)

    for (let field of msg.fields) {
      let nested = !BUILTIN_TYPES.has(field.type)

      // TODO: multiple levels of aliasing will not work yet (type triples will have an alias predicate).
      let resolved = nested ? typeMap.get(field.type) : {
        name: field.type,
        packageName
      }

      let version = computeVersion(resolved)
      fieldVersions[field.name] = version
      if (nested) fieldMap[field.name] = resolved
    }

    // TODO: the type's final version should look at how the field versions have changed
    let version = computeVersion(msgInfo)

    typeIndex[msg.name] = {
      fields: msg.fields,
      version,
      parents,
      fieldMap,
      fieldVersions
    }
  }

  // TODO: Don't duplicate indexes for the same package inside multiple types.json
  // (`indexes` can be reconstructed instead of stored)
  indexes[packageName].types = typeIndex

  return indexes

  // TODO: implement
  function computeVersion (typeInfo) {
    if (!typeInfo) return '1.0'

    let { name } = typeInfo
    let version = typeVersions[name] || '1.0'
    typeVersions[name] = version
    return version
  }
}

function mapTypes (aliases, indexes, packageName) {
  let index = new Map()
  for (let alias of aliases) {
    index.set(alias.alias, { name: alias.name, package: alias.packageName })
  }
  for (let [name] of indexes[packageName].index) {
    let existing = index.get(name)
    if (existing) continue
    index.set(name, { name, packageName })
  }
  return index
}

function getParents (typeIndex, indexes) {
  console.log('TYPE INDEX IN GETPARENTS:', typeIndex)
  return []
}
