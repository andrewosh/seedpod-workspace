const { BUILTIN_TYPES } = require('../consts')

module.exports = function indexTypes (packageName, aliases, astIndex, oldSchema, newSchema) {
  let typeMap = mapTypes(aliases, astIndex, packageName)
  let typeIndex = {}
  let typeVersions = {}
  for (let msg of newSchema.messages) {
    // TODO: do a real backward/forward compatibility check and bump version.
    let fieldMap = {}
    let fieldVersions = {}

    for (let field of msg.fields) {
      let nested = !BUILTIN_TYPES.has(field.type)
      let resolved = nested ? typeMap.get(field.type) : {
        name: field.type,
        packageName
      }
      let version = computeVersion(resolved.name)
      fieldVersions[field.name] = version
      if (nested) fieldMap[field.name] = resolved
    }

    // TODO: the type's final version should look at how the field versions have changed
    let version = computeVersion(msg.name)

    typeIndex[msg.name] = {
      version,
      fieldMap,
      fieldVersions
    }
  }
  return typeIndex

  // TODO: implement
  function computeVersion (typeName) {
    let version = typeVersions[typeName] || '1.0'
    typeVersions[typeName] = version
    return version
  }
}

function mapTypes (aliases, astIndex, packageName) {
  let index = new Map()
  for (let alias of aliases) {
    index.set(alias.alias, { name: alias.name, package: alias.packageName })
  }
  for (let [name] of astIndex) {
    if (index.get(name)) continue
    index.set(name, { name, package: packageName })
  }
  return index
}
