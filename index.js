const events = require('events')
const inherits = require('inherits')

const through = require('through2')
const pumpify = require('pumpify')
const duplexify = require('duplexify')
const maybe = require('call-me-maybe')
const pify = require('pify')

const Graph = require('hyper-graph-db')
const PackageManager = require('./lib/packages')
const RecordManager = require('./lib/records')

const naming = require('./lib/naming')

module.exports = TypedHyperDB

function TypedHyperDB (db, opts) {
  if (!(this instanceof TypedHyperDB)) return new TypedHyperDB(db, opts)
  this.opts = opts || {}
  this.db = db

  // Set in ready
  this.key = null
  this.graph = null
  this.packages = null
  this.records = null
  this.triggers = null
  this.fs = null

  this._unwatch = null

  this._ready = new Promise(async (resolve, reject) => {
    try {
      await this.db.ready()
      this.key = this.db.key

      this.graph = pify(Graph(await this.db.sub(naming.GRAPH_ROOT)), {
        include: ['put', 'get', 'del']
      })
      this.triggers = await this.db.sub(naming.TRIGGERS_ROOT)
      this.fs = await this.db.sub(naming.FS_ROOT)
      this.packages = PackageManager(await this.db.sub(naming.PACKAGE_ROOT))
      this.records = RecordManager(this.graph, this.triggers, this.fs, this.packages)

      await this.graph.db.index()
      await this.fs.index()

      return resolve()
    } catch (err) {
      return reject(err)
    }
  })

  this.ready = async function (cb) {
    await this._ready
    if (cb) return process.nextTick(cb)
  }
}
inherits(TypedHyperDB, events.EventEmitter)

// BEGIN Public API

TypedHyperDB.prototype.updatePackage = async function (iface, manifest) {
  await this.ready()
  return this.packages.update(iface, manifest)
}

TypedHyperDB.prototype.publish = async function (tag, opts) {
  await this.ready()
  return this.packages.publish(tag, opts)
}

TypedHyperDB.prototype.bind = async function (packageName, packageVersion) {
  await this.ready()
  let port = await this.records.bind(packageName, packageVersion)
  return port
}

TypedHyperDB.prototype.install = async function (key, tag, opts) {
  await this.ready()
  await this.packages.install(key, tag, opts)
}

// TODO: Deduplicate code between this and createReadStream.
// TODO: reimplemeent. currently broken.
TypedHyperDB.prototype.createDiffStream = async function (typeName, opts) {
  opts = opts || {}
  var self = this

  // TODO
  // var typeInfo = Type.getInfo(typeName)
  var typeInfo = null

  var stream = duplexify.obj()
  stream.pause()
  stream.setWritable(null)

  let [innerType, schema] = await this._getTypeAndSchema(typeInfo)

  var root = naming.recordsRoot(innerType.packageName, innerType.name, innerType.version.major)
  var decoderStream = await decoder(innerType, schema[innerType.name])
  var diffStream = this.db.createDiffStream(opts.since, root)
  stream.setReadable(pumpify.obj(diffStream, decoderStream))
  stream.resume()

  async function decoder (type, encoding) {
    return through.obj(async ({ left, right }, enc, cb) => {
      if (left) {
        for (var i = 0; i < left.length; i++) {
          left[i] = await inflate(left[i])
        }
      }
      if (right) {
        for (i = 0; i < right.length; i++) {
          right[i] = await inflate(right[i])
        }
      }
      return cb(null, { left, right })
    })

    async function inflate (node) {
      return new Promise((resolve, reject) => {
        self._inflateNode(type, encoding, node, (err, inflated) => {
          if (err) return reject(err)
          return resolve(inflated)
        })
      })
    }
  }

  return stream
}

TypedHyperDB.prototype.fork = async function (cb) {
  return maybe(cb, new Promise((resolve, reject) => {
    this.db.fork((err, fork) => {
      if (err) return reject(err)
      return resolve(TypedHyperDB(fork, this.opts))
    })
  }))
}

TypedHyperDB.prototype.version = async function (cb) {
  return maybe(cb, new Promise((resolve, reject) => {
    this.db.version((err, version) => {
      if (err) return reject(err)
      return resolve(version)
    })
  }))
}

TypedHyperDB.prototype.authorize = function (key) {
  return this.db.authorize(key)
}
