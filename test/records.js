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
  let [client, handle] = await registerAndBind('location', 'location-tagger')

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
  let [client, handle] = await registerAndBind('location', 'location-tagger')

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

  console.log('GETTING DOC WITH ID:', _id)
  console.log('  AND REVS IS:', _revs)

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

async function registerAndBind (dir, packageName) {
  let [ appDb ] = await create.fromPackages([
    p.join(PACKAGE_ROOT, dir)
  ])
  await appDb.publish('v1')
  let key = datEncoding.encode(appDb.key)

  let packageDb = await create.one()
  await packageDb.install(key, 'v1')
  let { proto } = await appDb.packages.export()
  console.log('PROTO:', proto)

  let handle = await packageDb.bind(packageName, 'v1')

  let root = await createRootClient(proto)
  let client = new root.Location(`localhost:${handle.port}`, grpc.credentials.createInsecure())

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
