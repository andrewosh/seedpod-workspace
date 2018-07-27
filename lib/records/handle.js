const protoSchema = require('protocol-buffers-schema')
const Mali = require('mali')
const tmp = require('tmp-promise')
const fs = require('fs-extra')
const through = require('through2')
const pump = require('pump')
const deepEqual = require('deep-eql')
const uuid = require('uuid/v4')

const { logger, typePredicate, fieldPredicate } = require('../util')
const TAG = 'records:handle'
const log = logger(TAG)

module.exports = PackageHandle

function PackageHandle (packageName, graph, triggers, schema, typeIndex) {
  if (!(this instanceof PackageHandle)) return new PackageHandle(packageName, graph, triggers, schema, typeIndex)
  this.packageName = packageName
  this.graph = graph
  this.triggers = triggers
  this.schema = schema
  this.typeIndex = typeIndex

  // Set in `initialize`.
  this.app = null
}

PackageHandle.prototype.initialize = async function () {
  log.debug('initializing handle...')
  let { path } = await tmp.file()
  await fs.writeFile(path, protoSchema.stringify(this.schema), 'utf8')
  this.app = new Mali(path)

  let handles = []

  // Create CRUD handlers for every type.
  for (let msg of this.schema.messages[0].messages) {
    if (!msg.fields.length || msg.fields[0].name !== '_id') continue
    handles.push(TypeHandle(this, msg))
  }
  // TODO: Create query handlers for every query in the `query` service.

  this.app.start()
  return this.app.ports[0]
}

PackageHandle.prototype.close = async function () {
  if (!this.app) return
  return this.app.close()
}

function TypeHandle (pkg, msg) {
  if (!(this instanceof TypeHandle)) return new TypeHandle(pkg, msg)
  this.pkg = pkg
  this.msg = msg
  this.name = msg.name
  this.index = this._getIndex(pkg.packageName, this.name)
  this.log = logger([TAG, this.msg.name].join(':'))

  let app = this.pkg.app
  app.use(msg.name, 'insert', this._insert.bind(this))
  app.use(msg.name, 'update', this._update.bind(this))
  app.use(msg.name, 'get', this._get.bind(this))
  app.use(msg.name, 'delete', this._delete.bind(this))
}

TypeHandle.prototype._insert = async function (ctx) {
  let self = this
  this.log.debug('insert request start')

  let insertionStream = through.obj(async function (chunk, enc, cb) {
    try {
      let { triples, rootId, ids } = self._generateTriples(chunk)

      self.log.debug(`generated triples: ${JSON.stringify(triples)} with rootId: ${rootId}`)
      self.log.debug(`  with ids: ${JSON.stringify(ids)}`)
      await self.pkg.graph.put(triples)
      await self.pkg.triggers.batch(ids)

      return cb(null, rootId)
    } catch (err) {
      self.log.error(`insertion stream error: ${err}`)
      return cb(err)
    }
  })

  pump(ctx.req, insertionStream, ctx.req, err => {
    if (err) {
      this.log.error(`insertion error: ${err}`)
      return
    }
    this.log.debug('insert request finished')
  })
}

TypeHandle.prototype._update = async function (ctx) {
  log.debug(`update id: ${ctx.request.req._id}`)
}

TypeHandle.prototype._get = async function (ctx) {
  let self = this
  this.log.debug('get request start')

  let getStream = through.obj(async function (rootId, enc, cb) {
    try {
      let obj = self._inflateObject(rootId)
      self.log.debug(`inflated object: ${JSON.stringify(obj)} with rootId: ${rootId}`)
      return cb(null, obj)
    } catch (err) {
      self.log.error(`get stream error: ${err}`)
      return cb(err)
    }
  })

  pump(ctx.req, getStream, ctx.req, err => {
    if (err) {
      this.log.error(`get error: ${err}`)
      return
    }
    this.log.debug('get request finished')
  })
}

TypeHandle.prototype._delete = async function (ctx) {
  log.debug(`delete id: ${ctx.request.req}`)
}

TypeHandle.prototype._getIndex = function (packageName, typeName) {
  console.log('packageName:', packageName, 'typeName:', typeName)
  return this.pkg.typeIndex[packageName].types[typeName]
}

TypeHandle.prototype._generateTriples = function (obj, resolved) {
  let index = resolved ? this._getIndex(resolved.packageName, resolved.name) : this.index
  let packageName = resolved ? resolved.packageName : this.pkg.packageName
  let name = resolved ? resolved.name : this.name

  let newRecord = !!obj._id
  let rootId = obj._id || uuid()
  let rootRev = obj._rev || uuid()
  let fieldTriples = [].concat(...index.fields.map(getFieldTriples.bind(this)))

  var triples = []
  if (newRecord) {
    // This is the first revision for the record, so no need to update the prev pointer.
    triples.push(...[
      {
        subject: '@types',
        predicate: typePredicate(packageName, name, index.version),
        object: rootId
      },
      {
        subject: '@revs',
        predicate: rootId,
        object: rootRev
      },
      {
        subject: rootId,
        predicate: '@latest',
        object: rootRev
      }
    ])
  } else {
    // Get the previous revision, and create a prev pointer to it.

    triples.push(...[
      {
        
      }
    ])
  }
  triples.push(...fieldTriples)

  let revMap = new Map()
  let idRevTriples = triples.filter(t => t.subject === '@types' || t.predicate == '@latest')

  for (let { subject, object } in .map(t => {
    return {
      key: t.predicate,
      value: t.object
    }
  })

  return {
    triples,
    idsAndRevs,
    rootId,
    rootRev
  }

  function getFieldTriples (field) {
    if (field.name === '_id') return []
    let value = obj[field.name]
    if (!value) return []

    let pred = fieldPredicate(packageName, name, field.name, index.fieldVersions[field.name])

    console.log('index:', index, 'field:', field, 'field.name:', field.name, 'fieldMap:', index.fieldMap)
    let fieldInfo = index.fieldMap[field.name]
    if (fieldInfo) {
      // This is a nested field -- recurse
      let { rootId: nestedId, triples: nestedTriples } = this._generateTriples(value, fieldInfo)
      nestedTriples.push({
        subject: rootId,
        predicate: pred,
        object: nestedId
      })
      return nestedTriples
    }
    return [
      {
        subject: rootId,
        predicate: pred,
        object: value
      }
    ]
  }
}

TypeHandle.prototype._inflateObject = async function (rootId, resolved) {
  let packageName = resolved ? resolved.packageName : this.pkg.packageName
  let name = resolved ? resolved.name : this.name
  let index = resolved ? this._getIndex(resolved.packageName, resolved.name) : this.index
  let db = this.pkg.graph

  // First get the top-level type triples to see if the root object was deleted
  let results = await db.search([
    {
      subject: '@types',
      predicate: typePredicate(packageName, name, index.version),
      object: rootId
    }
  ])
  if (!results.length) return inflated

  // If the result exists, check if there are conflicting deletions.
  let rootTriple = results[0]
  let deleteConflicts = rootTriple._metadata.deleteConflicts.length
  let rootFeed = rootTriple._metadata.feed
  if (deleteConflicts.length) {
    deleteConflicts.forEach(({ feed }) => inflated.set(feed, null))
  }
  inflated.set(rootFeed, { _id: rootId })

  let predicatesToNames = index.fields.reduce((acc, field) => {
    acc[fieldPredicate(packageName, name, field.name, index.fieldVersions[field.name])] = field.name
    return acc
  }, {})

  // Get all triples that are either primitive fields or nested/repeated field IDs
  results = await db.search([
    {
      subject: rootId,
      predicate: db.v('p'),
      object: db.v('o')
    }
  ])

  // Store the list of nested objects/primitives keyed by field name.
  // Conflict handling + ordering for repeated fields done in a second pass.
  let resultsByField = new Map()
  for (let { predicate, object, _metadata } of results) {
    let fieldName = predicatesToNames(predicate)
    let list = resultsByField.get(fieldName) || []
    let resolved = index.fieldMap[fieldName]
    if (resolved) {
      // The result is a nested field ID
      let nestedObjects = this._inflateObject(object, resolved)
      for (let [feed, obj] of nestedObjects) {
        list.push({ object: obj, feed })
      }
    } else {
      // The result is a primitive field value
      list.push({ object, feed: _metadata.feed })
    }
    resultsByField.set(fieldName, list)
  }

  // Transform the field result map into the structured result (one per conflict).
  for (let field of index.fields) {
    for (let { object, feed } of resultsByField.get(field.name)) {
    }
  }

  function addVersion (feedId) {
    let version = Object.assign({}, obj)
    inflated.set(feedId, version)
    return version
  }

  function getVersion (feedId) {
    return inflated.get(feedId)
  }
}
