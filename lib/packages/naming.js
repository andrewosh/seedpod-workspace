var p = require('path')

function getPackageName (key, pkgVersion) {
  return p.join(exports.PACKAGE_ROOT, key, 'versions', pkgVersion)
}

function getPackageMount (pkg, pkgVersion) {
  return p.join(getPackageName(pkg, pkgVersion), 'db', exports.PACKAGE_ROOT, 'local')
}

function getSchemaName (pkg, pkgVersion, schemaVersion) {
  return p.join(getPackageMount(pkg, pkgVersion), 'schemas', '' + schemaVersion)
}

function getTypeName (pkg, pkgVersion, type, version) {
  return p.join(getPackageMount(pkg, pkgVersion), 'types', type, '' + version)
}

function getTypeMetadataName (pkg, pkgVersion, type) {
  return p.join(getPackageMount(pkg, pkgVersion), 'types', type)
}

function getAlias (pkg, pkgVersion, aliasName) {
  return p.join(getPackageMount(pkg, pkgVersion), 'aliases', aliasName)
}

function getGlobalMount (key) {
  return p.join(exports.MOUNT_ROOT, key)
}

function getRemotePackageRoot (key) {
  return p.join(getGlobalMount(key), exports.PACKAGE_ROOT, 'local')
}

function getRemoteRootManifest (key) {
  return p.join(getRemotePackageRoot(key), 'manifest.json')
}

function getRemoteVersionManifest (key, pkgVersion) {
  return p.join(getPackageMount(key, pkgVersion), 'manifest.json')
}

function getLocalPackageRoot () {
  return p.join(exports.PACKAGE_ROOT, 'local')
}

function getLocalRootManifest () {
  return p.join(getLocalPackageRoot(), 'manifest.json')
}

function getLocalRootInterface () {
  return p.join(getLocalPackageRoot(), 'app.spdl')
}

function getLocalVersionManifest (pkgVersion) {
  return p.join(getPackageMount('local', pkgVersion), 'manifest.json')
}

function getLocalVersionInterface (pkgVersion) {
  return p.join(getPackageMount('local', pkgVersion), 'app.spdl')
}

module.exports.type = getTypeName
module.exports.typeMetadata = getTypeMetadataName
module.exports.package = getPackageName
module.exports.schema = getSchemaName

module.exports.globalMount = getGlobalMount
module.exports.packageMount = getPackageMount
module.exports.alias = getAlias

module.exports.local = getLocalPackageRoot
module.exports.localManifest = getLocalRootManifest
module.exports.localVersionManifest = getLocalVersionManifest
module.exports.localInterface = getLocalRootInterface
module.exports.localVersionInterface = getLocalVersionInterface

module.exports.remoteRootManifest = getRemoteRootManifest
module.exports.remoteVersionManifest = getRemoteVersionManifest

module.exports.MOUNT_ROOT = '/dbs'
module.exports.PACKAGE_ROOT = '/packages'
