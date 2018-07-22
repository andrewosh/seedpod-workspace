const p = require('path')
const fs = require('fs-extra')

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

  manifest = JSON.parse(await fs.readFile(p.join(PACKAGE_ROOT, 'animals', 'manifest.json'), 'utf8'))
  iface = await fs.readFile(p.join(PACKAGE_ROOT, 'animals', 'interface.spdl'), 'utf8')
  console.log('manifest:', manifest)
  await db.updatePackage(iface, manifest)

  let { manifest: man2, interface: iface2 } = await db.packages.getLatestPackageFiles()
  console.log('man2:', man2)
  console.log('typeof man2', typeof man2)
  t.same(man2.name, 'animals')
  t.notEqual(iface2.length, ifaceLength)

  await create.close()
  t.end()
})

test
