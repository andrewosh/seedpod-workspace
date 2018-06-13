const events = require('events')
const inherits = require('inherits')

const uuid = require('uuid/v4')
const protoSchema = require('protocol-buffers-schema')
const protobuf = require('protocol-buffers')
const asyncMap = require('async-each')
const _ = require('lodash')

const Type = require('./lib/type')
const Package = require('./lib/package')
const messages = require('./lib/messages')
const naming = require('./lib/naming')

module.exports = TypedHyperDB

function TypedHyperDB (db, opts) {
  if (!(this instanceof TypedHyperDB)) return new TypedHyperDB(db, opts)
  this.opts = opts || {}
  this.db = db

  // TODO: replace with an LRU cache.
  this._schemas = {}
  this._types = {}

  // Set in ready
  this.key = null

  this._ready = new Promise((resolve, reject) => {
    this.db.ready().then(() => {
      this.key = this.db.key
      return resolve()
    }).catch(err => {
      return reject(err)
    })
  })

  this.ready = function (cb) {
    if (!cb) return this._ready
    this._ready.then(() => {
      return cb()
    }).catch(err => {
      return cb(err)
    })
  }
}
inherits(TypedHyperDB, events.EventEmitter)

TypedHyperDB.prototype._registerPackage = function (packageName, transformed, original, cb) {
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

TypedHyperDB.prototype._registerType = function (schema, typeInfo, cb) {
  var self = this

  self._getType(typeInfo, function (err, type) {
    if (err) return cb(err)
    if (!type) {
      // This is the first time this type has been registered.
      typeInfo.version = { major: 1, minor: 0 }
      return finishRegistration()
    } else {
      self._getSchema(type.packageName, type.packageVersion, function (err, compiled, version, existingSchema) {
        if (err) return cb(err)
        var existing = _.find(existingSchema.messages, { name: type.name })
        if (isIncompatible(existing, typeInfo)) {
          // Needs a major version bump.
          typeInfo.version = {
            minor: 0,
            major: type.version.major + 1
          }
        } else {
          // Needs a minor version bump.
          typeInfo.version = {
            major: type.version.major,
            minor: type.version.minor + 1
          }
        }
        return finishRegistration()
      })
    }
  })

  function finishRegistration () {
    // Check to see if any fields refer to Record types. If so, replace each field
    // with a string reference.

    typeInfo.fieldTypeMap = transformRecordFields()
    var versionString = Type.getVersionString(typeInfo)

    var typeMetadataPath = naming.typeMetadata(typeInfo.packageName, typeInfo.name)
    var typePath = naming.type(typeInfo.packageName, typeInfo.name, versionString)

    self.db.put(typePath, messages.TypeRecord.encode(typeInfo), function (err) {
      if (err) return cb(err)
      self.db.put(typeMetadataPath, messages.TypeMetadata.encode({
        latest: typeInfo.version
      }), function (err) {
        if (err) return cb(err)
        return cb(null, versionString)
      })
    })
  }

  function transformRecordFields () {
    // The package schema should already be parsed at this point.
    var fieldMap = {}
    for (var i = 0; i < typeInfo.message.fields.length; i++) {
      var field = typeInfo.message.fields[i]
      var packageMessage = _.find(schema, { name: field.name })
      if (Type.isRecordField(field) || (packageMessage && packageMessage.fields[0].name === '_id')) {
        // The field refers to a record type
        fieldMap[field.name] = {
          name: field.type,
          repeated: field.repeated
        }
        field.type = 'string'
      }
    }
    return fieldMap
  }

  function isIncompatible (existingType, newType) {
    // If a required field was deleted -> not compatible
    // If an optional field was deleted -> compatible
    // If the type for an existing tag was changed -> not compatible
    // If a new required field was added -> not compatible
    // If a new optional field was added -> compatible

    // TODO: could be more efficient, but I want the logic to be readable in the loop below.
    var existingMap = fieldsByTag(existingType)
    var newMap = fieldsByTag(newType.message)

    var existingTags = Object.keys(existingMap)
    var newTags = Object.keys(newMap)

    for (var i = 0; i < Math.max(existingTags.length, newTags.length); i++) {
      var f1 = existingMap[existingTags[i]]
      var f2 = newMap[newTags[i]]
      if (f1 && f2 && (f1.name !== f2.name || f1.type !== f2.type)) return true
      if (f1 && !f2 && f1.required) return true
      if (f2 && !f1 && f2.required) return true
    }
    return false
  }

  function fieldsByTag (message) {
    var fieldMap = {}
    for (var i = 0; i < message.fields.length; i++) {
      var field = message.fields[i]
      fieldMap[field.tag] = field
    }
    return fieldMap
  }
}

TypedHyperDB.prototype.importPackages = function (key, packageNames, opts, cb) {
  if (typeof opts === 'function') return this.importPackages(key, packageNames, null, opts)
  opts = opts || {}
  var self = this

  asyncMap(packageNames, function (packageName, next) {
    var isAliased = (packageName instanceof Array)
    var localPath = (isAliased) ? naming.package(packageName[1]) : naming.package(packageName)
    var remotePath = (isAliased) ? naming.package(packageName[0]) : localPath
    self.mount(key, localPath, Object.assign({}, opts, { remotePath: remotePath }), next)
  }, function (err) {
    if (err) return cb(err)
    return cb()
  })
}

/*
 * Create multiple types from a protocol buffer schema. This enables `insert`, `delete`,
 * and `find` operations over those types.
 *
 * Additionally, these types can be shared with other filesystems via importing
 * (which, under the hood, is reading from a cross-filesystem symlink).
 *
 * Types will be implicitly versioned based on a backwards-compatibility check.
 * If a new type with the same name either:
 *   a) Modifies the type for an existing tag
 *   b) Changes an optional type to a required type
 * then the new type will be assigned a new major version.
 *
 * If neither of those conditions are true, then the new type will be given a
 * new minor version.
 */
TypedHyperDB.prototype.registerTypes = function (schema, opts, cb) {
  if (typeof opts === 'function') return this.registerTypes(schema, null, opts)
  opts = opts || {}
  var self = this

  // TODO: Better copy?
  var original = protoSchema.parse(schema)
  var transformed = protoSchema.parse(schema)

  var packageName = transformed.package

  // 1) Get version by checking for conflicts with an existing version.
  // 2) If no existing version, then the version is 1.0
  // 3) After the version bump, register each individual type.
  self._getSchema(packageName, function (err, schema, packageVersion) {
    if (err) return cb(err)
    asyncMap(transformed.messages, function (message, next) {
      return self._registerType(original, {
        name: message.name,
        packageName: packageName,
        // Set in _registerType.
        version: null,
        packageVersion: (packageVersion) ? { major: packageVersion.major + 1 } : { major: 1 },
        // Populated in _registerType.
        fieldTypeMap: {},
        message: message
      }, next)
    }, function (err, versions) {
      if (err) return cb(err)
      self._registerPackage(packageName, transformed, original, function (err, packageVersion) {
        if (err) return cb(err)
        var typesToVersions = {}
        for (var i = 0; i < versions.length; i++) {
          typesToVersions[transformed.messages[i].name] = versions[i]
        }
        return cb(null, typesToVersions)
      })
    })
  })
}

TypedHyperDB.prototype._getNoConflicts = function (path, encoding, makeError, cb) {
  this.db.get(path, function (err, nodes) {
    if (err) return cb(err)
    if (!nodes) return cb(null, null)
    var values = nodes.map(function (node) {
      return encoding.decode(node.value)
    })
    if (nodes.length > 1) {
      var error = makeError(nodes)
      error.conflict = true
      return cb(err)
    }
    return cb(null, values[0])
  })
}

TypedHyperDB.prototype._getType = function (typeInfo, cb) {
  var self = this

  if (!typeInfo.version) {
    // If the version isn't specified, use the latest version.
    var metadataPath = naming.typeMetadata(typeInfo.packageName, typeInfo.name)
    this._getNoConflicts(metadataPath, messages.TypeMetadata, function (metas) {
      var error = new Error('Conflicting type metadata.')
      error.conflictingMetadata = metas
      return error
    }, function (err, meta) {
      if (err) return cb(err)
      if (!meta) return cb(null, null)
      typeInfo.version = meta.latest
      return finishGet()
    })
  } else {
    finishGet()
  }

  function finishGet () {
    var typeId = Type.fromInfo(typeInfo)
    // TODO: add caching
    // if (self._types[typeId]) return cb(null, self._types[typeId])

    var typePath = naming.type(typeInfo.packageName, typeInfo.name, Type.getVersionString(typeInfo))
    self._getNoConflicts(typePath, messages.TypeRecord, function (types) {
      var error = new Error('Conflicting types.')
      error.conflictingTypes = types
      return error
    }, function (err, type) {
      if (err) return cb(err)

      if (!type) return cb(null, null)
      self._types[typeId] = type
      return cb(null, type)
    })
  }
}

TypedHyperDB.prototype._getSchema = function (packageName, version, cb) {
  if (typeof version === 'function') return this._getSchema(packageName, null, version)

  var self = this

  if (!version) {
    // Load the latest package version.
    return this._getNoConflicts(naming.package(packageName), messages.PackageMetadata,
      function (packages) {
        var error = new Error('Conflicting packages.')
        error.conflictingPackages = packages
        return error
      },
      function (err, pkg) {
        if (err) return cb(err)
        if (!pkg) return cb(null, null)
        return self._getSchema(packageName, pkg.latest, cb)
      })
  }

  var packageId = Package.fromInfo({ name: packageName, version: version })
  // if (this._schemas[packageId]) return cb(null, this._schemas[packageId], version)

  var schemaPath = naming.schema(packageName, version.major)
  this._getNoConflicts(schemaPath, messages.PackageRecord, function (packages) {
    var error = new Error('Conflicting package schemas.')
    error.conflictingPackages = packages
    return error
  }, function (err, pkg) {
    if (err) return cb(err)
    if (!pkg) return cb(null, null, null)

    var original = JSON.parse(pkg.original)
    var transformed = JSON.parse(pkg.transformed)
    var compiled = protobuf(transformed)

    self._schemas[packageId] = compiled
    return cb(null, compiled, version, original)
  })
}

TypedHyperDB.prototype._getTypeAndSchema = function (typeInfo, cb) {
  var self = this

  this._getType(typeInfo, function (err, type) {
    if (err) return cb(err)
    if (!type) return cb(new Error('Type does not exist. Did you forget to register or import the schema?'))
    self._getSchema(type.packageName, type.packageVersion, function (err, schema) {
      if (err) return cb(err)
      return cb(null, type, schema)
    })
  })
}

TypedHyperDB.prototype._generateRecordId = function (record, typeDescriptor) {
  // TODO: should the ID hash the record contents? Prob not necessary.
  return uuid()
}

TypedHyperDB.prototype.insert = function (type, data, cb) {
  var self = this

  var typeInfo = Type.getInfo(type)

  this._getTypeAndSchema(typeInfo, function (err, type, schema) {
    if (err) return cb(err)

    data._id = data._id || self._generateRecordId(data, type)

    var recordPath = naming.record(type.packageName, type.name, type.version.major, data._id)
    var recordFields = Object.keys(type.fieldTypeMap)

    if (recordFields.length === 0) {
      // This record does not have any nested record fields. Finish insertion.
      return finishInsertion(recordPath, schema[type.name], data)
    } else {
      // This record has nested record fields. Insert them and replace with their IDs.
      asyncMap(recordFields, function (field, next) {
        var nestedType = type.fieldTypeMap[field]
        var nestedData = _.get(data, field)
        if (typeof nestedData === 'string') {
          // The record is already referenced by ID.
          return next(null, null)
        }
        // If the nested field is repeated, insert each item in the array of nested records.
        // TODO: This will be too expensive with many records -- batch.
        if (nestedType.repeated) {
          asyncMap(nestedData, function (nestedRecord, next) {
            return self.insert(nestedType.name, nestedRecord, next)
          }, function (err, ids) {
            if (err) return next(err)
            return next(null, ids)
          })
        } else {
          return self.insert(nestedType.name, nestedData, next)
        }
      }, function (err, fieldIds) {
        if (err) return cb(err)
        for (var i = 0; i < recordFields.length; i++) {
          if (fieldIds[i] !== null) {
            _.set(data, recordFields[i], fieldIds[i])
          }
        }
        return finishInsertion(recordPath, schema[type.name], data)
      })
    }
  })

  function finishInsertion (path, encoding, data) {
    self.db.put(path, encoding.encode(data), function (err) {
      if (err) return cb(err)
      return cb(null, data._id)
    })
  }
}

TypedHyperDB.prototype.get = function (type, id, cb) {
  var self = this

  var typeInfo = Type.getInfo(type, id)

  this._getTypeAndSchema(typeInfo, function (err, type, schema) {
    if (err) return cb(err)

    var recordPath = naming.record(type.packageName, type.name, type.version.major, id)
    var recordFields = Object.keys(type.fieldTypeMap)

    var encoding = schema[type.name]

    self.db.get(recordPath, function (err, data) {
      if (err) return cb(err)
      if (!data) return cb(null, null)
      if (data.length === 1) return finishGet(data[0], cb)
      return asyncMap(data, finishGet, cb)
    })

    function finishGet (node, cb) {
      var data = encoding.decode(node.value)
      if (recordFields.length === 0) {
        // This record does not have any nested record fields. Finish get.
        return cb(null, data)
      } else {
        // Fetch each nested record and insert at the correct field path.
        asyncMap(recordFields, function (field, next) {
          var nestedType = type.fieldTypeMap[field]
          if (nestedType.repeated) {
            // Fetch each nested record by ID .
            // TODO: This could return too much data -- return some sort of iterator.
            asyncMap(_.get(data, field), function (nestedId, next) {
              self.get(nestedType.name, nestedId, function (err, record) {
                if (err) return next(err)
                return next(null, record)
              })
            }, function (err, records) {
              if (err) return next(err)
              _.set(data, field, records)
              return cb(null)
            })
          } else {
            self.get(nestedType.name, _.get(data, field), function (err, nestedRecord) {
              if (err) return next(err)
              _.set(data, field, nestedRecord)
              return next(null)
            })
          }
        }, function (err) {
          if (err) return cb(err)
          return cb(null, data)
        })
      }
    }
  })
}

TypedHyperDB.prototype.mount = function (key, path, opts, cb) {
  if (typeof opts === 'function') return this.mount(key, path, null, opts)
  var self = this

  this.ready(function (err) {
    if (err) return cb(err)
    return self.db.mount(key, path, opts, cb)
  })
}

TypedHyperDB.prototype.fork = function (cb) {
  var self = this

  this.db.fork(function (err, fork) {
    if (err) return cb(err)
    return cb(null, TypedHyperDB(fork, self.opts))
  })
}

TypedHyperDB.prototype.authorize = function (key) {
  return this.db.authorize(key)
}
