var p = require('path')

function getPackageName (key, pkgVersion) {
  return p.join(exports.PACKAGE_ROOT, key, 'versions', pkgVersion)
}

function getSchemaName (pkg, pkgVersion, schemaVersion) {
  return p.join(getPackageName(pkg, pkgVersion), 'schemas', '' + schemaVersion)
}

function getTypeName (pkg, pkgVersion, type, version) {
  return p.join(getPackageName(pkg, pkgVersion), 'types', type, '' + version)
}

function getTypeMetadataName (pkg, pkgVersion, type) {
  return p.join(getPackageName(pkg, pkgVersion), 'types', type)
}

function getPackageMount (pkg, pkgVersion) {
  return p.join(getPackageName(pkg, pkgVersion), 'db')
}

function getAlias (pkg, pkgVersion, aliasName) {
  return p.join(getPackageName(pkg, pkgVersion), 'aliases', aliasName)
}

function getLocalPackage (key) {
  return p.join(getMountName(key), 'local')
}

function getRootManifest (key) {
  return p.join(getMountName(key), 'local', 'manifest.json')
}

function getVersionManifest (key, pkgVersion) {
  return p.join(getPackageMount(key, pkgVersion), 'local', 'manifest.json')
}

function getGlobalMount (key) {
  return p.join(exports.MOUNT_ROOT, key)
}

module.exports.type = getTypeName
module.exports.typeMetadata = getTypeMetadataName
module.exports.package = getPackageName
module.exports.schema = getSchemaName
module.exports.record = getRecordName

module.exports.packageMount = getPackageMount
module.exports.alias = getPackageAlias
module.exports.local = getLocalPackage
module.exports.globalMount  = getGlobalMount
module.exports.rootManifest = getRootManifest
module.exports.versionManifest = getVersionManifest

module.exports.MOUNT_ROOT = '/dbs'
module.exports.PACKAGE_ROOT = '/packages'
