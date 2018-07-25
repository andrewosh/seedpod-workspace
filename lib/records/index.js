const PackageHandle = require('./handle')
const { appKey } = require('../util')

module.exports = RecordManager

function RecordManager (db, packages) {
  if (!(this instanceof RecordManager)) return new RecordManager(db, packages)
  this.db = db
  this.packages = packages
  this.handles = new Map()
}

RecordManager.prototype.createHandle = async function (pkg, pkgVersion) {
  let { schema, typeIndex } = await this.packages.export(pkg, pkgVersion)
  let handle = PackageHandle(this.db, schema, typeIndex)
  let port = await handle.initialize()

  this.handles.set(appKey(pkg, pkgVersion), {
    port,
    handle
  })
}

/*
RecordManager.prototype._startWatching = async function () {
  this.log.debug('Watching record root for changes...')
  return this.db.watch(naming.RECORD_ROOT, (nodes) => {
    var descriptor = Type.fromRecordPath(nodes[0].key)
    this._getTypeAndSchema(descriptor, (err, [type, schema]) => {
      if (err) throw err
      var encoding = schema[type.name]
      this.emit('change', nodes.map(n => {
        return {
          type: n.value ? 'update' : 'delete',
          data: {
            record: n.value ? encoding.decode(n.value) : null,
            type: type,
            id: descriptor.id
          }
        }
      }))
    })
  })
}
*/
