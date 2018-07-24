var p = require('path')

function getPackageName (pkg, pkgVersion) {
  console.log('pkg:', pkg, 'pkgVersion:', pkgVersion)
  return p.join(pkg, 'versions', pkgVersion)
}

function getPackageMount (pkg, pkgVersion) {
  return p.join(getPackageName(pkg, pkgVersion), 'db')
}

function getSchema (pkg, pkgVersion) {
  return p.join(getRemoteVersionRoot(pkg, pkgVersion), 'schema.json')
}

function getAST (pkg, pkgVersion) {
  return p.join(getRemoteVersionRoot(pkg, pkgVersion), 'ast.json')
}

function getTypeName (pkg, pkgVersion, type, version) {
  return p.join(getRemoteVersionRoot(pkg, pkgVersion), 'types', type, '' + version)
}

function getTypeMetadataName (pkg, pkgVersion, type) {
  return p.join(getRemoteVersionRoot(pkg, pkgVersion), 'types', type)
}

function getAlias (pkg, pkgVersion, aliasName) {
  return p.join(getRemoteVersionRoot(pkg, pkgVersion), 'aliases', aliasName)
}

function getGlobalMount (key) {
  return p.join(exports.MOUNT_ROOT, key)
}

function getRemotePackageRoot (key) {
  return p.join(getGlobalMount(key), exports.PACKAGE_ROOT, 'local')
}

function getRemoteVersionRoot (pkg, pkgVersion) {
  return p.join(getPackageMount(pkg, pkgVersion), exports.PACKAGE_ROOT, 'local')
}

function getRemoteRootManifest (key) {
  return p.join(getRemotePackageRoot(key), 'manifest.json')
}

function getRemoteVersionManifest (key, pkgVersion) {
  return p.join(getPackageMount(key, pkgVersion), 'local', 'manifest.json')
}

function getLocalPackageRoot () {
  return p.join('local')
}

function getLocalRootManifest () {
  return p.join(getLocalPackageRoot(), 'manifest.json')
}

function getLocalRootInterface () {
  return p.join(getLocalPackageRoot(), 'interface.spdl')
}

function getLocalRootSchema () {
  return p.join(getLocalPackageRoot(), 'schema.json')
}

function getLocalRootTypeIndex () {
  return p.join(getLocalPackageRoot(), 'types.json')
}

function getLocalVersionTypeIndex (pkgVersion) {
  return p.join(getPackageMount('local', pkgVersion), 'types.json')
}

function getLocalRootAST () {
  return p.join(getLocalPackageRoot(), 'ast.json')
}

function getLocalVersionManifest (pkgVersion) {
  return p.join(getPackageMount('local', pkgVersion), 'manifest.json')
}

function getLocalVersionInterface (pkgVersion) {
  return p.join(getPackageMount('local', pkgVersion), 'interface.spdl')
}

function getLocalVersionSchema (pkgVersion) {
  return p.join(getPackageMount('local', pkgVersion), 'schema.json')
}

module.exports.type = getTypeName
module.exports.typeMetadata = getTypeMetadataName
module.exports.package = getPackageName
module.exports.schema = getSchema
module.exports.ast = getAST

module.exports.globalMount = getGlobalMount
module.exports.packageMount = getPackageMount
module.exports.alias = getAlias

module.exports.local = getLocalPackageRoot
module.exports.localManifest = getLocalRootManifest
module.exports.localVersionManifest = getLocalVersionManifest
module.exports.localTypeIndex = getLocalRootTypeIndex
module.exports.localVersionTypeIndex = getLocalVersionTypeIndex
module.exports.localSchema = getLocalRootSchema
module.exports.localVersionSchema = getLocalVersionSchema
module.exports.localAST = getLocalRootAST
module.exports.localInterface = getLocalRootInterface
module.exports.localVersionInterface = getLocalVersionInterface

module.exports.remoteRootManifest = getRemoteRootManifest
module.exports.remoteVersionManifest = getRemoteVersionManifest

module.exports.MOUNT_ROOT = '/dbs'
module.exports.PACKAGE_ROOT = '/packages'
