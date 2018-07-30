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
      port: 5000 + idx++,
      swarm: {
        dns: {
          server: '35.230.87.226:9090'
        }
      }
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
  let dbs = await many(1)
  return dbs[0]
}

async function two () {
  return many(2, false, true)
}

async function twoWriters () {
  return many(2, true, false)
}

async function threeWriters () {
  return many(3, true, false)
}

async function many (n, sameKey, sameFactory) {
  sameKey = !!sameKey
  sameFactory = !!sameFactory

  if (sameFactory) var factory = await makeFactory()

  let dbs = []
  let key = null
  let first = null

  for (var i = 0; i < n; i++) {
    if (!sameFactory) factory = await makeFactory()
    let db = uniondb(factory, sameKey ? key : null, { valueEncoding: 'binary' })
    let tdb = typedb(db)
    await tdb.ready()

    if (first && sameKey) first.authorize(tdb.key)
    first = first || tdb
    key = key || tdb.key

    dbs.push(tdb)
  }
  return dbs
}

/**
 * Create package databases from a list of package directories.
 *
 * @param {Type of packages} packages - List of the form [<package dir 1>, <package dir 2>, ...]
 */
async function fromPackages (packages) {
  let tdbs = await many(packages.length, false, true)
  for (var i = 0; i < packages.length; i++) {
    let tdb = tdbs[i]
    let pkg = packages[i]

    let manifest = await fs.readFile(p.join(pkg, 'manifest.json'), 'utf8')
    let iface = await fs.readFile(p.join(pkg, 'interface.spdl'), 'utf8')

    await tdb.updatePackage(iface, manifest)
  }
  return tdbs
}

async function close () {
  for (var i = 0; i < stores.length; i++) {
    await stores[i].close()
  }
}

module.exports = {
  one,
  two,
  twoWriters,
  threeWriters,
  fromPackages,
  many,
  close
}
