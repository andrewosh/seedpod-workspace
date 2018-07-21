const codecs = require('codecs')
const protoSchema = require('protocol-buffers-schema')

const { parse, compile } = require('../compiler')
const versionTypes = require('../versioner')
const naming = require('./naming')
const messages = require('./messages')

module.exports = PackageManager

function PackageManager (db) {
  if (!(this instanceof PackageManager)) return new PackageManager(db)
  this.db = db

  // TODO: replace with an LRU cache.
  // TODO: re-add caching.
  this._schemas = {}
  this._types = {}
}

PackageManager.prototype._registerPackage = async function (pkgName, pkgVersion, transformed, original) {
  var self = this

  var packagePath = naming.package(packageName)

  this._getSchema(packageName, function (err, schema, version) {
    if (err) return cb(err)
    return register((version) ? version.major : 0)
  })

  function register (lastVersion) {
    // TODO: This should be transactional.
    var version = { major: lastVersion + 1 }
    var schemaPath = naming.schema(packageName, version.major)

    self.db.put(schemaPath, messages.PackageRecord.encode({
      name: packageName,
      transformed: JSON.stringify(transformed),
      original: JSON.stringify(original),
      version: version
    }), function (err) {
      if (err) return cb(err)
      var encoded = messages.PackageMetadata.encode({
        latest: version
      })
      self.db.put(packagePath, encoded, function (err) {
        if (err) return cb(err)
        return cb(null, version)
      })
    })
  }
}

PackageManager.prototype._getNoConflict = async function (key, encoding) {
  let nodes = await this.db.get(key)
  if (!nodes) return null
  if (nodes.length > 1) {
    throw new Error('Aborting installation due to conflict in key:', key)
  }
  return encoding.decode(nodes[0].value)
}

PackageManager.prototype._loadManifest = async function (key, version) {
  let path = version ? naming.remoteVersionManifest(key, version) : naming.manifest(key)
  return this._getNoConflict(path, codecs('json'))
}

PackageManager.prototype._install = async function (key, packageVersion, opts) {
  // If the manifest is passed as an option, do not remount.
  opts = opts || {}
  var manifest = opts.manifest

  if (!manifest) {
    manifest = await this._loadManifest(key)
  }

  // Read the version map, and mount the checkout corresponding to the specified version.
  let versions = manifest.versions
  var version
  if (!packageVersion) {
    version = versions[0]
  } else {
    version = versions.filter(v => v.tag === packageVersion)[0]
  }
  if (!version) throw new Error(`Invalid package version: ${packageVersion}`)

  // First, mount the checkout at <package>/<tag>/db (will prevent cycles in the next step).
  await this.db.mount(key, naming.packageMount(key, version.tag), {
    version: version.checkout
  })

  // Recursively install any missing dependencies.
  // dependencies must take the form: [{ name: "", key: "", version: ""}]
  let dependencies = manifest.dependencies
  let dependencyMap = new Map()
  for (let dep of dependencies) {
    let dep = dependencies[i]
    dependencyMap.set(dep.name, { key: dep.key, version: dep.version })
    // If the dependency has already been installed, do not re-install (prevents cycles).
    let existingManifest = await this._loadManifest(dep.key, dep.version)
    if (!existingManifest) {
      await this._install(dep.key, dep.version)
    }
  }

  // If this is a local installation, create the aliases.
  // Aliases can only refer to a type within a package.
  // Aliases must take the form:
  // [
  //  { name: "", packageName: "", alias: "" },
  //  ...
  // ]
  if (opts.local) {
    let aliases = manifest.aliases
    let encoding = codecs('utf-8')
    for (let alias of aliases) {
      let tag = dependencyMap.get(alias.packageName).version
      let pointer = naming.typeMetadata(alias.packageName, tag, alias.name)
      await this.db.put(naming.alias('local', version.tag, alias.alias), encoding.encode(pointer))
    }
  }
}

/**
 * Loads all dependent schemas/ASTs for a given package.
 *
 * @param {string} manifest - The decoded manifest file for a package.
 * @returns {Object} A mapping from dependency name to the dependency's parsed AST, schema, and schema index.
 */
PackageManager.prototype._getDependentIndexes = async function (manifest) {
  let dependencies = manifest.dependencies
  let schemas = {}
  for (let dep of dependencies) {
    let schema = protoSchema.parse(await this._getNoConflict(naming.schema(dep.name, dep.version), codecs('utf-8')))
    let ast = await this._getNoConflict(naming.ast(dep.name, dep.version), codecs('json'))
    let parsed = protoSchema.parse(schema)
    schemas[dep.name] = [
      parsed,
      ast,
      this._indexSchema(parsed, ast)
    ]
  }
  return schemas
}

/**
 * Create an index that maps type/service names to their corresponding AST nodes + protobuf messages.
 *
 * The mapping takes the form: name -> { schema: <protobuf message>, node: <AST node>}
 *
 * @param {object} schema - A dependency's parsed protobuf schema (json)
 * @param {object} ast - A dependency's .spdl AST (json)
 * @returns {object} A schema/AST index
 */
PackageManager.prototype._indexSchema = function (schema, ast) {
  let index = new Map()
  let roots = ['enums', 'messages', 'services']
  for (let root of roots) {
    for (let item of schema[root]) {
      index.set(item.name, { type: root, schema: item })
    }
  }
  for (let node of ast) {
    node = node[0]
    let idx = index.get(node.name)
    idx.node = node
  }
  return index
}

PackageManager.prototype.install = async function (key, tag, opts) {
  // 1) If key is specified, mount the key (without a version)
  // 2) Read the manifest (describes aliases, deps, and the version map)
  //    (either from the key, or from the opt)
  // 3) _install (this will recursively install all dependencies)
  opts = opts || {}

  // If the manifest was specified in the options, then this is a local installation
  // (aliases must be created).
  if (opts.manifest) opts.local = true

  if (!key && !opts.manifest) throw new Error('Must specify either a key or a manifest.')
  if (key) {
    await this.db.mount(key, naming.globalMount(key))
  }
  return this._install(key, tag, opts)
}

PackageManager.prototype.import = async function (iface, manifest) {
  await this.db.batch([
    { key: naming.localInterface(), value: codecs('utf-8').encode(iface) },
    { key: naming.localManifest(), value: codecs('json').encode(manifest) }
  ])
}

PackageManager.prototype.publish = async function (tag, opts) {
  // 1) Read in manifest, the local schema, and the schema for the last published version.
  // 2) Load all dependent schemas (aliases are already resolved).
  // 2) Update any modified type definitions.
  // 3) Create the transformed schema.
  // 4) Add a mapping in the version map for the new schema.
  let iface = await this._getNoConflict(naming.localInterface())
  let manifest = await this._getNoConflict(naming.localManifest())

  // First extract the aliases from app.spdl (these are necessary pre-installation)
  let { parsed, aliases } = parse(iface)
  manifest.aliases = aliases

  // Next, do the local installation so that all dependencies are linked.
  await this._install(null, tag, { manifest })
  let dependentIndexes = await this._getDependentIndexes(manifest)
  let selfIndex = this._indexSchema(parsed)

  // Next, compiled the parsed interface file into a protobuf schema with aliases resolved.
  let schema = await compile(this, dependentIndexes, selfIndex, aliases, iface, manifest)

  // TODO: implement type versioning
  let typeIndex = await versionTypes(this, lastSchema, schema)

  await this.db.batch([
    { key: naming.localSchema(), value: codecs('utf8').encode(schema) },
    { key: naming.localManifest(), value: codecs('json').encode(manifest) },
    { key: naming.localAST(), value: codecs('json'.encode(parsed)) },
    { key: naming.localTypeIndex(), value: codecs('json').encode(typeIndex) }
  ])

  // Add the newly-published database version to the package's version map.
  let version = await this.db.version()

  manifest.versionMap = manifest.versionMap || {}
  manifest.versionMap[tag] = version.toString('base64')

  await this.db.put(naming.localManifest(), codecs('json').encode(manifest))
}
