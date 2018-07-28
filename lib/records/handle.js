const protoSchema = require('protocol-buffers-schema')
const Mali = require('mali')
const tmp = require('tmp-promise')
const fs = require('fs-extra')
const through = require('through2')
const pump = require('pump')
const deepEqual = require('fast-deep-equal')
const uuid = require('uuid/v4')

const { logger, typePredicate, fieldPredicate } = require('../util')
const consts = require('../consts')
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
  let types = this.typeIndex.get(this.packageName).types
  console.log('types:', types)

  // Create CRUD handlers for every type.
  for (let [name, idx] of types) {
    console.log('name:', name, 'idx:', idx)
    if (!isRecord(idx)) continue
    console.log('MAKING TYPE HANDLE FOR:', name)
    handles.push(TypeHandle(this, name, idx))
  }
  // TODO: Create query handlers for every query in the `query` service.
  // TODO: Create trigger handlers for every trigger in the `trigger` service.
  // TODO: Create action proxies for every action (forwards to the bound client).
  // TODO: Create method proxies for every method (forwards to the bound client).

  this.app.start()
  return this.app.ports[0]
}

PackageHandle.prototype.close = async function () {
  if (!this.app) return
  return this.app.close()
}

function TypeHandle (pkg, name, index) {
  if (!(this instanceof TypeHandle)) return new TypeHandle(pkg, name, index)
  this.pkg = pkg
  this.name = name
  this.index = index
  console.log('this.index:', this.index)
  this.parents = this._resolveParents()
  this.log = logger([TAG, this.name].join(':'))

  let app = this.pkg.app
  app.use(name, 'put', this._put.bind(this))
  app.use(name, 'get', this._get.bind(this))
  app.use(name, 'delete', this._delete.bind(this))
}

TypeHandle.prototype._resolveParents = function () {
  console.log('in resolveParents', this.index)
  return []
}

TypeHandle.prototype._put = async function (ctx) {
  let self = this
  this.log.debug('put request start')

  let putStream = through.obj(async function (chunk, enc, cb) {
    try {
      let { triples, rootId, rootRev, revs } = self._generateTriples(chunk)

      self.log.debug(`generated triples: ${JSON.stringify(triples)} with rootId: ${rootId}`)
      self.log.debug(`  with root ID: ${rootId} and root revision: ${rootRev}`)

      // TODO: this should be atomic -- add a public `batch` method to hyper-graph-db
      await Promise.all([
        self.pkg.graph.del(triples.deletions),
        self.pkg.graph.put(triples.insertions),
        self.pkg.triggers.batch(revs)
      ])

      return cb(null, { _id: rootId, rev: rootRev })
    } catch (err) {
      self.log.error(`put stream error: ${err}`)
      return cb(err)
    }
  })

  pump(ctx.req, putStream, ctx.req, err => {
    if (err) {
      this.log.error(`put error: ${err}`)
      return
    }
    this.log.debug('put request finished')
  })
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
  return this.pkg.typeIndex.get(packageName).types.get(typeName)
}

TypeHandle.prototype._generateTriples = function (obj, resolved) {
  let index = resolved ? this._getIndex(resolved.packageName, resolved.name) : this.index
  let packageName = resolved ? resolved.packageName : this.pkg.packageName
  let name = resolved ? resolved.name : this.name

  if (obj._id && obj._revs && !obj._revs.length) {
    throw new Error('Updates must specify parent revisions')
  }

  let newRecord = !!obj._id
  var rootId = obj._id
  var rootRevs = obj._revs

  let fieldTriples = index.fields.map(getFieldTriples.bind(this)).reduce((acc, { insertions, deletions, revs }) => {
    acc.deletions.push(...deletions)
    acc.insertions.push(...insertions)
  }, {
    insertions: [],
    deletions: [],
    revs: []
  })

  var revs = fieldTriples.revs
  let triples = fieldTriples
  let typeId = typePredicate(packageName, name, index.version)

  if (newRecord) {
    // This is the first revision for the record, so no need to update the prev pointer.
    rootId = uuid()
    rootRevs = uuid()
    triples.insertions.push(
      {
        subject: rootId,
        predicate: consts.graph.types.IS,
        object: typeId
      },
      {
        subject: rootId,
        predicate: consts.graph.types.HEAD,
        object: rootRevs
      }
    )
  } else {
    // Get create a new revision, set it to HEAD, and point it to any previous revisions
    let oldRevs = rootRevs
    rootRevs = uuid()
    triples.insertions.push(...oldRevs.map(rev => {
      return {
        subject: rootRevs,
        predicate: consts.graph.types.PREV,
        object: rev
      }
    }), {
      subject: rootId,
      predicate: consts.graph.types.HEAD,
      object: rootRevs
    })
    // Delete any old heads
    triples.deletions.push(...oldRevs.map(rev => {
      return {
        subject: rootId,
        predicate: consts.graph.types.HEAD,
        object: rev
      }
    }))
  }

  // The value is not important -- this is only for triggering watches
  revs.push({ key: [typeId, rootRevs].join('/'), value: 1 })

  return {
    triples,
    rootId,
    rootRevs,
    revs
  }

  function getFieldTriples (field) {
    if (field.name === '_id') return []
    let value = obj[field.name]
    if (!value) return []

    let pred = fieldPredicate(packageName, name, field.name, index.fieldVersions[field.name])

    console.log('index:', index, 'field:', field, 'field.name:', field.name, 'fieldMap:', index.fieldMap)
    let fieldInfo = index.fieldMap[field.name]

    if (field.repeated) return [].concat(...value.map(makeTriples))
    return makeTriples(value)

    function makeTriples (value) {
      if (fieldInfo) {
        // This is a nested field -- recurse
        let { rootRevs: nestedRev, triples: nestedTriples } = this._generateTriples(value, fieldInfo)
        nestedTriples.push({
          subject: rootId,
          predicate: pred,
          object: nestedRev
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
}

TypeHandle.prototype._inflateObject = async function (rootId) {
  let self = this
  let db = this.pkg.graph

  // First get the latest revision for the given ID.
  let results = await db.get([
    {
      subject: rootId,
      predicate: consts.graph.LATEST,
      object: db.v('o')
    }
  ])
  // If there isn't a latest revision, then this is an invalid root ID
  if (!results.length) throw new Error(`Invalid object ID: ${rootId}`)

  // If there are multiple latest revisions, then this is a conflict -- inflate all conflicts.
  let inflated = []
  for (let { object: headRev } of results) {
    inflated.push(await inflate(headRev, this.name, this.packageName))
  }

  async function inflate (rev, name, packageName) {
    let index = self._getIndex(packageName, name)
    let deletionCheck = db.search([
      subject: consts.graph.DELETIONS,
      predicate: 
    ])
  }

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

function isRecord (idx) {
  if (!idx.node) return false
  if (idx.node.signature.isStruct) return false
  if (idx.node.signature.isAction) return false
  return true
}
