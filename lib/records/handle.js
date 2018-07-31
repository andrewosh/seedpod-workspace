const stream = require('stream')
const protoSchema = require('protocol-buffers-schema')
const Mali = require('mali')
const tmp = require('tmp-promise')
const fs = require('fs-extra')
const through = require('through2')
const pump = require('pump')
const uuid = require('uuid/v4')
const shasum = require('shasum')
const rabin = require('rabin')
const JSON5 = require('json5')
const debounce = require('lodash.debounce')
const { matchesSelector } = require('pouchdb-selector-core')

const { logger, typePredicate, fieldPredicate, extractPointer } = require('../util')
const consts = require('../consts')
const SP_CONSTS = consts.graph.seedpod
const SP_PREDS = SP_CONSTS.preds
const SP_SUBJECTS = SP_CONSTS.subjects

const TAG = 'records:handle'
const log = logger(TAG)

module.exports = PackageHandle

function PackageHandle (manager, packageName, schema, typeIndex) {
  if (!(this instanceof PackageHandle)) return new PackageHandle(manager, packageName, schema, typeIndex)
  this.packageName = packageName
  this.graph = manager.graph
  this.triggers = manager.triggers
  this.fs = manager.fs
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
  let typeIndex = this.typeIndex.get(this.packageName)

  this.differ = Differ(this, typeIndex)

  let handles = []
  let types = typeIndex.types
  let queries = types.get('queries')
  let triggers = types.get('triggers')

  // Create CRUD handlers for every type.
  for (let [name, idx] of types) {
    if (!isRecord(idx)) continue
    if (name === 'queries' || name === 'triggers') continue
    let handle = TypeHandle(this, name, idx)
    handle.bind()
    handles.push(handle)
  }
  // TODO: Create query handlers for every query in the `query` service.
  for (let [name, queryMetadata] of queries) {
    handles.push(QueryHandle(this, name, typeIndex, queryMetadata))
  }

  // TODO: Create trigger handlers for every trigger in the `trigger` service.
  for (let [name, triggerMetadata] of triggers) {
    let handle = TriggerHandle(this, name, typeIndex, triggerMetadata)
    let typeName = triggerMetadata.node.returns.type
    this.differ.addTrigger(typeName, handle)
    handles.push(handle)
  }

  // TODO: Create action proxies for every action (forwards to the bound client).
  // TODO: Create method proxies for every method (forwards to the bound client).

  this.app.start()
  return this.app.ports[0]
}

PackageHandle.prototype.close = async function () {
  if (!this.app) return
  this.differ.close()
  return this.app.close()
}

// The Differ is an optimization to prevent each TriggerHandler from doing its own checkouts/diffs/watches.
function Differ (pkg, typeIndex, opts) {
  if (!(this instanceof Differ)) return new Differ(pkg, typeIndex, opts)
  this.opts = opts || {}
  this.pkg = pkg
  this.typeIndex = typeIndex
  this.log = logger([TAG, 'differ'].join(':'))

  // Set in reset.
  this.triggerMap = null
  this.watchers = null
  // Updated after each per-path diff computation.
  this.versionMap = null

  this.reset()
}

Differ.prototype._startWatching = function (path) {
  let triggers = this.pkg.triggers
  let watcher = triggers.watch(path, debounce(() => {
    let lastVersion = this.versionMap.get(path)
    let diffStream = triggers.createDiffStream(lastVersion, path)
    diffStream.on('data', ({ left, right }) => {
      if (left) {
        // Since triggers are keyed by revision, there won't be any conflicts here
        let rev = extractPointer(left[0].key)
        let pathTriggers = this.triggerMap.get(path)
        pathTriggers.forEach(async ({ triggerHandle, typeHandle }) => {
          let inflated = await typeHandle.inflateObject(null, rev)
          triggerHandle._notify(inflated)
        })
      }
    })
    diffStream.on('error', err => {
      log.error(`diff stream errored: ${err}`)
      this.reset()
    })
    diffStream.on('end', async () => {
      // TODO: this doubles the cost of the diff -- worth it?
      // TODO: potential race condition if a diff does not finish before `delay`
      this.versionMap.set(path, await triggers.version())
    })
  }, this.opts.delay || 200))
  this.watchers.push(watcher)
}

Differ.prototype.close = function () {
  this.reset()
}

Differ.prototype.addTrigger = function (typeName, triggerHandle) {
  let typeHandle = TypeHandle(this.pkg, typeName, this.typeIndex.types.get(typeName))
  let newTrigger = {
    triggerHandle,
    typeHandle
  }
  let triggerPath = typeHandle.triggerPath
  let existing = this.triggerMap.get(triggerPath)
  if (existing) return existing.push(newTrigger)
  this.triggerMap.set(triggerPath, [newTrigger])
  this._startWatching(triggerPath)
}

Differ.prototype.reset = function () {
  this.triggerMap = new Map()
  this.versionMap = new Map()
  this.watchers = []
  this.watchers.forEach(w => w())
}

function TypeHandle (pkg, name, index) {
  if (!(this instanceof TypeHandle)) return new TypeHandle(pkg, name, index)
  this.pkg = pkg
  this.name = name
  this.packageName = pkg.packageName
  this.index = index
  this.parents = this._resolveParents()
  this.triggerPath = typePredicate(this.packageName, this.name, this.index.version)
  this.log = logger([TAG, this.name].join(':'))
}

TypeHandle.prototype._resolveParents = function () {
  // TODO: implement
  return []
}

TypeHandle.prototype._getIndex = function (packageName, typeName) {
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
  let blocks = []

  let typeId = typePredicate(packageName, name, index.version)

  if (newRecord) {
    // This is the first revision for the record, so no need to update the prev pointer.
    rootId = uuid()
    rootRevs = uuid()
    insertions.push(
      {
        subject: rootId,
        predicate: SP_PREDS.IS,
        object: typeId
      },
      {
        subject: rootId,
        predicate: SP_PREDS.HEAD,
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
        predicate: SP_PREDS.PREV,
        object: rev
      }
    }), {
      subject: rootId,
      predicate: SP_PREDS.HEAD,
      object: rootRevs
    })
    // Delete any old heads
    deletions.push(...oldRevs.map(rev => {
      return {
        subject: rootId,
        predicate: SP_PREDS.HEAD,
        object: rev
      }
    }))
  }
  // Create a mapping from the revision to its root ID.
  insertions.push({
    subject: rootId,
    predicate: SP_PREDS.HAS,
    object: rootRevs
  })

  let mapped = [].concat(...index.fields.map(getFieldTriples))
  mapped.filter(f => f.insertions).forEach(({ insertions: ins, deletions: dels, revs: rs, blocks: bs }) => {
    deletions.push(...dels)
    insertions.push(...ins)
    revs.push(...rs)
    blocks.push(...bs)
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
    if (field.name === '_id' || field.name === '_rev') return {}
    let value = obj[field.name]
    if (!value) return {}

    let pred = fieldPredicate(packageName, name, field.name, index.fieldVersions[field.name])

    let fieldInfo = index.fieldMap[field.name]
    // Should not be necessary to get this -- only needed for enums.
    let fieldIndex = fieldInfo ? self._getIndex(fieldInfo.packageName, fieldInfo.name) : null

    let triples = field.repeated ? value.map(makeTriples) : [makeTriples(value)]
    return triples

    async function makeTriples (value) {
      return new Promise((resolve, reject) => {
        if (fieldInfo && !fieldIndex.isEnum) {
          // This is a nested field -- recurse
          let triples = self._generateTriples(value, fieldInfo)
          triples.insertions.push({
            subject: rootRevs,
            predicate: pred,
            object: triples.rootRevs
          })
          return resolve(triples)
        } else if (field.type === 'Bytes') {
          let ptr = uuid()
          return resolve({
            insertions: [{
              subject: rootRevs,
              predicate: pred,
              object: ptr
            }],
            deletions: [],
            revs: [],
            blocks: [{
              key: ptr,
              value: value.content
            }]
          })
          // TODO: Finish content-based chunking/addressing
          /*
          let ptr = uuid()
          let blocks = []
          let insertions = []
          let chunkStream = rabin()
          let size = 0
          chunkStream.on('data', ({ length, offset, hash }) => {
            size += length
            let buf = Buffer.allocUnsafe(length)
            value.content.copy(buf, 0, offset, length)
            blocks.push({
              content: value,
              hash
            })
          })
          chunkStream.on('end', () => {
            insertions.push({
              subject: rootRevs,
              predicate: pred,
              object: ptr
            })
            return resolve({
              insertions,
              blocks,
              deletions: [],
              revs: []
            })
          })
          chunkStream.write(value.content)
          */
        }
        return resolve({
          insertions: [{
            subject: rootRevs,
            predicate: pred,
            object: value
          }],
          deletions: [],
          blocks: [],
          revs: []
        })
      })
    }
  }
}

TypeHandle.prototype.inflateObject = async function (rootId, rootRev) {
  let self = this
  let db = this.pkg.graph

  if (!rootId && !rootRev) throw new Error('Must specify an ID, a revision, or both.')

  // If the revision isn't specified, get the HEAD revisions for the given ID.
  var revs = [rootRev]
  let innerId = rootId
  if (!rootRev) {
    revs = (await db.search([{
      subject: rootId,
      predicate: SP_PREDS.HEAD,
      object: db.v('rev')
    }])).map(({ rev }) => rev)
    // If there isn't a latest revision, then this is an invalid root ID
    if (!revs.length) throw new Error(`Invalid object ID: ${rootId}`)
  } else if (!rootId) {
    let ids = (await db.search([{
      subject: db.v('id'),
      predicate: SP_PREDS.HEAD,
      object: rootRev
    }])).map(({ id }) => id)
    if (!ids.length) throw new Error(`Invalid object revision: ${rootRev}`)
    innerId = ids[0]
  }

  // If there are multiple latest revisions, then this is a conflict -- inflate all conflicts.
  return Promise.all(revs.map(rev => {
    return inflate(rev, this.name, this.packageName)
  }))

  async function inflate (rev, name, packageName) {
    let index = self._getIndex(packageName, name)
    let [deletions, rootFields, idForRev] = await Promise.all([
      db.get({
        subject: SP_SUBJECTS.DELETIONS,
        predicate: SP_PREDS.HAS,
        object: rev
      }),
      db.search({
        subject: rev,
        predicate: db.v('predicate'),
        object: db.v('object')
      }),
      db.search({
        subject: db.v('id'),
        predicate: SP_PREDS.HAS,
        object: rev
      })
    ])

    // Since each revision is created by a single writer, there cannot be a conflict here
    if (deletions.length > 1) return null
    if (idForRev.length > 1 || !idForRev.length) throw new Error('A revision must point to a single root IDs')

    let inflated = {
      _id: innerId,
      _revs: [rev]
    }

    let predicatesToMetadata = index.fields.reduce((acc, field) => {
      acc[fieldPredicate(packageName, name, field.name, index.fieldVersions[field.name])] = field
      return acc
    }, {})

    // Each field should be inflated concurrently.
    let fieldPromises = []
    for (let { predicate, object } of rootFields) {
      let field = predicatesToMetadata[predicate]
      if (!field) throw new Error(`Graph contains an invalid field link: ${predicate}`)

      let fieldInfo = index.fieldMap[field.name]
      // TODO: enums slow things down here...
      let fieldIndex = fieldInfo ? self._getIndex(fieldInfo.packageName, fieldInfo.name) : null

      const finish = (v) => {
        if (field.repeated) {
          if (!inflated[field.name]) inflated[field.name] = []
          inflated[field.name].push(v)
        } else {
          inflated[field.name] = v
        }
      }
      if (fieldInfo && !fieldIndex.isEnum) {
        fieldPromises.push(inflate(object, fieldInfo.name, fieldInfo.packageName).then(finish))
      } else {
        // TODO: respect field sizes
        if (field.type === 'Bytes') {
          return fieldPromises.push(self._loadBytes(object).then(finish))
        } else if (consts.NUMBER_TYPES.has(field.type)) object = +object
        finish(object)
      }
    }
    await Promise.all(fieldPromises)
    return inflated
  }
}

TypeHandle.prototype._loadBytes = async function (ptr) {
  let nodes = await this.fs.get(ptr)
  if (!nodes || !nodes.length) throw new Error(`Invalid pointer in _loadBytes: ${ptr}`)
  return nodes[0].value
}

TypeHandle.prototype.bind = function () {
  let app = this.pkg.app
  let name = this.name
  app.use(name, 'put', this.put.bind(this))
  app.use(name, 'get', this.get.bind(this))
  app.use(name, 'delete', this.delete.bind(this))
}

TypeHandle.prototype.put = async function (ctx) {
  let self = this
  this.log.debug('put request start')

  let putStream = through.obj(async function (chunk, enc, cb) {
    self.log.debug(`putting object: ${JSON.stringify(chunk)}`)
    try {
      let { insertions, deletions, revs, rootId, rootRevs } = self._generateTriples(chunk)

      // TODO: this should be atomic -- add a public `batch` method to hyper-graph-db
      await Promise.all([
        self.pkg.graph.del(deletions),
        self.pkg.graph.put(insertions),
        self.pkg.triggers.batch(revs)
      ])

      if (!(rootRevs instanceof Array)) rootRevs = [rootRevs]
      return cb(null, { _id: rootId, _revs: rootRevs })
    } catch (err) {
      console.log('err:', err)
      self.log.error(`put stream error: ${err}`)
      return cb(err)
    }
  })

  let metaStream = through.obj(function ({ _id, _revs }, enc, cb) {
    return cb(null, {
      id: {
        _id,
        _revs
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

TypeHandle.prototype.get = async function (ctx) {
  let self = this
  this.log.debug('get request start')

  let getStream = through.obj(async function ({ _id, _rev }, enc, cb) {
    try {
      self.log.debug(`inflating object with rootId: ${_id} at rev: ${_rev}`)
      let objs = await self.inflateObject(_id, _rev)
      self.log.debug(`inflated objects: ${JSON.stringify(objs)} with rootId: ${_id} at rev: ${_rev}`)
      let values = objs.reduce((acc, obj) => {
        acc.push({
          value: obj,
          id: {
            _id: obj._id,
            _revs: obj._revs
          }
        })
        return acc
      }, [])
      return cb(null, { values })
    } catch (err) {
      console.log('ERR:', err)
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

TypeHandle.prototype.delete = async function (ctx) {
  log.debug(`delete id: ${ctx.request.req}`)
}

function QueryHandle (pkg, name, typeIndex, metadata) {
  if (!(this instanceof QueryHandle)) return new QueryHandle(pkg, name, typeIndex, metadata)
  this.pkg = pkg
  this.name = name
  this.metadata = metadata
  this.log = logger([TAG, this.name].join(':'))

  let returnType = this.metadata.node.returns.name
  this.typeHandle = TypeHandle(this.pkg, returnType, typeIndex.types.get(returnType))

  let args = this.metadata.node.args
  this.argRegexes = null
  if (args && args.length) {
    this.argRegexes = new Map()
    for (let arg of args) {
      this.argRegexes.set(arg.paramName.name, new RegExp('\\?' + arg.paramName.name, 'g'))
    }
  }

  let app = this.pkg.app
  app.use('query', name, this.query.bind(this))
}

QueryHandle.prototype._compile = function (req) {
  let query = this.metadata.query
  if (this.argRegexes) {
    for (let [name, regex] of this.argRegexes) {
      // TODO: two things:
      //  1) this is a hot path, so this replacement needs to be as optimized as possible (it isn't now)
      //  2) Only allowing queries by the first _rev is not ideal -- might want to search over other rev or id
      query = query.replace(regex, `'${req[name]._revs[0]}'`)
    }
  }
  return query
}

QueryHandle.prototype.query = async function (ctx) {
  log.debug(`query received with request ${ctx.req}`)
  var query = this.metadata.query
  if (this.metadata.node.args.length) {
    query = this._compile(ctx.req)
  }
  let searchResults = await this.pkg.graph.query(query)
  let inflated = []
  for (let result of searchResults) {
    // TODO: support multiple object types in one response
    // TODO: lookup the type by query variable position
    let values = Object.values(result)
    inflated.push(await this.typeHandle.inflateObject(null, values[0]))
  }

  let response = {
    values: [].concat(...inflated)
  }
  log.debug(`  search result: ${JSON.stringify(response)}`)
  ctx.res = response
}

function TriggerHandle (pkg, name, typeIndex, metadata) {
  if (!(this instanceof TriggerHandle)) return new TriggerHandle(pkg, name, typeIndex, metadata)
  this.pkg = pkg
  this.name = name
  this.metadata = metadata
  this.log = logger([TAG, this.name].join(':'))

  this.triggers = this.pkg.triggers

  // hack
  this.selector = JSON5.parse(`{${this.metadata.node.body}}`).selector
  this.lastVersion = null

  // Set when trigger is bound.
  this.streams = []

  let app = this.pkg.app
  app.use('trigger', name, this.trigger.bind(this))
}

TriggerHandle.prototype._notify = function ([inflated]) {
  // TODO: only notifying of the first version -- should be fine since this is revision-based.
  if (!matchesSelector(inflated, this.selector)) return
  this.streams.forEach(s => s.push(inflated))
}

TriggerHandle.prototype.trigger = async function (ctx) {
  this.log.debug(`starting trigger for type ${this.returnType} with selector ${JSON.stringify(this.selector)}`)
  let triggerStream = new stream.PassThrough({ objectMode: true })
  let remove = () => {
    // TODO: None of these trigger an 'end' event on the client...
    ctx.req.destroy()
    ctx.res.destroy()
    triggerStream.destroy()
    let idx = this.streams.indexOf(ctx.res)
    if (idx > -1) {
      this.streams.splice(idx, 1)
    }
  }

  ctx.res = triggerStream
  ctx.req.on('end', remove)
  ctx.req.on('error', err => {
    this.log.error(`trigger response stream errored: ${err}`)
    remove()
  })
  this.streams.push(triggerStream)
}

function isRecord (idx) {
  if (!idx.node) return false
  if (idx.node.nodeType === 'enum') return false
  if (idx.node.signature.isStruct) return false
  if (idx.node.signature.isAction) return false
  return true
}
