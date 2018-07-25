const nearley = require('nearley')
const protoSchema = require('protocol-buffers-schema')
const pascalCase = require('pascal-case')

const { BUILTIN_TYPES } = require('../consts')
const grammar = require('./grammar')

module.exports.compile = function (indexes, aliases, tree, manifest) {
  let schema = {
    syntax: 3,
    package: null,
    imports: [],
    enums: [],
    messages: [],
    services: []
  }
  let types = {
    name: 'types',
    imports: [],
    enums: [],
    messages: [],
    services: []
  }
  schema.messages.push(types)

  configureBaseFields(types)

  // For now, compilation is split into multiple passes for simplicity.
  let importNodes = tree.filter(n => n.nodeType === 'import')
  let typeNodes = tree.filter(n => n.nodeType === 'type')
  let enumNodes = tree.filter(n => n.nodeType === 'enum')
  let queryNodes = tree.filter(n => n.nodeType === 'sparql')

  let maps = new Map()
  let queryMap = new Map()
  let dbMap = new Map()
  let typeMap = new Map()

  maps.set('queries', queryMap)
  maps.set('types', typeMap)
  maps.set('db', dbMap)

  // First add all the imported packages (types + services) to the schema.
  // This mutates `maps`
  loadImportedPackages(importNodes, indexes, maps)

  console.log('after imported, maps:', maps)

  // Next add the types + services for the self package, given the aliases.
  // This mutates `maps`
  addSelfPackage(indexes['local'], typeNodes, enumNodes, queryNodes, maps)

  // From the maps, construct the resulting protobuf schema.
  return buildSchema(schema, maps)
}

module.exports.parse = function (rawInterface) {
  console.log('parsing raw interface:', rawInterface)
  const parser = new nearley.Parser(nearley.Grammar.fromCompiled(grammar))
  var trees
  try {
    trees = parser.feed(rawInterface).results
  } catch (err) {
    throw new Error('Could not parse spdl file: ' + err)
  }

  // There shouldn't be any ambiguity, so we can just select the first parse.
  let tree = trees[0]

  console.log('trees:', trees)
  let fixed = tree.filter(n => n).map(n => n[0])

  console.log('FIXED:', fixed)

  let deepTypes = fixed.filter(n => n.nodeType === 'import').map(n => {
    return n.types.map(t => {
      return { name: t.name, alias: t.alias || t.name, packageName: n.packageName }
    })
  })
  let aliases = [].concat(...deepTypes)

  console.log('ALIASES:', aliases)

  return { tree: fixed, aliases }
}

function configureBaseFields (schema) {
  schema.messages.push(_createType('Void'))

  let dbResponse = _createType('DatabaseResponse')
  dbResponse.fields = [
    {
      tag: 1,
      name: 'id',
      type: 'string',
      optional: true,
      repeated: false
    },
    {
      tag: 2,
      name: 'metadata',
      type: 'map',
      map: {
        from: 'string',
        to: 'string'
      },
      optional: true,
      repeated: false
    }
  ]
  schema.messages.push(dbResponse)

  let idType = _createType('Id')
  idType.fields = [
    {
      tag: 1,
      name: 'id',
      type: 'string',
      optional: false,
      repeated: false
    }
  ]
  schema.messages.push(idType)
}

function loadImportedPackages (importNodes, indexes, maps) {
  for (let node of importNodes) {
    let { schema, index } = indexes[node.packageName]
    if (!schema) throw new Error(`Cannot find index for package ${node.packageName}`)

    for (let type of node.types) {
      // TODO: properly alias query arg/return types if they're aliased in the import.
      addTypeByName(index, type.name, type.alias || type.name, maps)
    }
  }
}

function addSelfPackage (selfIndex, typeNodes, enumNodes, queryNodes, maps) {
  let allNodes = [...typeNodes, ...enumNodes, ...queryNodes]
  for (let node of allNodes) {
    let name = node.name || node.signature.typeName
    addTypeByName(selfIndex.index, name, name, maps)
  }
}

function buildSchema (base, maps) {
  maps.get('types').forEach(type => {
    base.messages[0].messages.push(type)
  })
  let queryService = { name: 'query', methods: [] }
  base.services.push(queryService)
  maps.get('queries').forEach(query => {
    queryService.methods.push(query)
  })
  maps.get('db').forEach(service => {
    base.services.push(service)
  })
  return base
}

function addTypeByName (index, name, alias, maps) {
  let typeMap = maps.get('types')
  let queryMap = maps.get('queries')
  let dbMap = maps.get('db')

  console.log('index:', index, 'name:', name, 'alias:', alias)

  let nodeIndex = index.get(name)
  console.log('node index:', nodeIndex)
  switch (nodeIndex.type) {
    case 'type':
      addType(nodeIndex, alias)
      addService(nodeIndex, alias)
      break
    case 'enum':
      addType(nodeIndex, alias)
      break
    case 'sparql':
      let [reqType, resType] = addQueryTypes(nodeIndex.node)
      addMethod(nodeIndex, alias, reqType, resType)
      break
    default:
      throw new Error(`Node index contains an invalid node type: ${nodeIndex.type}`)
  }

  function addQueryTypes (node) {
    console.log('query node:', node)
    if (node.args) {
      for (let arg of node.args) {
        let argType = arg.paramType.name
        addTypeByName(index, argType, argType, maps)
      }
    }
    let returnType = node.returns.name
    let requestType = createRequestType(node)
    typeMap.set(requestType.name, requestType)
    addTypeByName(index, returnType, returnType, maps)
    return [requestType.name, returnType]
  }

  function addType (nodeIndex, name) {
    // Don't add messages/services for protobuf primitives.
    if (BUILTIN_TYPES.has(name)) return
    typeMap.set(name, createType(name, nodeIndex.node, nodeIndex.schema))
  }

  function addService (nodeIndex, name) {
    dbMap.set(name, {
      name,
      methods: createDbMethods(name)
    })
  }

  function addMethod (nodeIndex, name, reqType, resType) {
    queryMap.set(name, createQuery(nodeIndex, name, reqType, resType))
  }
}

function createRequestType (node) {
  let typeName = pascalCase(node.name + 'Request')

  var fields
  if (!node.args) {
    fields = []
  } else {
    fields = node.args.map((arg, idx) => {
      return {
        tag: idx + 1,
        name: arg.paramName.name,
        type: arg.paramType.name,
        required: !arg.paramName.isOptional,
        repeated: arg.paramType.isArray
      }
    })
  }
  let base = _createType(typeName)
  base.fields = fields
  return base
}

function createType (name, node, existingSchema) {
  if (existingSchema) {
    existingSchema.name = name
    return existingSchema
  }
  let base = _createType(name)
  base.fields = _createFields(node.fields, node.signature.typeParent)
  return base
}

function createQuery (index, name, reqType, resType) {
  return {
    name,
    client_streaming: false,
    server_streaming: index.node.returns.isArray,
    input_type: reqType,
    output_type: resType
  }
}

function createDbMethods (name) {
  return [
    {
      name: 'Insert',
      input_type: prefix(name),
      output_type: prefix('DatabaseResponse'),
      client_streaming: true,
      server_streaming: true
    },
    {
      name: 'Update',
      input_type: prefix(name),
      output_type: prefix('DatabaseResponse'),
      client_streaming: true,
      server_streaming: true
    },
    {
      name: 'Delete',
      input_type: prefix('Id'),
      output_type: prefix('DatabaseResponse'),
      client_streaming: true,
      server_streaming: true
    },
    {
      name: 'Get',
      input_type: prefix('Id'),
      output_type: prefix(name),
      client_streaming: true,
      server_streaming: true
    }
  ]
}

function _createFields (fields, parent) {
  // 1) Generate tag numbers from each field name.
  //  Should the tag numbers just be based on field ordering? Should ideally be determined from name
  //  and statefully updated (i.e. fields are never deleted during a rename, only deprecated)
  //  TODO: for first demo, tag numbers can be order-dependent
  // 2) Add optional/repeated tags.
  let headerFields = _headerFields(parent)
  return [...headerFields, ...fields.map((field, idx) => {
    return {
      tag: headerFields.length + idx + 1,
      name: field.fieldName,
      type: field.fieldType,
      required: !field.isOptional,
      repeated: field.isArray
    }
  })]
}

function _createType (name) {
  return {
    name,
    enums: [],
    extends: [],
    messages: [],
    fields: []
  }
}

function _headerFields (parent) {
  let fields = [
    {
      tag: 1,
      name: '_id',
      type: 'string',
      required: true,
      repeated: false
    }
  ]
  if (parent) {
    fields.push({
      tag: 2,
      name: '_parent',
      type: parent,
      required: true,
      repeated: false
    })
  }
  return fields
}

function prefix (name) {
  return `types.${name}`
}
