/**
 * @fileOverview
 * @name create.js<typed-hyperdb>
 * @author 
 * @license 
 */
const p = require('path')
const fs = require('fs-extra')
const hyperdb = require('hyperdb')
const uniondb = require('union-hyperdb')
const corestore = require('corestore')

const typedb = require('../..')

const STORAGE_DIR = p.join(__dirname, '..', 'test-storage')
let idx = 0
let stores = []

async function makeFactory () {
  var store = corestore(p.join(STORAGE_DIR, '' + idx++), {
    network: {
      port: 5000 + idx
    }
  })
  stores.push(store)
  await store.ready()

  function coreFactory (key, opts) {
    return store.get(key, opts)
  }

  function dbFactory (key, opts) {
    return hyperdb(coreFactory, key, opts)
  }

  return dbFactory
}

async function one () {
  let factory = await makeFactory()
  let db = uniondb(factory, { valueEncoding: 'binary' })
  let tdb = typedb(db)
  await tdb.ready()
  return tdb
}

async function two () {
  let factory = await makeFactory()
  let db1 = uniondb(factory, { valueEncoding: 'binary' })
  let tdb1 = typedb(db1)
  await tdb1.ready()

  let db2 = uniondb(factory, tdb1.key, { valueEncoding: 'binary' })
  let tdb2 = typedb(db2)
  await tdb2.ready()

  return [tdb1, tdb2]
}

async function twoShared (cb) {
  let factory = await makeFactory()

  let db1 = uniondb(factory, { valueEncoding: 'binary' })
  let tdb1 = typedb(db1)
  await tdb1.ready()

  let db2 = uniondb(factory, { valueEncoding: 'binary' })
  var tdb2 = typedb(db2)
  await tdb2.ready()

  return [tdb1, tdb2]
}

async function twoWriters () {
  let f1 = await makeFactory()
  let f2 = await makeFactory()

  let db1 = uniondb(f1, { valueEncoding: 'binary' })
  let tdb1 = typedb(db1)
  await tdb1.ready()

  let db2 = uniondb(f2, tdb1.key, { valueEncoding: 'binary' })
  var tdb2 = typedb(db2)
  await tdb2.ready()
  tdb1.authorize(tdb2.key)

  return [tdb1, tdb2]
}

async function threeWriters () {
  let f1 = await makeFactory()
  let f2 = await makeFactory()
  let f3 = await makeFactory()

  let db1 = uniondb(f1, { valueEncoding: 'binary' })
  let tdb1 = typedb(db1)
  await tdb1.ready()

  let db2 = uniondb(f2, tdb1.key, { valueEncoding: 'binary' })
  var tdb2 = typedb(db2)
  await tdb2.ready()

  let db3 = uniondb(f3, tdb1.key, { valueEncoding: 'binary' })
  var tdb3 = typedb(db3)
  await tdb3.ready()

  tdb1.authorize(tdb2.key)
  tdb1.authorize(tdb3.key)

  return [tdb1, tdb2, tdb3]
}


/**
 * Create package databases from a list of package directories.
 *
 * @param {Type of packages} packages - List of the form [<package dir 1>, <package dir 2>, ...]
 */
async function fromPackages (packages) {
  let dbs = []
  for (let pkg of packages) {
    let db = await one()
    let manifest = JSON.parse(await fs.readFile(p.join(pkg, 'manifest.json'), 'utf8'))
    let iface = await fs.readFile(p.join(pkg, 'interface.spdl'), 'utf8')
    await db.updatePackage(iface, manifest)
    dbs.push(db)
  }
  return dbs
}

async function close () {
  for (var i = 0; i < stores.length; i++) {
    await stores[i].close()
  }
}

module.exports = {
  one,
  two,
  twoShared,
  twoWriters,
  threeWriters,
  fromPackages,
  close
}
