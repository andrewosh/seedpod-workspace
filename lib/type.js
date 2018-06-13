module.exports = Type

function Type () {}

Type.getInfo = function (typeDescriptor) {
  if (typeof typeDescriptor === 'string') {
    typeDescriptor = _parseDescriptor(typeDescriptor)
  }

  function _parseDescriptor (str) {
    var typeInfo = {}

    var versionSplit = str.split('@')
    var packageSplit = versionSplit[0].split('.')

    typeInfo.packageName = packageSplit.slice(0, packageSplit.length - 1).join('.')
    typeInfo.name = packageSplit[packageSplit.length - 1]

    var versionString = versionSplit[1]
    if (versionString) {
      typeInfo.version = {}
      typeInfo.version.major = +versionString[0]
      typeInfo.version.minor = +versionString[2]
    }

    return typeInfo
  }

  return typeDescriptor
}

Type.fromInfo = function (descriptor) {
  var str = (descriptor.key) ? 'pq://' + descriptor.key : ''
  str += descriptor.packageName + '.'
  str += descriptor.name
  var versionString = Type.getVersionString(descriptor)
  if (versionString) str += '@' + versionString
  return str
}

Type.fromFieldName = function (name) {
  var versionSplit = name.split('@')
  var version = versionSplit[1]
  name = versionSplit[0]
  var split = name.split('.')
  return {
    packageName: split.slice(0, split.length - 1).join('.'),
    name: split[split.length - 1],
    version: version
  }
}

var fieldRegex = /.*\..*/
Type.isRecordField = function (field) {
  return fieldRegex.test(field.type)
}

Type.getVersionString = function (type) {
  return type.version.major + '.' + type.version.minor
}

Type.isRecord = function (message) {
  console.log('message:', message)
  for (var i = 0; i < message.fields.length; i++) {
    var field = message.fields[i]
    console.log('FIELD IS:', field)
    if (field.tag === 1) {
      console.log('TAG IS ONE AND ID:', field.name)
      return (field.name === '_id')
    }
  }
  return false
}
