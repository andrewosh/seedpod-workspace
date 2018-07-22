const codecs = require('codecs')
const protoSchema = require('protocol-buffers-schema')

const { parse, compile } = require('../compiler')
const versionTypes = require('../versioner')
const naming = require('./naming')

module.exports = PackageManager

function PackageManager (db) {
  if (!(this instanceof PackageManager)) return new PackageManager(db)
  this.db = db

  // TODO: replace with an LRU cache.
  // TODO: re-add caching.
  this._schemas = {}
  this._types = {}
}

/*
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
*/

PackageManager.prototype._getNoConflict = async function (key, encoding) {
  return new Promise((resolve, reject) => {
    this.db.get(key, (err, nodes) => {
      if (err) return reject(err)
      if (!nodes) return resolve(null)
      if (nodes.length > 1) {
        return reject(new Error('Aborting installation due to conflict in key:', key))
      }
      return resolve(encoding ? encoding.decode(nodes[0].value) : nodes[0].value)
    })
  })
}

PackageManager.prototype._loadManifest = async function (key, version) {
  let path = version ? naming.remoteVersionManifest(key, version) : naming.manifest(key)
  return this._getNoConflict(path, codecs('json'))
}

PackageManager.prototype._install = async function (key, packageVersion, opts) {
  // If the manifest is passed as an option, do not remount.
  opts = opts || {}
  var manifest = opts.manifest

  // If the manifest isn't specified, then this is a remote dependency installation.
  if (!manifest) {
    manifest = await this._loadManifest(key)

    // Read the version map, and mount the checkout corresponding to the specified version.
    let versionMap = manifest.versionMap
    let version = packageVersion ? versionMap[packageVersion] : versionMap[manifest.version]

    if (!version) throw new Error(`Invalid package version: ${packageVersion}`)

    // First, mount the checkout at <package>/<tag>/db (will prevent cycles in the next step).
    await this.db.mount(key, naming.packageMount(key, version.tag), {
      version: version.checkout
    })
  }

  // Recursively install any missing dependencies.
  // dependencies must take the form: [{ name: "", key: "", version: ""}]
  let dependencies = manifest.dependencies
  if (dependencies instanceof Array) {
    let dependencyMap = new Map()
    for (let dep of dependencies) {
      dependencyMap.set(dep.name, { key: dep.key, version: dep.version })
      // If the dependency has already been installed, do not re-install (prevents cycles).
      let existingManifest = await this._loadManifest(dep.key, dep.version)
      if (!existingManifest) {
        await this._install(dep.key, dep.version)
      }
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
    let encoding = codecs('utf8')
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
  if (!dependencies) return []

  let schemas = {}
  for (let dep of dependencies) {
    let schema = protoSchema.parse(await this._getNoConflict(naming.schema(dep.name, dep.version), codecs('utf8')))
    let ast = await this._getNoConflict(naming.ast(dep.name, dep.version), codecs('json'))
    let parsed = protoSchema.parse(schema)
    schemas[dep.name] = [
      parsed,
      ast,
      this._indexSchema(ast)
    ]
  }
  return schemas
}

/**
 * Create an index that maps type/service names to their corresponding AST nodes + protobuf messages.
 *
 * The mapping takes the form: name -> { schema: <protobuf message>, node: <AST node>}
 *
 * @param {object} ast - A dependency's .spdl AST (json)
 * @returns {object} An AST index
 */
PackageManager.prototype._indexSchema = function (ast) {
  let index = new Map()
  for (let node of ast) {
    node = node[0]
    let name = node.name || node.signature.typeName
    let idx = index.get(name)
    if (!idx) idx = { type: node.nodeType }
    idx.node = node
    index.set(name, idx)
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

PackageManager.prototype.update = async function (iface, manifest) {
  if (typeof manifest === 'string') manifest = JSON.parse(manifest)
  return new Promise((resolve, reject) => {
    this.db.batch([
      { key: naming.localInterface(), value: codecs('utf8').encode(iface) },
      { key: naming.localManifest(), value: codecs('json').encode(manifest) }
    ], err => {
      if (err) return reject(err)
      return resolve()
    })
  })
}

PackageManager.prototype.getLatestPackageFiles = async function () {
  return {
    manifest: await this._getNoConflict(naming.localManifest(), codecs('json')),
    interface: await this._getNoConflict(naming.localInterface(), codecs('utf8')),
    schema: await this._getNoConflict(naming.localSchema(), codecs('utf8'))
  }
}

PackageManager.prototype.publish = async function (tag, opts) {
  // 1) Read in manifest, the local schema, and the schema for the last published version.
  // 2) Load all dependent schemas (aliases are already resolved).
  // 2) Update any modified type definitions.
  // 3) Create the transformed schema.
  // 4) Add a mapping in the version map for the new schema.
  let iface = await this._getNoConflict(naming.localInterface(), codecs('utf8'))
  let manifest = await this._getNoConflict(naming.localManifest(), codecs('json'))

  let lastVersion = manifest.version
  let lastSchema = lastVersion ? await this._getNoConflict(naming.schema('local', lastVersion)) : null

  // First extract the aliases from app.spdl (these are necessary pre-installation)
  let { tree: parsed, aliases } = parse(iface)
  manifest.aliases = aliases

  // Next, do the local installation so that all dependencies are linked.
  await this._install('local', tag, { manifest })
  let dependentIndexes = await this._getDependentIndexes(manifest)
  let selfIndex = this._indexSchema(parsed)

  // Next, compiled the parsed interface file into a protobuf schema with aliases resolved.
  let schema = await compile(dependentIndexes, selfIndex, aliases, parsed, manifest)
  console.log('schema:', schema)

  // TODO: implement type versioning
  let typeIndex = await versionTypes(this, lastSchema, schema) || {}
  console.log('typeIndex:', typeIndex)

  await this.db.batch([
    { key: naming.localSchema(), value: codecs('utf8').encode(schema) },
    { key: naming.localManifest(), value: codecs('json').encode(manifest) },
    { key: naming.localAST(), value: codecs('json').encode(parsed) },
    { key: naming.localTypeIndex(), value: codecs('json').encode(typeIndex) }
  ])

  // Add the newly-published database version to the package's version map.
  let version = await this.db.version()

  manifest.versionMap = manifest.versionMap || {}
  manifest.versionMap[tag] = version.toString('base64')
  manifest.version = tag
  console.log('MANIFEST:', manifest)

  await this.db.put(naming.localManifest(), codecs('json').encode(manifest))
}
