const p = require('path')
const fs = require('fs-extra')
const protoSchema = require('protocol-buffers-schema')
const datEncoding = require('dat-encoding')

const create = require('./helpers/create.js')
const test = require('tape')

const PACKAGE_ROOT = p.join(__dirname, 'data', 'packages')

test('can import interface/manifest files into an empty package database', async t => {
  let [ db ] = await create.fromPackages([ p.join(PACKAGE_ROOT, 'location') ])
  let { manifest, interface: iface } = await db.packages.getLatestPackageFiles()
  t.same(manifest.name, 'location-tagger')
  t.true(iface.length > 0)
  await create.close()
  t.end()
})

test('can update previously imported interface/manifest files', async t => {
  let [ db ] = await create.fromPackages([ p.join(PACKAGE_ROOT, 'location') ])
  let { manifest, interface: iface } = await db.packages.getLatestPackageFiles()
  t.same(manifest.name, 'location-tagger')
  t.true(iface.length > 0)
  let ifaceLength = iface.length

  manifest = await fs.readFile(p.join(PACKAGE_ROOT, 'animals', 'manifest.json'), 'utf8')
  iface = await fs.readFile(p.join(PACKAGE_ROOT, 'animals', 'interface.spdl'), 'utf8')
  await db.updatePackage(iface, manifest)

  let { manifest: man2, interface: iface2 } = await db.packages.getLatestPackageFiles()
  t.same(man2.name, 'animals')
  t.notEqual(iface2.length, ifaceLength)

  await create.close()
  t.end()
})

test('can publish an updated package', async t => {
  let [ db ] = await create.fromPackages([ p.join(PACKAGE_ROOT, 'location') ])
  let { manifest, interface: iface } = await db.packages.getLatestPackageFiles()
  t.same(manifest.name, 'location-tagger')
  t.true(iface.length > 0)

  await db.publish('v1')

  let { manifest: man2, schema } = await db.packages.getLatestPackageFiles()
  let parsed = protoSchema.parse(schema)

  t.same(parsed.messages.length, 2)
  t.same(parsed.services[1].name, 'Location')
  t.same(man2.version, 'v1')

  await create.close()
  t.end()
})

test('can publish a package with a simple import', async t => {
  let [ db1, db2 ] = await create.fromPackages([
    p.join(PACKAGE_ROOT, 'location'),
    p.join(PACKAGE_ROOT, 'animals')
  ])

  await db1.publish('v1-alpha')
  let key = db1.key

  let { manifest, interface: iface } = await db2.packages.getLatestPackageFiles()
  manifest.dependencies['location-tagger'] = {
    key: datEncoding.encode(key),
    version: 'v1-alpha'
  }
  await db2.updatePackage(iface, manifest)
  await db2.publish('v1')
})
