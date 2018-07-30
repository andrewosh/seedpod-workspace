const sparqljs = require('sparqljs')
const SparqlParser = sparqljs.Parser
const SparqlGenerator = sparqljs.Generator

const consts = require('../consts')
const { getPrefixesHeader, typePredicate, fieldPredicate } = require('../util')

const TYPE_RE = /type:([0-9a-zA-Z\.\-]+)/gm
const FIELD_RE = /field:([0-9a-zA-Z\.\-]+)/gm

module.exports = function index (packageName, aliases, indexes, oldSchema, newSchema) {
  let nodeMap = mapNodes(aliases, indexes, packageName)
  let typeIndex = indexTypes(nodeMap, packageName, aliases, indexes, oldSchema, newSchema)

  typeIndex.get(packageName).types.set('queries', indexQueries(nodeMap, indexes, oldSchema, newSchema))
  typeIndex.get(packageName).types.set('triggers', indexTriggers(nodeMap, indexes, oldSchema, newSchema))

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

  for (let [name, { node }] of queryMap) {
    // First resolve all type/field strings on the raw query.
    let fixed = fixQuery(node.body)

    // Then ensure that the query has the right prefixes (we can parse after this step).
    let prepended = prependPrefixes(fixed)
    let parsed = parser.parse(prepended)

    // Then make sure it's bounded to only search over HEADS.
    // This mutates `parsed`.
    addQueryBounds(parsed)

    queryMap.set(name, {
      node: node,
      parsed,
      query: generator.stringify(parsed)
    })
  }

  return queryMap

  // Gets all variables that might be references to objects (predicate variables don't matter for the HEAD check)
  function getObjectVariables (parsed) {
    if (!parsed.where) {
      parsed.where = [{
        type: 'bgp',
        triples: []
      }]
    }
    let vars = new Map()
    let where = parsed.where[0].triples
    for (let triple of where) {
      if (triple.subject.startsWith('?')) vars.set(triple.subject, true)
      if (triple.object.startsWith('?')) vars.set(triple.object, true)
    }
    return vars
  }

  // This function:
  // 1) Inserts new WHERE clauses to ensure that we're only querying over HEADS (this could change later)
  function addQueryBounds (parsed) {
    let where = parsed.where[0].triples
    let objectVariables = getObjectVariables(parsed)
    for (let [v] of objectVariables) {
      let idVar = `?__${v.slice(1)}`
      /*
      where.push({
        subject: idVar,
        predicate: consts.graph.seedpod.preds.HEAD,
        object: v
      })
      */
    }
  }

  // It's easier to fix the query in string form via replacement than handle all the edge-cases on
  // the parsed object.
  // This function:
  // 1) Modifies all human-readable type/field strings into resolved strings
  function fixQuery (rawQuery) {
    let replacements = new Map()

    let typeMatches = loadMatches(TYPE_RE, rawQuery)
    let fieldMatches = loadMatches(FIELD_RE, rawQuery)

    for (let [typeName, rawString] of typeMatches) {
      let { name, packageName } = nodeMap.get(typeName)
      let version = indexes
          .get(packageName)
          .types.get(name)
          .version
      replacements.set(rawString, typePredicate(packageName, name, version))
    }

    for (let [typeAndFieldName, rawString] of fieldMatches) {
      // TODO: support multiple levels of nesting here (?)
      // (this is also supported via adding another clause to the WHERE)
      let [typeName, fieldName] = typeAndFieldName.split('.')

      let { packageName, name } = nodeMap.get(typeName)
      let version = indexes.get(packageName)
          .types.get(typeName)
          .fieldVersions[fieldName]

      replacements.set(rawString, fieldPredicate(packageName, name, fieldName, version))
    }

    var fixed = rawQuery
    for (let [rawString, toReplace] of replacements) {
      fixed = fixed.replace(new RegExp(rawString, 'g'), toReplace)
    }

    return fixed
  }

  function loadMatches (regex, rawQuery) {
    var results = new Map()
    var result
    while ((result = regex.exec(rawQuery)) !== null) {
      results.set(result[1], result[0])
    }
    return results
  }

  function prependPrefixes (body) {
    return [...getPrefixesHeader(), body].join('\n')
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
