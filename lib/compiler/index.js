const nearley = require('nearley')
const protoSchema = require('protocol-buffers-schema')
const pascalCase = require('pascal-case')

const { isPrimitive } = require('../util')
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
  let queryNodes = tree.filter(n => n.nodeType === 'query')
  let triggerNodes = tree.filter(n => n.nodeType === 'trigger')

  let maps = new Map()
  let queryMap = new Map()
  let triggerMap = new Map()
  let dbMap = new Map()
  let typeMap = new Map()
  let enumMap = new Map()

  maps.set('queries', queryMap)
  maps.set('triggers', triggerMap)
  maps.set('types', typeMap)
  maps.set('db', dbMap)
  maps.set('enums', enumMap)

  // First add all the imported packages (types + services) to the schema.
  // This mutates `maps`
  loadImportedPackages(importNodes, indexes, maps)

  // Next add the types + services for the self package, given the aliases.
  // This mutates `maps`
  addSelfPackage(indexes['local'], typeNodes, enumNodes, queryNodes, triggerNodes, maps)

  // From the maps, construct the resulting protobuf schema.
  return buildSchema(schema, maps)
}

module.exports.parse = function (rawInterface) {
  const parser = new nearley.Parser(nearley.Grammar.fromCompiled(grammar))
  var trees
  try {
    trees = parser.feed(rawInterface).results
  } catch (err) {
    throw new Error('Could not parse spdl file: ' + err)
  }

  // There shouldn't be any ambiguity, so we can just select the first parse.
  let tree = trees[0]

  let fixed = tree.filter(n => n).map(n => n[0])

  let deepTypes = fixed.filter(n => n.nodeType === 'import').map(n => {
    return n.types.map(t => {
      return { name: t.name, alias: t.alias || t.name, packageName: n.packageName }
    })
  })
  let aliases = [].concat(...deepTypes)

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
    },
    {
      tag: 2,
      name: 'type',
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

function addSelfPackage (selfIndex, typeNodes, enumNodes, queryNodes, triggerNodes, maps) {
  let allNodes = [...typeNodes, ...enumNodes, ...queryNodes, ...triggerNodes]
  for (let node of allNodes) {
    let name = node.name || node.signature.typeName
    addTypeByName(selfIndex.index, name, name, maps)
  }
}

function buildSchema (base, maps) {
  let queryService = { name: 'query', methods: [] }
  let triggerService = { name: 'trigger', methods: [] }
  base.services.push(queryService)

  maps.get('types').forEach(type => {
    base.messages[0].messages.push(type)
  })
  maps.get('enums').forEach(e => {
    base.messages[0].enums.push(e)
  })
  maps.get('queries').forEach(query => {
    queryService.methods.push(query)
  })
  maps.get('triggers').forEach(trigger => {
    triggerService.methods.push(trigger)
  })
  maps.get('db').forEach(service => {
    base.services.push(service)
  })
  return base
}

function addTypeByName (index, name, alias, maps) {
  let typeMap = maps.get('types')
  let queryMap = maps.get('queries')
  let triggerMap = maps.get('triggers')
  let dbMap = maps.get('db')
  let enumMap = maps.get('enums')

  console.log('NAME:', name, 'index:', index)
  let nodeIndex = index.get(name)
  switch (nodeIndex.type) {
    case 'type':
      addType(nodeIndex, alias)
      addService(nodeIndex, alias)
      break
    case 'enum':
      addEnum(nodeIndex, alias)
      break
    case 'query':
      let [reqType, resType] = addQueryTypes(nodeIndex.node)
      addQuery(nodeIndex, alias, reqType, resType)
      break
    case 'trigger':
      addTrigger(nodeIndex, alias)
      break
    default:
      throw new Error(`Node index contains an invalid node type: ${nodeIndex.type}`)
  }

  // TODO: clean this up
  function addQueryTypes (node) {
    if (node.args) {
      for (let arg of node.args) {
        let argType = arg.paramType.name
        if (isPrimitive(argType)) continue
        addTypeByName(index, argType, argType, maps)
      }
    }
    let returnType = node.returns.name
    let requestType = createRequestType(node)
    typeMap.set(requestType.name, requestType)
    if (!isPrimitive(returnType)) {
      addTypeByName(index, returnType, returnType, maps)
    }
    return [requestType.name, returnType]
  }

  function addType (nodeIndex, name) {
    // Don't add messages/services for protobuf primitives.
    if (isPrimitive(name)) return
    typeMap.set(name, createType(name, nodeIndex.node, nodeIndex.schema))
  }

  function addEnum (nodeIndex, name) {
    enumMap.set(name, createEnum(name, nodeIndex.node, nodeIndex.schema))
  }

  function addService (nodeIndex, name) {
    dbMap.set(name, {
      name,
      methods: createDbMethods(name)
    })
  }

  function addQuery (nodeIndex, name, reqType, resType) {
    queryMap.set(name, createQuery(nodeIndex, name, reqType, resType))
  }

  function addTrigger (nodeIndex, name) {
    triggerMap.set(name, createTrigger(nodeIndex, name))
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

function createEnum (name, node, existingSchema) {
  if (existingSchema) {
    existingSchema.name = name
    return existingSchema
  }
  let base = _createEnum(name)
  for (var i = 1; i < node.values.length + 1; i++) {
    let val = node.values[i - 1]
    base.values[val] = { value: i }
  }
  console.log('ENUM BASE:', base)
  return base
}

function createQuery (index, name, reqType, resType) {
  return {
    name,
    client_streaming: false,
    server_streaming: false,
    input_type: reqType,
    output_type: resType
  }
}

function createTrigger (index, name) {
  return {
    name,
    client_streaming: false,
    server_streaming: true,
    input_type: 'Void',
    output_type: index.node.type.typeType
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

function _createEnum (name) {
  return {
    name,
    values: {},
    options: { allow_alias: false }
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
