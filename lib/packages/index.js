const codecs = require('codecs')

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
  let path = version ? naming.versionManifest(key, version) : naming.manifest(key)
  return this._getNoConflict(path, codecs('json'))
}

PackageManager.prototype._install = async function (key, packageVersion, opts) {
  // If the manifest is passed as an option, do not remount.
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
  for (var i = 0; i < dependencies.length; i++) {
    let dep = dependencies[i]
    // If the dependency has already been installed, do not reinstall (prevents cycles).
    let existingManifest = await this._loadManifest(dep.key, dep.version)
    if (!existingManifest) {
      await this._install(dep.key, dep.version)
    }
  }

  // If this is a local installation, create the aliases.
  // Aliases can either refer to a package, or to a type within a package.
  // Aliases must take the form:
  // [
  //  { name: "", package: "", tag: "", type: "" },
  //  ...
  // ]
  if (opts.local) {
    let aliases = manifest.aliases
    let encoding = codecs('utf-8')
    for (var i = 0; i < aliases.length; i++) {
      let alias = aliases[i]
      var pointer
      if (alias.type) {
        pointer = naming.typeMetadata(alias.package, alias.tag, alias.type)
      } else {
        pointer = naming.package(alias.package, alias.tag)
      }
      await this.db.put(naming.alias('local', version.tag, alias.name), encoding.encode(pointer))
    }
  }
}

PackageManager.prototype.install = async function (key, tag, opts) {
  // 1) If key is specified, mount the key (without a version)
  // 2) Read the manifest (describes aliases, deps, and the version map)
  //    (either from the key, or from the opt)
  // 3) _install (this will recursively install all dependencies)
  opts = opts || {}
  var manifest = opts.manifest

  // If the manifest was specified in the options, then this is a local installation
  // (aliases must be created).
  if (manifest) opts.local = true

  if (!key && !manifest) throw new Error('Must specify either a key or a manifest.')
  if (key) {
    await this.db.mount(key, naming.globalMount(key))
  }
  return this._install(key, tag, opts)
}

PackageManager.prototype.publish = async function (opts) {
  // 1) Read in manifest, the local schema, and the schema for the last published version.
  // 2) Load all dependent schemas (aliases are already resolved).
  // 2) Update any modified type definitions.
  // 3) Create the transformed schema.
  // 4) Add a mapping in the version map for the new schema.
}
