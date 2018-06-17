var p = require('path')

function getPackageName (pkg) {
  return p.join('/packages', pkg)
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
  return p.join('/db', pkg, type, '' + version)
}

function getRecordName (pkg, type, version, id) {
  return p.join(getRecordsRoot(pkg, type, version), id)
}

module.exports.type = getTypeName
module.exports.typeMetadata = getTypeMetadataName
module.exports.package = getPackageName
module.exports.schema = getSchemaName
module.exports.record = getRecordName
module.exports.recordsRoot = getRecordsRoot

module.exports.RECORD_ROOT = '/db'
module.exports.PACKAGE_ROOT = '/packages'
