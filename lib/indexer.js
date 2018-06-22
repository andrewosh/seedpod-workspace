const RxDB = require('rxdb')
const hyperdown = require('hyperdown')
RxDB.plugin(require('pouchdb-adapter-leveldb'))

async function create () {
  return RxDB.create({
    name: 'tdb',
    adapter: hyperdown,
    pouchSettings: {
      reduce: (a, b) => {
        if (!a) return b
        return a
      },
      map: ({ key, value }) => {
        return { key, value }
      },
      lex: true
    }
  })
}

module.exports = create
