const protoSchema = require('protocol-buffers-schema')
const Mali = require('mali')
const tmp = require('tmp-promise')
const fs = require('fs-extra')
const through = require('through2')
const pump = require('pump')
const uuid = require('uuid/v4')

const { logger } = require('../util')
const TAG = 'records:handle'
let log = logger(TAG)

module.exports = PackageHandle

function PackageHandle (graph, schema, typeIndex) {
  if (!(this instanceof PackageHandle)) return new PackageHandle(graph, schema, typeIndex)
  this.graph = graph
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
      let { triples, rootId } = self._generateTriples(chunk)
      self.log.debug(`generated triples: ${triples} with rootId: ${rootId}`)
      await self.pkg.graph.put(triples)
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
  log.debug(`get id: ${ctx.request.req}`)
}

TypeHandle.prototype._delete = async function (ctx) {
  log.debug(`delete id: ${ctx.request.req}`)
}

TypeHandle.prototype._generateTriples = function (obj, typeName, typeIndex) {
  return {
    triples: [],
    rootId: uuid()
  }
}

TypeHandle.prototype._getAllTriples = async function (id, typeName, typeIndex) {
  return []
}
