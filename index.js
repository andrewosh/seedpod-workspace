const events = require('events')
const inherits = require('inherits')

const protoSchema = require('protocol-buffers-schema')
const asyncMap = require('async-each')
const through = require('through2')
const pumpify = require('pumpify')
const duplexify = require('duplexify')
const maybe = require('call-me-maybe')
const pify = require('pify')

const Graph = require('hyper-graph-db')
const PackageManager = require('./lib/packages')
const RecordManager = require('./lib/records')
const { logger } = require('./lib/util')

const naming = require('./lib/naming')

let log = logger('main')

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

/*
 * Create multiple types from a protocol buffer schema. This enables `insert`, `delete`,
 * `get`, and graph operations over those types.
 *
 * Additionally, these types can be shared with other filesystems via importing.
 *
 * Types will be implicitly versioned based on a backwards-compatibility check.
 * If a new type with the same name either:
 *   a) Modifies the type for an existing tag
 *   b) Changes an optional type to a required type
 * then the new type will be assigned a new major version.
 *
 * If neither of those conditions are true, then the new type will be given a
 * new minor version.
 */
TypedHyperDB.prototype.registerTypes = async function (schema, opts, cb) {
  if (typeof opts === 'function') return this.registerTypes(schema, null, opts)
  opts = opts || {}
  var self = this

  // TODO: Better copy?
  var original = protoSchema.parse(schema)
  var transformed = protoSchema.parse(schema)

  var packageName = transformed.package

  return maybe(cb, new Promise((resolve, reject) => {
    // 1) Get version by checking for conflicts with an existing version.
    // 2) If no existing version, then the version is 1.0
    // 3) After the version bump, register each individual type.
    self._getSchema(packageName, function (err, schema, packageVersion) {
      if (err) return cb(err)
      asyncMap(transformed.messages, function (message, next) {
        return self._registerType(original, {
          name: message.name,
          packageName: packageName,
          // Set in _registerType.
          version: null,
          packageVersion: (packageVersion) ? { major: packageVersion.major + 1 } : { major: 1 },
          // Populated in _registerType.
          fieldTypeMap: {},
          message: message
        }, next)
      }, function (err, versions) {
        if (err) return reject(err)
        self._registerPackage(packageName, transformed, original, function (err, packageVersion) {
          if (err) return reject(err)
          var typesToVersions = {}
          for (var i = 0; i < versions.length; i++) {
            typesToVersions[transformed.messages[i].name] = versions[i]
          }
          return resolve(typesToVersions)
        })
      })
    })
  }))
}

// TODO: Deduplicate code between this and createReadStream.
TypedHyperDB.prototype.createDiffStream = async function (typeName, opts) {
  opts = opts || {}
  var self = this

  var typeInfo = Type.getInfo(typeName)
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
