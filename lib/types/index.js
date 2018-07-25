const { BUILTIN_TYPES } = require('../consts')

module.exports = function indexTypes (packageName, aliases, indexes, oldSchema, newSchema) {
  let typeMap = mapTypes(aliases, indexes['local'].index, packageName)
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
      signature: 
      fieldMap,
      fieldVersions
    }
  }

  console.log('TYPE INDEX:', typeIndex)
  return typeIndex

  // TODO: implement
  function computeVersion (typeInfo) {
    console.log('typeInfo:', typeInfo)
    if (!typeInfo) return '1.0'
    for (let { name, packageName } of typeInfo) {
      let version = typeVersions[name] || '1.0'
      typeVersions[name] = version
      return version
    }
  }
}

function mapTypes (aliases, astIndex, packageName) {
  let index = new Map()
  for (let alias of aliases) {
    index.set(alias.alias, [{ name: alias.name, package: alias.packageName }])
  }
  for (let [name] of astIndex) {
    let existing = index.get(name) || []
    existing.push({ name, package: packageName })
    index.set(name, existing)
  }
  console.log('INDEX:', index)
  /*
  for (let [name, idx] of index) {
    Object.assign(idx, {
      isStruct: astIndex.get(name).signature.isStruct,
      isTag: astIndex.get(name).signature.isTag,
      isAction: astIndex.get(name).signature.isAction
    })
  }
  */
  return index
}
