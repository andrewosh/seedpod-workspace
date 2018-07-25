const codecs = require('codecs')
const protoSchema = require('protocol-buffers-schema')
const datEncoding = require('dat-encoding')

const { parse, compile } = require('../compiler')
const indexTypes = require('../types')
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
      console.log('GOT:', key, 'NODES', nodes)
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
  console.log('loading manifest for key:', key, 'and version:', version)
  let path = version ? naming.remoteVersionManifest(key, version) : naming.remoteRootManifest(key)
  console.log('MANIFEST PATH:', path)
  return this._getNoConflict(path, codecs('json'))
}

PackageManager.prototype._install = async function (key, packageVersion, opts) {
  // If the manifest is passed as an option, do not remount.
  opts = opts || {}
  var manifest = opts.manifest

  console.log('in _install for key:', key, 'packageVersion:', packageVersion, 'opts:', opts)

  // If the manifest isn't specified, then this is a remote dependency installation.
  if (!manifest) {
    manifest = await this._loadManifest(key)

    console.log('LOADED MANIFEST:', manifest)
    // Read the version map, and mount the checkout corresponding to the specified version.
    let versionMap = manifest.versionMap
    let version = packageVersion ? versionMap[packageVersion] : versionMap[manifest.version]

    if (!version) throw new Error(`Invalid package version: ${packageVersion}`)

    // First, mount the checkout at <package>/<tag>/db (will prevent cycles in the next step).
    console.log('MOUNTING KEY:', datEncoding.decode(key), 'at:', naming.packageMount(key, packageVersion))
    await this.db.mount(datEncoding.decode(key), naming.packageMount(key, packageVersion), {
      version: Buffer.from(version, 'base64')
    })
  }

  // Recursively install any missing dependencies.
  // dependencies must take the form: [{ name: "", key: "", version: ""}]
  let dependencies = manifest.dependencies
  var dependencyMap
  if (dependencies) {
    dependencyMap = new Map()
    for (let depName of Object.keys(dependencies)) {
      let dep = dependencies[depName]
      let key = datEncoding.encode(dep.key)
      dependencyMap.set(dep.name, { key, version: dep.version })
      // If the dependency has already been installed, do not re-install (prevents cycles).
      let existingManifest = await this._loadManifest(key, dep.version)
      if (!existingManifest) {
        await this.install(key, dep.version)
      }
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
  console.log('dependencies:', dependencies)

  let schemas = {}
  for (let depName of Object.keys(dependencies)) {
    let dep = dependencies[depName]
    let schema = await this._getNoConflict(naming.schema(dep.key, dep.version), codecs('json'))
    let ast = await this._getNoConflict(naming.ast(dep.key, dep.version), codecs('json'))
    schemas[depName] = [
      schema,
      ast,
      this._indexAST(ast)
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
PackageManager.prototype._indexAST = function (ast) {
  let index = new Map()
  let filtered = ast.filter(n => (n.nodeType === 'type') || (n.nodeType === 'sparql'))
  for (let node of filtered) {
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
  console.log('in install for key:', key, 'tag:', tag, 'opts:', opts)
  opts = opts || {}

  // If the manifest was specified in the options, then this is a local installation
  // (aliases must be created).
  if (opts.manifest) opts.local = true

  if (!key && !opts.manifest) throw new Error('Must specify either a key or a manifest.')
  if (key && !opts.local) {
    await this.db.mount(datEncoding.decode(key), naming.globalMount(key))
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

PackageManager.prototype.export = async function (pkg, pkgVersion) {
  let manifestPath = pkgVersion ? naming.manifest(pkg, pkgVersion) : naming.localManifest()
  let interfacePath = pkgVersion ? naming.interface(pkg, pkgVersion) : naming.localInterface()
  let schemaPath = pkgVersion ? naming.schema(pkg, pkgVersion) : naming.localSchema()
  let typeIndexPath = pkgVersion ? naming.typeIndex(pkg, pkgVersion) : naming.localTypeIndex()

  return {
    manifest: await this._getNoConflict(manifestPath, codecs('json')),
    interface: await this._getNoConflict(interfacePath, codecs('utf8')),
    schema: await this._getNoConflict(schemaPath, codecs('json')),
    typeIndex: await this._getNoConflict(typeIndexPath, codecs('json'))
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
  let lastSchema = lastVersion ? await this._getNoConflict(naming.localVersionSchema(lastVersion)) : null

  // First extract the aliases from app.spdl (these are necessary pre-installation)
  let { tree: ast, aliases } = parse(iface)
  manifest.aliases = aliases

  // Next, do the local installation so that all dependencies are linked.
  await this.install('local', tag, { manifest })
  let dependentIndexes = await this._getDependentIndexes(manifest)
  let selfIndex = this._indexAST(ast)

  // Next, compiled the parsed interface file into a protobuf schema with aliases resolved.
  let schema = await compile(dependentIndexes, selfIndex, aliases, ast, manifest)

  // TODO: implement type versioning
  let typeIndex = await indexTypes(manifest.name, aliases, selfIndex, lastSchema, schema) || {}

  await this.db.batch([
    { key: naming.localSchema(), value: codecs('json').encode(schema) },
    { key: naming.localManifest(), value: codecs('json').encode(manifest) },
    { key: naming.localAST(), value: codecs('json').encode(ast) },
    { key: naming.localTypeIndex(), value: codecs('json').encode(typeIndex) }
  ])

  // Add the newly-published database version to the package's version map.
  let version = await this.db.version()

  manifest.versionMap = manifest.versionMap || {}
  manifest.versionMap[tag] = version.toString('base64')
  manifest.version = tag

  await this.db.put(naming.localManifest(), codecs('json').encode(manifest))
}
