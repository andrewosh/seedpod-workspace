const { BUILTIN_TYPES } = require('../consts')

module.exports = function indexTypes (packageName, aliases, indexes, oldSchema, newSchema) {
  let typeMap = mapTypes(aliases, indexes, packageName)
  let typeIndex = {}
  let typeVersions = {}

  for (let msg of newSchema.messages) {
    // TODO: do a real backward/forward compatibility check and bump version.
    let fieldMap = {}
    let fieldVersions = {}
    let msgInfo = typeMap.get(msg.name)

    for (let field of msg.fields) {
      let nested = !BUILTIN_TYPES.has(field.type)

      let resolved = nested ? typeMap.get(field.type) : [{
        name: field.type,
        packageName
      }]

      let version = computeVersion(resolved)
      fieldVersions[field.name] = version
      if (nested) fieldMap[field.name] = resolved
    }

    // TODO: the type's final version should look at how the field versions have changed
    let version = computeVersion(msgInfo)

    typeIndex[msg.name] = {
      names: msgInfo,
      version,
      fields: msg.fields,
      fieldMap,
      fieldVersions
    }
  }

  let combinedIndex = {
    types: typeIndex,
    indexes
  }

  return combinedIndex

  // TODO: implement
  function computeVersion (typeInfo) {
    if (!typeInfo) return '1.0'
    for (let { name } of typeInfo) {
      let version = typeVersions[name] || '1.0'
      typeVersions[name] = version
      return version
    }
  }
}

function mapTypes (aliases, indexes, packageName) {
  let index = new Map()
  for (let alias of aliases) {
    index.set(alias.alias, [{ name: alias.name, package: alias.packageName }])
  }
  for (let [name] of indexes['local'].index) {
    let existing = index.get(name) || []
    existing.push({ name, package: packageName })
    index.set(name, existing)
  }
  return index
}
