const nearley = require('nearley')
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
  let actionMap = new Map()
  let methodMap = new Map()

  maps.set('queries', queryMap)
  maps.set('triggers', triggerMap)
  maps.set('types', typeMap)
  maps.set('db', dbMap)
  maps.set('enums', enumMap)
  maps.set('actions', actionMap)
  maps.set('methods', methodMap)

  // First add all the imported packages (types + services) to the schema.
  // This mutates `maps`
  loadImportedPackages(importNodes, indexes, maps)

  // Next add the types + services for the self package, given the aliases.
  // This mutates `maps`
  addSelfPackage(indexes.get(manifest.name), typeNodes, enumNodes, queryNodes, triggerNodes, maps)

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
      type: 'Id',
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
      name: '_id',
      type: 'string',
      optional: false,
      repeated: false
    },
    {
      tag: 2,
      name: '_revs',
      type: 'string',
      optional: false,
      repeated: true
    },
    {
      tag: 3,
      name: 'type',
      type: 'string',
      optional: false,
      repeated: false
    }
  ]
  schema.messages.push(idType)

  let bytesType = _createType('Bytes')
  bytesType.fields = [
    {
      tag: 1,
      name: 'value',
      type: 'bytes',
      optional: false,
      repeated: false
    }
  ]
  schema.messages.push(bytesType)
}

function loadImportedPackages (importNodes, indexes, maps) {
  for (let node of importNodes) {
    let { schema, index } = indexes.get(node.packageName)
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
  let actionService = { name: 'action', methods: [] }
  let methodService = { name: 'methods', methods: [] }
  base.services.push(queryService)
  base.services.push(triggerService)
  base.services.push(actionService)
  base.services.push(methodService)

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
  maps.get('actions').forEach(action => {
    actionService.methods.push(action)
  })
  maps.get('methods').forEach(method => {
    methodService.methods.push(method)
  })
  return base
}

function addTypeByName (index, name, alias, maps) {
  let typeMap = maps.get('types')
  let queryMap = maps.get('queries')
  let triggerMap = maps.get('triggers')
  let dbMap = maps.get('db')
  let enumMap = maps.get('enums')
  let methodMap = maps.get('methods')

  let nodeIndex = index.get(name)
  let signature = nodeIndex.node.signature
  switch (nodeIndex.type) {
    case 'type':
      if (signature.isAction) {
        // TODO: handle action
      } else if (signature.isStruct) {
        addType(nodeIndex, alias)
      } else {
        addType(nodeIndex, alias)
        addService(nodeIndex, alias)
      }
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
    case 'method':
      [reqType, resType] = addQueryTypes(nodeIndex.node)
      addMethod(nodeIndex, alias, reqType, resType)
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
    let returnType = createResponseType(node)
    let requestType = createRequestType(node)
    typeMap.set(requestType.name, requestType)
    typeMap.set(returnType.name, returnType)
    // Quick band-aid...
    return ['types.' + requestType.name, 'types.' + returnType.name]
  }

  function addType (nodeIndex, name) {
    // Don't add messages/services for protobuf primitives.
    if (isPrimitive(name)) return
    let node = nodeIndex.node

    let nodeParent = node.signature.typeParent
    var parentSchema = nodeParent ? maps.get('types').get(nodeParent) : null
    typeMap.set(name, createType(name, nodeIndex.node, nodeIndex.schema, parentSchema))
  }

  function addEnum (nodeIndex, name) {
    enumMap.set(name, createEnum(name, nodeIndex.node, nodeIndex.schema))
  }

  function addService (nodeIndex, name) {
    let [entryType, responseType] = createDbResponseTypes(name)
    typeMap.set(responseType.name, responseType)
    typeMap.set(entryType.name, entryType)
    dbMap.set(name, {
      name,
      methods: createDbMethods(name, responseType)
    })
  }

  function addQuery (nodeIndex, name, reqType, resType) {
    queryMap.set(name, createQuery(nodeIndex, name, reqType, resType))
  }

  function addTrigger (nodeIndex, name) {
    triggerMap.set(name, createTrigger(nodeIndex, name))
  }

  function addMethod (nodeIndex, name, reqType, resType) {
    methodMap.set(name, createMethod(nodeIndex, name, reqType, resType))
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

function createResponseType (node) {
  let valueName = node.returns.name
  let typeName = pascalCase(node.name + 'Response')
  let base = _createType(typeName)
  base.fields = [
    {
      tag: 1,
      name: 'values',
      type: valueName,
      required: false,
      repeated: true
    }
  ]
  return base
}

function createType (name, node, existingSchema, parentSchema) {
  if (existingSchema) {
    existingSchema.name = name
    return existingSchema
  }
  let base = _createType(name, parentSchema)
  base.fields.push(..._createFields(base.fields.length, node.fields, node.signature.typeParent))
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

function createMethod (index, name, reqType, resType) {
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
    input_type: 'types.Void',
    output_type: 'types.' + index.node.returns.type
  }
}

function createDbResponseTypes (name) {
  let responseName = pascalCase(name + 'Response')
  let entryName = pascalCase(name + 'Entry')
  let responseType = _createType(responseName)
  let entryType = _createType(entryName)
  responseType.fields = [
    {
      tag: 1,
      name: 'values',
      type: entryName,
      optional: false,
      repeated: true
    }
  ]
  entryType.fields = [
    {
      tag: 1,
      name: 'id',
      type: 'Id',
      optional: false,
      repeated: false
    },
    {
      tag: 2,
      name: 'value',
      type: name,
      optional: true,
      repeated: false
    }
  ]
  return [entryType, responseType]
}

function createDbMethods (name, responseType) {
  return [
    {
      name: 'Put',
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
      output_type: prefix(responseType.name),
      client_streaming: true,
      server_streaming: true
    }
  ]
}

function _createFields (offset, fields) {
  // 1) Generate tag numbers from each field name.
  //  Should the tag numbers just be based on field ordering? Should ideally be determined from name
  //  and statefully updated (i.e. fields are never deleted during a rename, only deprecated)
  //  TODO: for first demo, tag numbers can be order-dependent
  // 2) Add optional/repeated tags.
  return fields.map((field, idx) => {
    return {
      tag: offset + idx + 1,
      name: field.fieldName,
      type: field.fieldType,
      required: !field.isOptional,
      repeated: field.isArray
    }
  })
}

function _createType (name, parentSchema) {
  if (parentSchema) {
    return Object.assign({}, parentSchema, { name })
  }
  return {
    name,
    enums: [],
    extends: [],
    messages: [],
    fields: _headerFields()
  }
}

function _createEnum (name) {
  return {
    name,
    values: {},
    options: { allow_alias: false }
  }
}

function _headerFields () {
  let fields = [
    {
      tag: 1,
      name: '_id',
      type: 'string',
      required: false,
      repeated: false
    },
    {
      tag: 2,
      name: '_revs',
      type: 'string',
      required: false,
      repeated: true
    }
  ]
  return fields
}

function prefix (name) {
  return `types.${name}`
}
