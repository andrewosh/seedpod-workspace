const p = require('path')
const fs = require('fs-extra')
const protoSchema = require('protocol-buffers-schema')
const datEncoding = require('dat-encoding')

const create = require('./helpers/create.js')
const test = require('tape')

const PACKAGE_ROOT = p.join(__dirname, 'data', 'packages')

test('can import interface/manifest files into an empty package database', async t => {
  let [ db ] = await create.fromPackages([ p.join(PACKAGE_ROOT, 'location-tagger') ])
  let { manifest, interface: iface } = await db.packages.export()
  t.same(manifest.name, 'location-tagger')
  t.true(iface.length > 0)
  await create.close()
  t.end()
})

test('can update previously imported interface/manifest files', async t => {
  let [ db ] = await create.fromPackages([ p.join(PACKAGE_ROOT, 'location-tagger') ])
  let { manifest, interface: iface } = await db.packages.export()
  t.same(manifest.name, 'location-tagger')
  t.true(iface.length > 0)
  let ifaceLength = iface.length

  manifest = await fs.readFile(p.join(PACKAGE_ROOT, 'animals', 'manifest.json'), 'utf8')
  iface = await fs.readFile(p.join(PACKAGE_ROOT, 'animals', 'interface.spdl'), 'utf8')
  await db.updatePackage(iface, manifest)

  let { manifest: man2, interface: iface2 } = await db.packages.export()
  t.same(man2.name, 'animals')
  t.notEqual(iface2.length, ifaceLength)

  await create.close()
  t.end()
})

test('can publish an updated package', async t => {
  let [ db ] = await create.fromPackages([ p.join(PACKAGE_ROOT, 'location-tagger') ])
  let { manifest, interface: iface } = await db.packages.export()
  t.same(manifest.name, 'location-tagger')
  t.true(iface.length > 0)

  await db.publish('v1', { skipVersioning: true })

  let { manifest: man2, schema } = await db.packages.export()

  t.same(schema.messages[0].messages.length, 7)
  t.same(schema.services[4].name, 'Location')
  t.same(man2.version, 'v1')

  await create.close()
  t.end()
})

test('can publish a package with a simple import and alias', async t => {
  let [ db1, db2 ] = await create.fromPackages([
    p.join(PACKAGE_ROOT, 'location-tagger'),
    p.join(PACKAGE_ROOT, 'animals')
  ])

  await db1.publish('v1-alpha', { skipVersioning: true })

  let key = db1.key
  let { manifest, interface: iface } = await db2.packages.export()
  manifest.dependencies['location-tagger'] = {
    key: datEncoding.encode(key),
    version: 'v1-alpha'
  }
  await db2.updatePackage(iface, manifest)

  await db2.publish('v1', { skipVersioning: true })
  let { manifest: man2, schema, proto } = await db2.packages.export()
  t.same(man2.version, 'v1')
  t.same(schema.messages[0].messages.length, 20)

  await create.close()
  t.end()
})

test('can publish a package with multiple imports and a complicated interface', async t => {
  let [ db1, db2, db3, db4 ] = await create.fromPackages([
    p.join(PACKAGE_ROOT, 'location-tagger'),
    p.join(PACKAGE_ROOT, '@seedpod-actions'),
    p.join(PACKAGE_ROOT, 'animals'),
    p.join(PACKAGE_ROOT, 'dogs')
  ])

  await db1.publish('v1', { skipVersioning: true })
  let locationKey = db1.key
  await db2.publish('v1', { skipVersioning: true })
  let seedpodKey = db2.key

  let { manifest: m1, interface: i1 } = await db3.packages.export()
  m1.dependencies['location-tagger'] = {
    key: datEncoding.encode(locationKey),
    version: 'v1'
  }
  await db3.updatePackage(i1, m1)
  await db3.publish('v1', { skipVersioning: true })
  let animalsKey = db3.key

  let { manifest: m2, interface: i2 } = await db4.packages.export()
  m2.dependencies['animals'] = {
    key: datEncoding.encode(animalsKey),
    version: 'v1'
  }
  m2.dependencies['@seedpod/actions'] = {
    key: datEncoding.encode(seedpodKey),
    version: 'v1'
  }
  await db4.updatePackage(i2, m2)
  await db4.publish('v1', { skipVersioning: true })

  let { manifest: m3, proto, schema } = await db4.packages.export()
  t.same(m3.version, 'v1')
  // TODO: test the resulting schema structure.
  t.same(schema.messages[0].messages.length, 25)

  await create.close()
  t.end()
})
