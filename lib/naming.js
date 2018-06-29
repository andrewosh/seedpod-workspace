var p = require('path')

function getPackageName (id) {
  return p.join(exports.PACKAGE_ROOT, id)
}

function getSchemaName (pkg, version) {
  return p.join(getPackageName(pkg), '' + version)
}

function getTypeName (pkg, type, version) {
  return p.join(getPackageName(pkg), 'types', type, '' + version)
}

function getTypeMetadataName (pkg, type) {
  return p.join(getPackageName(pkg), 'types', type)
}

function getRecordsRoot (pkg, type, version) {
  return p.join(exports.RECORD_ROOT, pkg, type, '' + version)
}

function getRecordName (pkg, type, version, id) {
  return p.join(getRecordsRoot(pkg, type, version), id)
}

function getImportName (key) {
  return p.join(exports.IMPORT_ROOT, key)
}

function getApplicationName (name) {
  return p.join(exports.APPLICATION_ROOT, name)
}

function getPackageAlias (app, packageName, packageVersion) {
  return p.join(getApplicationName(app), '/aliases/', packageName, '' + packageVersion)
}

module.exports.type = getTypeName
module.exports.typeMetadata = getTypeMetadataName
module.exports.package = getPackageName
module.exports.schema = getSchemaName
module.exports.record = getRecordName
module.exports.recordsRoot = getRecordsRoot
module.exports.import = getImportName
module.exports.application = getApplicationName
module.exports.alias = getPackageAlias

module.exports.IMPORTS_ROOT = '/imports'
module.exports.RECORD_ROOT = '/records'
module.exports.PACKAGE_ROOT = '/packages'
module.exports.APPLICATION_ROOT = '/applications'
module.exports.GRAPH_DB_ROOT = '/graph'
