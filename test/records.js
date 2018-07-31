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

test('can insert and get a complicated record with nested types', async t => {
  let [client, handle] = await registerAndBind('dogs', 'Walker')

  let doc = {
    age: {
      birthday: '9/28/1990',
      age: 27
    },
    name: 'Fred',
    walking: [
      {
        breed: {
          name: 'Pug',
          // TODO: get the protobuf types for enum references etc
          energy: 'LOW'
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
  t.same(value.walking[0].breed.energy, 'LOW')
  t.same(value.walking[0].limbCount, 4)

  await handle.close()
  t.end()
})

test('can call a query', async t => {
  let [clients, handle] = await registerAndBind('dogs', ['Walker', 'query'])
  let walkerClient = clients[0]
  let queryClient = clients[1]

  let doc1 = {
    age: {
      birthday: '9/28/2007',
      age: 10
    },
    name: 'Rita',
    walking: [
      {
        breed: {
          name: 'Corgi',
          // TODO: get the protobuf types for enum references etc
          energy: 'HIGH'
        },
        name: 'Popchop',
        limbCount: 3,
        populationCount: 18000
      }
    ]
  }

  let doc2 = {
    age: {
      birthday: '9/28/1990',
      age: 27
    },
    name: 'Fred',
    walking: [
      {
        breed: {
          name: 'Pug',
          // TODO: get the protobuf types for enum references etc
          energy: 'LOW'
        },
        name: 'Evan',
        limbCount: 4,
        populationCount: 40000
      }
    ]
  }

  let [_id1, _revs1] = await insert(t, walkerClient, doc1)
  let [_id2] = await insert(t, walkerClient, doc2)
  t.true(_id1)
  t.true(_id2)
  t.notEqual(_id1, _id2)

  let breeds = await query(t, queryClient, 'breedsForWalker', {
    walker: {
      _id: _id1,
      _revs: _revs1
    }
  })

  t.same(breeds.length, 1)
  t.same(breeds[0].name, 'Corgi')
  t.same(breeds[0].energy, 'HIGH')

  await handle.close()
  t.end()
})

test('can register a simple trigger', async t => {
  let [clients, handle] = await registerAndBind('dogs', ['Walker', 'trigger'])
  let [walkerClient, triggerClient] = clients

  let trigger = await triggerClient.adultWalkers()
  trigger.on('data', walker => {
    t.same(walker.age.age, 27)
    t.same(walker.name, 'Fred')
  })
  trigger.on('error', err => {
    t.same(err.details, 'Cancelled')
  })
  trigger.on('end', async () => {
    await handle.close()
    t.end()
  })

  let doc1 = {
    age: {
      birthday: '9/28/2007',
      age: 10
    },
    name: 'Rita',
    walking: [
      {
        breed: {
          name: 'Corgi',
          // TODO: get the protobuf types for enum references etc
          energy: 'HIGH'
        },
        name: 'Popchop',
        limbCount: 3,
        populationCount: 18000
      }
    ]
  }

  let doc2 = {
    age: {
      birthday: '9/28/1990',
      age: 27
    },
    name: 'Fred',
    walking: [
      {
        breed: {
          name: 'Pug',
          // TODO: get the protobuf types for enum references etc
          energy: 'LOW'
        },
        name: 'Evan',
        limbCount: 4,
        populationCount: 40000
      }
    ]
  }

  let [_id1] = await insert(t, walkerClient, doc1)
  let [_id2] = await insert(t, walkerClient, doc2)
  t.true(_id1)
  t.true(_id2)
  t.notEqual(_id1, _id2)

  // The trigger will never end unless we explicitly stop it after a delay.
  await delay(300)
  await trigger.cancel()

  // TODO: trigger out how to end this test neatly
  await handle.close()
  t.end()
})

test('can store/load bytes', async t => {
  let [client, handle] = await registerAndBind('fs', 'File')

  let content = await fs.readFile(p.join(__dirname, 'data', 'packages', 'fs', 'wearable.jpeg'))

  let doc = {
    name: 'wearable',
    stat: {
      mode: 744,
      uid: 0,
      gid: 0,
      mtime: Date.now(),
      ctime: Date.now()
    },
    content: {
      value: content
    }
  }

  let [_id, _revs] = await insert(t, client, doc)
  t.true(_id)
  t.true(_revs)

  let docs = await get(t, client, _id)
  t.same(docs.values.length, 1)
  let resultFile = docs.values[0]
  t.true(resultFile.value.content.value.equals(content))

  await handle.close()
  t.end()
})

test('can create tag fields', async t => {
  let [clients, handle] = await registerAndBind('fs', ['File', 'Extension', 'query'])
  let [fileClient, extClient, queryClient] = clients

  let content = await fs.readFile(p.join(__dirname, 'data', 'packages', 'fs', 'wearable.jpeg'))

  let doc = {
    name: 'wearable',
    stat: {
      mode: 744,
      uid: 0,
      gid: 0,
      mtime: Date.now(),
      ctime: Date.now()
    },
    content: {
      value: content
    }
  }

  let [_id, _revs] = await insert(t, fileClient, doc)
  t.true(_id)
  t.true(_revs.length)

  let docs = await get(t, fileClient, _id)
  t.same(docs.values.length, 1)
  let resultFile = docs.values[0].value
  t.true(resultFile.content.value.equals(content))

  let ext = {
    file: resultFile,
    type: 'jpeg'
  }

  let [_id2, _revs2] = await insert(t, extClient, ext)
  t.true(_id2)
  t.true(_revs2.length)

  // If the tag type isn't working correctly, the File will be recreated so the resulting Extension
  // will point to a different revision (other than _revs[0])
  let extensions = await query(t, queryClient, 'extensionsForFile', {
    file: {
      _id: _id,
      _revs: _revs
    }
  })
  t.same(extensions.length, 1)
  t.same(extensions[0].type, 'jpeg')
  t.same(extensions[0].file._revs, _revs)

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
      return resolve(rsp)
    })

    call.write({ _id, _revs })
  })
}

async function query (t, client, name, input) {
  return new Promise(async (resolve, reject) => {
    client[name](input, (err, rsp) => {
      if (err) return reject(err)
      return resolve(rsp.values)
    })
  })
}

async function createAndPublish (name) {
  let dir = name.replace(/\//g, '-')
  let manifest = JSON.parse(await fs.readFile(p.join(PACKAGE_ROOT, dir, 'manifest.json'), 'utf8'))
  let iface = await fs.readFile(p.join(PACKAGE_ROOT, dir, 'interface.spdl'), 'utf8')
  let deps = manifest.dependencies
  if (deps) {
    for (let depName of Object.keys(deps)) {
      let { db, version } = await createAndPublish(depName)
      deps[depName] = {
        key: datEncoding.encode(db.key),
        version: version
      }
    }
  }

  let appDb = await create.one()
  await appDb.updatePackage(iface, manifest)
  await appDb.publish(manifest.version, { skipVersioning: true })

  return {
    db: appDb,
    version: manifest.version
  }
}

async function registerAndBind (packageName, services) {
  let { db: appDb, version } = await createAndPublish(packageName)
  let key = datEncoding.encode(appDb.key)

  let packageDb = await create.one()
  await packageDb.install(key, version)
  let { proto } = await appDb.packages.export()

  let handle = await packageDb.bind(packageName, version)

  let root = await createRootClient(proto)

  let clients = []
  if (!(services instanceof Array)) services = [services]
  for (let s of services) {
    clients.push(new root[s](`localhost:${handle.port}`, grpc.credentials.createInsecure()))
  }
  if (clients.length === 1) clients = clients[0]

  return [clients, handle]
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
