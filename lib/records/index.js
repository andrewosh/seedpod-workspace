const PackageHandle = require('./handle')
const { appKey, logger } = require('../util')

const TAG = 'records'
let log = logger(TAG)

module.exports = RecordManager

function RecordManager (graph, packages) {
  if (!(this instanceof RecordManager)) return new RecordManager(graph, packages)
  this.graph = graph
  this.packages = packages
  this.handles = new Map()
}

RecordManager.prototype.bind = async function (pkg, pkgVersion) {
  log.debug(`creating handle for ${pkg} with version ${pkgVersion}`)
  let { schema, typeIndex } = await this.packages.export(pkg, pkgVersion)
  let handle = PackageHandle(this.graph, schema, typeIndex)
  let port = await handle.initialize()

  log.debug(`handle started on port ${port}`)
  this.handles.set(appKey(pkg, pkgVersion), {
    port,
    handle
  })

  return {
    port,
    close: async () => handle.close()
  }
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
