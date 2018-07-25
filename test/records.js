const p = require('path')
const fs = require('fs-extra')

const datEncoding = require('dat-encoding')
const test = require('tape')
const tmp = require('tmp-promise')
const grpc = require('grpc')

const create = require('./helpers/create')

const PACKAGE_ROOT = p.join(__dirname, 'data', 'packages')

test('can insert triples for a type', async t => {
  let [ appDb ] = await create.fromPackages([
    p.join(PACKAGE_ROOT, 'location')
  ])
  await appDb.publish('v1')
  let key = datEncoding.encode(appDb.key)

  let packageDb = await create.one()
  await packageDb.install(key, 'v1')
  let handle = await packageDb.bind('location-tagger', 'v1')

  let { proto } = await appDb.packages.export()
  let root = await createRootClient(proto)
  let client = new root.Location(`localhost:${handle.port}`, grpc.credentials.createInsecure())

  var gotResponse = false
  const call = client.Insert()
  call.on('data', data => {
    t.true(data.id)
    gotResponse = true
    call.destroy()
  })
  call.on('error', err => {
    t.error(err)
  })
  call.on('end', async () => {
    t.true(gotResponse)
    await handle.close()
    await create.close()
    t.end()
  })

  call.write({
    coords: {
      lat: 34.168704,
      lon: -118.184182
    },
    name: 'Home'
  })
})

async function createRootClient (schema) {
  let { path } = await tmp.file({ postfix: '.proto' })
  await fs.writeFile(path, schema, 'utf8')
  return grpc.load(path)
}
