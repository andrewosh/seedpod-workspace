const logger = require('template-console-logger')

const consts = require('./consts')

module.exports.appKey = function (pkg, pkgVersion) {
  return [pkg, pkgVersion].join('@')
}

module.exports.fieldPredicate = function (packageName, typeName, fieldName, fieldVersion) {
  return `${packageName}.${typeName}.${fieldName}@${fieldVersion}`
}

module.exports.typePredicate = function (packageName, typeName, typeVersion) {
  return `${packageName}.${typeName}@${typeVersion}`
}

module.exports.logger = function (name) {
  return logger(`typedb:${name}`)
}

module.exports.isPrimitive = function (typeName) {
  return consts.BUILTIN_TYPES.has(typeName)
}
