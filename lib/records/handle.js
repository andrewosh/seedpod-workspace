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

function PackageHandle (manager, packageName, schema, typeIndex) {
  if (!(this instanceof PackageHandle)) return new PackageHandle(manager, packageName, schema, typeIndex)
  this.packageName = packageName
  this.graph = manager.graph
  this.triggers = manager.triggers
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
    if (!isRecord(idx)) continue
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
      let { insertions, deletions, revs, rootId, rootRevs } = self._generateTriples(chunk)

      let triples = [...insertions, ...deletions]
      self.log.debug(`generated triples: ${JSON.stringify(triples, null, 2)} and revs: ${JSON.stringify(revs)}`)
      self.log.debug(`  with root ID: ${rootId} and root revision: ${rootRevs}`)

      // TODO: this should be atomic -- add a public `batch` method to hyper-graph-db
      await Promise.all([
        self.pkg.graph.del(deletions),
        self.pkg.graph.put(insertions),
        self.pkg.triggers.batch(revs)
      ])

      return cb(null, { _id: rootId, _rev: rootRevs })
    } catch (err) {
      console.log('err:', err)
      self.log.error(`put stream error: ${err}`)
      return cb(err)
    }
  })

  let metaStream = through.obj(function ({ _id, _rev }, enc, cb) {
    return cb(null, {
      id: {
        _id,
        _rev
      }
    })
  })

  pump(ctx.req, putStream, metaStream, ctx.req, err => {
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

  let getStream = through.obj(async function ({ _id, _rev }, enc, cb) {
    try {
      let obj = self._inflateObject(_id, _rev)
      self.log.debug(`inflated object: ${JSON.stringify(obj)} with rootId: ${_id} at rev: ${_rev}`)
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
  let self = this

  let index = resolved ? this._getIndex(resolved.packageName, resolved.name) : this.index
  let packageName = resolved ? resolved.packageName : this.pkg.packageName
  let name = resolved ? resolved.name : this.name

  if (obj._id && obj._revs && !obj._revs.length) {
    throw new Error('Updates must specify parent revisions')
  }

  let newRecord = !obj._id
  var rootId = obj._id
  var rootRevs = obj._revs

  let revs = []
  let insertions = []
  let deletions = []

  let typeId = typePredicate(packageName, name, index.version)

  if (newRecord) {
    // This is the first revision for the record, so no need to update the prev pointer.
    rootId = uuid()
    rootRevs = uuid()
    insertions.push(
      {
        subject: rootId,
        predicate: consts.graph.types.IS,
        object: typeId
      },
      {
        subject: rootId,
        predicate: consts.graph.revs.HEAD,
        object: rootRevs
      }
    )
  } else {
    // Get create a new revision, set it to HEAD, and point it to any previous revisions
    let oldRevs = rootRevs
    rootRevs = uuid()
    insertions.push(...oldRevs.map(rev => {
      return {
        subject: rootRevs,
        predicate: consts.graph.revs.PREV,
        object: rev
      }
    }), {
      subject: rootId,
      predicate: consts.graph.revs.HEAD,
      object: rootRevs
    })
    // Delete any old heads
    deletions.push(...oldRevs.map(rev => {
      return {
        subject: rootId,
        predicate: consts.graph.revs.HEAD,
        object: rev
      }
    }))
  }

  let mapped = index.fields.map(getFieldTriples)
  console.log('MAPPED:', mapped)
  mapped.filter(f => f.insertions).forEach(({ insertions: ins, deletions: dels, revs: rs }) => {
    deletions.push(...dels)
    insertions.push(...ins)
    revs.push(...rs)
  })

  // The value is not important -- this is only for triggering watches
  revs.push({ key: [typeId, rootRevs].join('/'), value: '1' })

  return {
    insertions,
    deletions,
    rootId,
    rootRevs,
    revs
  }

  function getFieldTriples (field) {
    console.log('in getFieldTriples, rootRevs:', rootRevs, 'and rootId:', rootId)
    if (field.name === '_id' || field.name === '_rev') return {}
    let value = obj[field.name]
    if (!value) return {}

    let pred = fieldPredicate(packageName, name, field.name, index.fieldVersions[field.name])

    let fieldInfo = index.fieldMap[field.name]

    if (field.repeated) return [].concat(...value.map(makeTriples))
    let triples = makeTriples(value)
    console.log('FIELD TRIPLES:', triples)
    return triples

    function makeTriples (value) {
      if (fieldInfo) {
        // This is a nested field -- recurse
        let triples = self._generateTriples(value, fieldInfo)
        triples.insertions.push({
          subject: rootRevs,
          predicate: pred,
          object: triples.rootRev
        })
        return triples
      }
      return {
        insertions: [{
          subject: rootRevs,
          predicate: pred,
          object: value
        }],
        deletions: [],
        revs: []
      }
    }
  }
}

TypeHandle.prototype._inflateObject = async function (rootId, rootRev) {
  let self = this
  let db = this.pkg.graph

  // If the revision isn't specified, get the HEAD revisions for the given ID.
  var revs = [rootRev]
  if (!revs) {
    revs = await db.get({
      subject: rootId,
      predicate: consts.graph.revs.HEAD,
      object: db.v('o')
    })
    // If there isn't a latest revision, then this is an invalid root ID
    if (!revs.length) throw new Error(`Invalid object ID: ${rootId}`)
  }

  // If there are multiple latest revisions, then this is a conflict -- inflate all conflicts.
  return Promise.all(revs.map(({ object: rev }) => {
    return inflate(rev, this.name, this.packageName)
  }))

  async function inflate (rev, name, packageName) {
    let index = self._getIndex(packageName, name)
    let [deletions, rootFields] = await Promise.all([
      db.get({
        subject: consts.graph.buckets.DELETIONS,
        predicate: consts.graph.verbs.HAS,
        object: rev
      }),
      db.search({
        subject: rev,
        predicate: db.v('p'),
        object: db.v('o')
      })
    ])
    // Since each revision is created by a single writer, there cannot be a conflict here
    if (deletions.length > 1) return null

    let inflated = {}
    let predicatesToMetadata = index.fields.reduce((acc, field) => {
      acc[fieldPredicate(packageName, name, field.name, index.fieldVersions[field.name])] = {
        field,
        index: index.get(field.name)
      }
      return acc
    }, {})

    // Each field should be inflated concurrently.
    let fieldPromises = []
    for (let { predicate, object } of rootFields) {
      let { field, fieldIndex } = predicatesToMetadata[predicate]
      if (!field) throw new Error(`Graph contains an invalid field link: ${predicate}`)
      let fieldInfo = fieldIndex.fieldMap[field.name]

      const finish = (v) => {
        if (field.repeated) {
          if (!inflated[field.name]) inflated[field.name] = []
          inflated[field.name].push(v)
        } else {
          inflated[field.name] = v
        }
      }
      if (fieldInfo) {
        fieldPromises.push(inflate(object, fieldInfo.name, fieldInfo.packageName).then(finish))
      } else {
        finish(object)
      }
    }
    await Promise.all(fieldPromises)
    return inflated
  }
}

function isRecord (idx) {
  if (!idx.node) return false
  if (idx.node.signature.isStruct) return false
  if (idx.node.signature.isAction) return false
  return true
}
