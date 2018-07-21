const nearley = require('nearley')
const protoSchema = require('protocol-buffers-schema')
const pascalCase = require('pascal-case')

const grammar = require('./grammar')

const BUILTIN_TYPES = new Set([
  'uint8', 'uint16', 'uint32', 'uint64',
  'int8', 'int16', 'int32', 'int64',
  'float', 'string', 'bytes', 'any'
])

module.exports.compile = function (dependentSchemas, selfIndex, aliases, tree, manifest) {
  let schema = {
    syntax: 3,
    package: null,
    imports: [],
    enums: [],
    messages: [],
    services: []
  }

  configureBaseFields(schema)

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
  loadImportedPackages(importNodes, dependentSchemas, maps)

  // Next add the types + services for the self package, given the aliases.
  // This mutates `maps`
  addSelfPackage(selfIndex, typeNodes, enumNodes, queryNodes, maps)

  // From the maps, construct the resulting protobuf schema.
  let compiled = buildSchema(schema, maps)

  return compiled
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

function configureBaseFields (schema) {
  schema.messages.push(_createType('Void'))
  schema.services.push({
    name: 'queries',
    methods: [],
    options: {}
  })
}

function loadImportedPackages (importNodes, dependentSchemas, maps) {
  for (let node of importNodes) {
    let [ importSchema, importAST, importIndex ] = dependentSchemas[node.packageName]
    if (!importSchema) throw new Error(`Cannot find schema for package ${node.packageName}`)

    for (let type of importNodes.types) {
      // TODO: properly alias query arg/return types if they're aliased in the import.
      addTypeByName(importIndex, type.name, type.alias || type.name, maps)
    }
  }
}

function addSelfPackage (index, typeNodes, enumNodes, queryNodes, maps) {
  let [ selfSchema, selfAST, selfIndex ] = index
  let allNodes = [...typeNodes,  ...enumNodes, ...queryNodes]
  for (let node of allNodes) {
    addTypeByName(selfIndex, node.name, node.name, maps)
  }
}

function buildSchema (base, maps) {
  maps.get('types').forEach(type => {
    base.types.push(type)
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

  let nodeIndex = index.get(name)
  switch (nodeIndex.type) {
    case 'messages':
      addType(nodeIndex, alias)
      addService(nodeIndex, alias)
      break
    case 'enums':
      addType(nodeIndex, alias)
      break
    case 'services':
      let [reqType, resType] = addQueryTypes(nodeIndex.node.args)
      addMethod(nodeIndex, alias, reqType, resType)
      break
    default:
      throw new Error(`Node index contains an invalid node type: ${nodeIndex.type}`)
  }

  function createType (typeSchema, name) {
    let copy = Object.assign({}, typeSchema)
    copy.name = name
    return copy
  }

  function addQueryTypes (node) {
    for (let arg of node.args) {
      let argType = arg.paramType.name
      addTypeByName(index, argType, argType, typeMap, queryMap)
    }
    let returnType = node.returns.name
    let requestType = createRequestType(node)
    typeMap.set(requestType.name, requestType)
    addTypeByName(index, returnType, returnType, typeMap, queryMap)
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

  function addMethod (node, name) {
    queryMap.set(name, createQuery(name, node))
  }
}

function createRequestType (node) {
  let typeName = pascalCase(node.name + 'Request')
  let fields = node.args.map((arg, idx) => {
    return {
      tag: idx,
      name: arg.paramName.name,
      type: arg.paramType.name,
      required: !arg.paramName.isOptional,
      repeated: arg.paramType.isArray
    }
  })
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
  base.fields = _createFields(node.fields)
  return base
}

function createQuery (name, node, reqType, resType) {
  return {
    name,
    client_streaming: false,
    server_streaming: node.returns.isArray,
    input_type: reqType,
    output_type: resType
  }
}

function createDbMethods (name) {
  return [
    {
      name: 'Insert',
      input_type: name,
      output_type: 'bool',
      client_streaming: false,
      server_streaming: false
    },
    {
      name: 'Update',
      input_type: name,
      output_type: 'bool',
      client_streaming: false,
      server_streaming: false
    },
    {
      name: 'Delete',
      input_type: 'string',
      output_type: 'bool',
      client_streaming: false,
      server_streaming: false
    },
    {
      'Get',
      input_type: 'string',
      output_type: name,
      client_streaming: false,
      server_streaming: false
    }
  ]
}

function  _createFields (fields) {
  // 1) Generate tag numbers from each field name.
  //  Should the tag numbers just be based on field ordering? Should ideally be determined from name
  //  and statefully updated (i.e. fields are never deleted during a rename, only deprecated)
  //  TODO: for first demo, tag numbers can be order-dependent
  // 2) Add optional/repeated tags.
  return fields.map((field, idx) => {
    return {
      tag: idx,
      name: field.fieldName,
      type: field.fieldType,
      required: !field.isOptional,
      repeated: field.isArray
    }
  })
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
