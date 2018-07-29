const { BUILTIN_TYPES } = require('../consts')

module.exports = function indexTypes (packageName, aliases, indexes, oldSchema, newSchema) {
  let typeMap = mapTypes(aliases, indexes, packageName)
  let typeIndex = new Map()
  let typeVersions = new Map()

  // TODO: Don't duplicate indexes for the same package inside multiple types.json
  // (`indexes` can be reconstructed instead of stored)
  indexes.get(packageName).types = typeIndex

  let rootTypes = newSchema.messages[0]
  for (let msg of rootTypes.messages) {
    // TODO: do a real backward/forward compatibility check and bump version.
    let fieldMap = {}
    let fieldVersions = {}
    let resolved = typeMap.get(msg.name)
    let parents = getParents(msg.name, typeMap, indexes)

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
    let version = computeVersion(resolved)

    typeIndex.set(msg.name, {
      fields: msg.fields,
      version,
      parents,
      fieldMap,
      fieldVersions,
      // TODO: this should be simplified.
      node: resolved ? indexes.get(resolved.packageName).index.get(resolved.name).node : null
    })
  }
  for (let msg of rootTypes.enums) {
    // TODO: do a real backward/forward compatibility check and bump version.
    let resolved = typeMap.get(msg.name)

    // TODO: the type's final version should look at how the field versions have changed
    let version = computeVersion(resolved)

    typeIndex.set(msg.name, {
      values: msg.fields,
      version,
      isEnum: true,
      // TODO: this should be simplified.
      node: resolved ? indexes.get(resolved.packageName).index.get(resolved.name).node : null
    })
  }

  return indexes

  // TODO: implement
  function computeVersion (typeInfo) {
    if (!typeInfo) return '1.0'

    let { name } = typeInfo
    let version = typeVersions.get(name) || '1.0'
    typeVersions.set(name, version)
    return version
  }
}

function mapTypes (aliases, indexes, packageName) {
  let index = new Map()
  for (let alias of aliases) {
    index.set(alias.alias, { name: alias.name, packageName: alias.packageName })
  }
  for (let [name] of indexes.get(packageName).index) {
    let existing = index.get(name)
    if (existing) continue
    index.set(name, { name, packageName })
  }
  return index
}

function getParents (name, typeMap, indexes) {
  let resolved = typeMap.get(name)
  if (!resolved) return []

  let index = indexes.get(resolved.packageName).index.get(resolved.name)
  let parent = index.node.signature.typeParent
  if (!parent) return []

  return [typeMap.get(parent), ...getParents(parent, typeMap, indexes)]
}
