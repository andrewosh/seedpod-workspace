const p = require('path')
const fs = require('fs-extra')

const datEncoding = require('dat-encoding')
const test = require('tape')
const tmp = require('tmp-promise')
const almostEqual = require('almost-equal')
const grpc = require('grpc')

const create = require('./helpers/create')

const PACKAGE_ROOT = p.join(__dirname, 'data', 'packages')

test('can insert a single record for a simple type', async t => {
  let [client, handle] = await registerAndBind('location-tagger', 'Location')

  let doc = {
    coords: {
      lat: 34.168704,
      lon: -118.184182
    },
    name: 'Home'
  }

  let [_id, _revs] = await insert(t, client, doc)
  t.true(_id)
  t.same(_revs.length, 1)
  t.true(_revs[0])

  await handle.close()
  t.end()
})

test('can insert and get a single record for a simple type by ID (no revision)', async t => {
  let [client, handle] = await registerAndBind('location-tagger', 'Location')

  let doc = {
    coords: {
      lat: 34.168704,
      lon: -118.184182
    },
    name: 'Home'
  }

  let [_id, _revs] = await insert(t, client, doc)
  t.true(_id)
  t.true(_revs[0])

  let docs = await get(t, client, _id)
  t.same(docs.values.length, 1)
  doc = docs.values[0]

  t.same(doc.id._id, _id)
  t.same(doc.id._revs, _revs)
  t.same(doc.value.name, 'Home')
  t.ok(almostEqual(doc.value.coords.lat, 34.168704, almostEqual.FLT_EPSILON))

  await handle.close()
  t.end()
})

test.skip('can insert and get a complicated record with nested types', async t => {
  let [client, handle] = await registerAndBind('dogs', 'Walker')

  let doc = {
    age: {
      birthday: '9/28/1990',
      age: 27
    },
    walking: [
      {
        breed: {
          name: 'Pug',
          // TODO: get the protobuf types for enum references etc
          energy: 1
        },
        name: 'Evan',
        limbCount: 4,
        populationCount: 40000
      }
    ]
  }

  let [_id, _revs] = await insert(t, client, doc)
  t.true(_id)
  t.true(_revs[0])

  let docs = await get(t, client, _id)
  t.same(docs.values.length, 1)
  doc = docs.values[0]

  t.same(doc.id._id, _id)
  t.same(doc.id._revs, _revs)
  let value = doc.value
  t.same(value.age.age, 27)
  t.same(value.age.birthday, '9/28/1990')
  t.same(value.walking.length, 1)
  t.same(value.walking[0].breed.name, 'Pug')
  t.same(value.walking[0].breed.energy, 1)
  t.same(value.walking[0].limbCount, 4)

  await handle.close()
  t.end()
})

test('cleanup', async t => {
  await create.close()
  t.end()
})

async function insert (t, client, doc) {
  var _id, _revs
  return new Promise(async (resolve, reject) => {
    const call = client.Put()
    call.on('data', data => {
      console.log('REQ RESPONSE:', JSON.stringify(data))
      _id = data.id._id
      _revs = data.id._revs
      call.destroy()
    })
    call.on('error', err => {
      t.error(err)
      return reject(err)
    })
    call.on('end', async () => {
      return resolve([_id, _revs])
    })
    call.write(doc)
  })
}

async function get (t, client, _id, _revs) {
  var rsp
  return new Promise(async (resolve, reject) => {
    const call = client.Get()
    call.on('data', data => {
      rsp = data
      call.destroy()
    })
    call.on('error', err => {
      t.error(err)
      return reject(err)
    })
    call.on('end', async () => {
      console.log('RSP:', JSON.stringify(rsp))
      return resolve(rsp)
    })

    call.write({ _id, _revs })
  })
}

async function createAndPublish (name) {
  let manifest = JSON.parse(await fs.readFile(p.join(PACKAGE_ROOT, name, 'manifest.json'), 'utf8'))
  let iface = await fs.readFile(p.join(PACKAGE_ROOT, name, 'interface.spdl'), 'utf8')
  let deps = manifest.dependencies
  if (deps) {
    for (let depName of Object.keys(deps)) {
      let { db } = await createAndPublish(depName)
      deps[depName].key = datEncoding.encode(db.key)
    }
  }

  let appDb = await create.one()
  console.log('updating package with iface', iface, 'manifest:', manifest)
  await appDb.updatePackage(iface, manifest)
  await appDb.publish(manifest.version, { skipVersioning: true })

  return {
    db: appDb,
    version: manifest.version
  }
}

async function registerAndBind (packageName, type) {
  let { db: appDb, version } = await createAndPublish(packageName)
  let key = datEncoding.encode(appDb.key)

  let packageDb = await create.one()
  await packageDb.install(key, version)
  let { proto } = await appDb.packages.export()

  let handle = await packageDb.bind(packageName, version)

  let root = await createRootClient(proto)
  let client = new root[type](`localhost:${handle.port}`, grpc.credentials.createInsecure())

  return [client, handle]
}

async function createRootClient (schema) {
  let { path } = await tmp.file({ postfix: '.proto' })
  await fs.writeFile(path, schema, 'utf8')
  return grpc.load(path)
}

async function delay (ms) {
  return new Promise((resolve, reject) => {
    setTimeout(() => resolve(), ms)
  })
}
