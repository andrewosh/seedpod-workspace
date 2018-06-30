
module.exports = Package

function Package () {}

Package.fromInfo = function (descriptor) {
  return descriptor.name + '/' + descriptor.major
}
