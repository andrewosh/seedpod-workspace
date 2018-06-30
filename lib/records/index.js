
module.exports = RecordMangaer

function RecordMangaer (db, packages) {
  if (!(this instanceof RecordManager)) return new RecordMangaer(db, packages)
  this.db = db
  this.packages = packages

  // TODO: replace with an LRU cache.
  // TODO: re-add caching.
  this._schemas = {}
  this._types = {}
}

TypedHyperDB.prototype._startWatching = async function () {
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

