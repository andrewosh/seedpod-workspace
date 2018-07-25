const logger = require('template-console-logger')

module.exports.appKey = function (pkg, pkgVersion) {
  return [pkg, pkgVersion].join('@')
}

module.exports.predicate = function (packageName, typeName, fieldName, version) {
  return `${packageName}.${typeName}.${fieldName}@${version}`
}

module.exports.logger = function (name) {
  return logger(`typedb:${name}`)
}
