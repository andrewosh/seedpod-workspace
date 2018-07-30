const sparqljs = require('sparqljs')
const SparqlParser = sparqljs.Parser
const SparqlGenerator = sparqljs.Generator

const consts = require('../consts')
const { typePredicate, fieldPredicate } = require('../util')

const TYPE_RE = /type:([0-9a-zA-Z\.\-]+)/gm
const FIELD_RE = /field:([0-9a-zA-Z\.\-]+)/gm
const PLACEHOLDER_RE = /(\$[0-9a-zA-Z]+)/gm

module.exports = function index (packageName, aliases, indexes, oldSchema, newSchema) {
  let nodeMap = mapNodes(aliases, indexes, packageName)
  let typeIndex = indexTypes(nodeMap, packageName, aliases, indexes, oldSchema, newSchema)

  Object.assign(typeIndex, {
    queries: indexQueries(nodeMap, indexes, oldSchema, newSchema),
    triggers: indexTriggers(nodeMap, indexes, oldSchema, newSchema)
  })

  return indexes
}

function indexTypes (nodeMap, packageName, aliases, indexes, oldSchema, newSchema) {
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
    let resolved = nodeMap.get(msg.name)
    let parents = getParents(msg.name, nodeMap, indexes)

    for (let field of msg.fields) {
      let nested = !consts.BUILTIN_TYPES.has(field.type)

      // TODO: multiple levels of aliasing will not work yet (type triples will have an alias predicate).
      let resolved = nested ? nodeMap.get(field.type) : {
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
      resolved,
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
    let resolved = nodeMap.get(msg.name)

    // TODO: the type's final version should look at how the field versions have changed
    let version = computeVersion(resolved)

    typeIndex.set(msg.name, {
      values: msg.fields,
      resolved,
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

function mapNodes (aliases, indexes, packageName) {
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

function indexQueries (nodeMap, indexes, oldSchema, newSchema) {
  let queryMap = indexMethods(nodeMap, indexes, newSchema.services[0])
  let parser = new SparqlParser()
  let generator = new SparqlGenerator()

  console.log('QUERY MAP:', queryMap)
  for (let [name, { node }] of queryMap) {
    let { fixed, placeholders } = fixQuery(node.body)

    // The query will have to be stringified again in the handler in order to populate the param placeholders.
    // (only if there are placeholders -- if there aren't, then the query is baked right now)
    let parsed = parser.parse(prependPrefixes(fixed))

    queryMap.set(name, {
      node: node,
      parsed,
      placeholders,
      query: generator.stringify(parsed)
    })
  }

  return queryMap

  // It's easier to fix the query in string form via replacement than handle all the edge-cases on
  // the parsed object.
  function fixQuery (rawQuery) {
    let placeholders = []
    let replacements = new Map()

    let typeMatches = loadMatches(TYPE_RE, rawQuery)
    let fieldMatches = loadMatches(FIELD_RE, rawQuery)
    let placeholderMatches = loadMatches(PLACEHOLDER_RE, rawQuery)

    for (let [name] of placeholderMatches) {
      placeholders.push(name)
    }

    for (let [typeName, rawString] of typeMatches) {
      let { name, packageName } = nodeMap.get(typeName)
      console.log('INDEXES:', indexes)
      console.log('PACKAGE INDEX:', indexes.get(packageName))
      console.log('TYPE INDEX:', indexes.get(packageName).types)
      let version = indexes
          .get(packageName)
          .types.get(name)
          .version
      console.log('VERSION:', version)
      replacements.set(rawString, typePredicate(packageName, name, version))
    }

    for (let [typeAndFieldName, rawString] of fieldMatches) {
      // TODO: support multiple levels of nesting here (?)
      // (this is also supported via adding another clause to the WHERE)
      let [typeName, fieldName] = typeAndFieldName.split('.')
      console.log('typeName:', typeName, 'fieldName:', fieldName, 'rawString:', rawString)
      console.log('nodeMap:', nodeMap)

      let { packageName, name } = nodeMap.get(typeName)
      let version = indexes.get(packageName)
          .types.get(typeName)
          .fieldVersions[fieldName]

      replacements.set(rawString, fieldPredicate(packageName, name, fieldName, version))
    }

    console.log('REPLACEMENTS:', replacements)

    return {
      fixed: rawQuery,
      placeholders
    }
  }

  function loadMatches (regex, rawQuery) {
    var results = new Map()
    var result
    while ((result = regex.exec(rawQuery)) !== null) {
      console.log('result:', result)
      results.set(result[1], result[0])
    }
    return results
  }

  function prependPrefixes (body) {
    let prefixes = Object.keys(consts.graph)
    return [...prefixes.map(p => `PREFIX ${p}: <seedpod://${p}:>`), body].join('\n')
  }
}

function indexTriggers (nodeMap, indexes, oldSchema, newSchema) {
  let triggerMap = indexMethods(nodeMap, indexes, newSchema.services[1])
  return triggerMap
}

function indexMethods (nodeMap, indexes, newRootService, oldRootService) {
  let methods = newRootService.methods
  let methodIndex = new Map()
  for (let method of methods) {
    let resolved = nodeMap.get(method.name)
    let node = indexes.get(resolved.packageName).index.get(resolved.name)
    methodIndex.set(method.name, node)
  }
  return methodIndex
}

function getParents (name, nodeMap, indexes) {
  let resolved = nodeMap.get(name)
  if (!resolved) return []

  let index = indexes.get(resolved.packageName).index.get(resolved.name)
  let parent = index.node.signature.typeParent
  if (!parent) return []

  return [nodeMap.get(parent), ...getParents(parent, nodeMap, indexes)]
}
