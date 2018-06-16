var p = require('path')
var fs = require('fs')
var test = require('tape')

var create = require('./helpers/create')

var schemaPath = p.join(__dirname, './data/schemas')
var baseSchema = fs.readFileSync(p.join(schemaPath, 'base.proto'))
var compatibleSchema = fs.readFileSync(p.join(schemaPath, 'compatible.proto'))
var incompatibleSchema = fs.readFileSync(p.join(schemaPath, 'incompatible.proto'))
var consumerSchema = fs.readFileSync(p.join(schemaPath, 'dog_consumer.proto'))

test('should register a simple, single-type package', async t => {
  t.plan(9)

  let tdb = await create.one()
  tdb.registerTypes(baseSchema, function (err, typesToVersions) {
    t.error(err)
    t.same(typesToVersions['Dog'], '1.0')
    t.same(typesToVersions['Breed'], '1.0')
    tdb.insert('animals.Dog', {
      name: 'Heidi',
      breed: {
        name: 'German Shepherd',
        populationCount: 100
      }
    }, function (err, id) {
      t.error(err)
      t.true(id)
      tdb.get('animals.Dog', id, function (err, dog) {
        t.error(err)
        t.same(dog.name, 'Heidi')
        t.same(dog.breed.name, 'German Shepherd')
        t.same(dog.breed.populationCount, 100)
        create.close().then(() => {
          t.end()
        })
      })
    })
  })
})

test('should bump minor version for backward-compatible type update', async t => {
  t.plan(10)

  let tdb = await create.one()
  tdb.registerTypes(baseSchema, function (err, typesToVersions) {
    t.error(err)
    tdb.registerTypes(compatibleSchema, function (err, typesToVersions) {
      t.error(err)
      t.same(typesToVersions['Dog'], '1.1')
      t.same(typesToVersions['Breed'], '1.1')
      tdb.insert('animals.Dog', {
        name: 'Heidi',
        breed: {
          name: 'German Shepherd',
          populationCount: 100
        }
      }, function (err, id) {
        t.error(err)
        t.true(id)
        tdb.get('animals.Dog', id, function (err, dog) {
          t.error(err)
          t.same(dog.name, 'Heidi')
          t.same(dog.breed.name, 'German Shepherd')
          t.same(dog.breed.populationCount, 100)
          create.close().then(() => {
            t.end()
          })
        })
      })
    })
  })
})

test('should bump major version for incompatible updates', async t => {
  t.plan(10)

  let tdb = await create.one()
  tdb.registerTypes(baseSchema, function (err, typesToVersions) {
    t.error(err)
    tdb.registerTypes(incompatibleSchema, function (err, typesToVersions) {
      t.error(err)
      t.same(typesToVersions['Dog'], '2.0')
      t.same(typesToVersions['Breed'], '2.0')
      tdb.insert('animals.Dog', {
        dogName: 'Heidi',
        breed: {
          name: 'German Shepherd',
          popCount: 100
        }
      }, function (err, id) {
        t.error(err)
        t.true(id)
        tdb.get('animals.Dog', id, function (err, dog) {
          t.error(err)
          t.same(dog.dogName, 'Heidi')
          t.same(dog.breed.name, 'German Shepherd')
          t.same(dog.breed.popCount, 100)
          create.close().then(() => {
            t.end()
          })
        })
      })
    })
  })
})

test('gets should get latest version unless specified', async t => {
  t.plan(8)

  let tdb = await create.one()
  tdb.registerTypes(baseSchema, function (err, typesToVersions) {
    t.error(err)
    tdb.insert('animals.Dog', {
      name: 'Heidi',
      breed: {
        name: 'German Shepherd',
        populationCount: 100
      }
    }, function (err, id) {
      t.error(err)
      tdb.registerTypes(incompatibleSchema, function (err, typesToVersions) {
        t.error(err)
        t.true(id)
        tdb.get('animals.Dog', id, function (err, dog) {
          t.error(err)
          t.same(dog, null)
          tdb.get('animals.Dog@1.0', id, function (err, dog) {
            t.error(err)
            t.same(dog.name, 'Heidi')
            create.close().then(() => {
              t.end()
            })
          })
        })
      })
    })
  })
})

test('should not be able to create typed records before registration', async t => {
  t.plan(1)

  let tdb = await create.one()
  tdb.insert('animals.Dog', {
    name: 'Heidi',
    breed: {
      name: 'Terrier',
      populationCount: 5
    }
  }, function (err) {
    t.true(err)
    create.close().then(() => {
      t.end()
    })
  })
})

test('should be able to reference other packages via fully-qualified names', async t => {
  t.plan(3)

  let tdb = await create.one()
  tdb.registerTypes(baseSchema, function (err, _) {
    t.error(err)
    tdb.registerTypes(consumerSchema, function (err, _) {
      t.error(err)
      tdb.insert('spca.Shelter', {
        name: 'Seattle SPCA',
        dogs: [
          {
            name: 'Popchop',
            breed: {
              name: 'Pug',
              populationCount: 500
            }
          }
        ]
      }, function (err) {
        t.error(err)
        create.close().then(() => {
          t.end()
        })
      })
    })
  })
})

test('should be able to use types from other workspaces', async t => {
  t.plan(5)

  let [tdb1, tdb2] = await create.twoShared()
  tdb1.registerTypes(baseSchema, function (err) {
    t.error(err)
    tdb2.importPackages(tdb1.key, ['animals'], function (err) {
      t.error(err)
      tdb2.insert('animals.Dog', {
        name: 'Popchop',
        breed: {
          name: 'Pug',
          populationCount: 5000
        }
      }, function (err, id) {
        t.error(err)
        tdb2.get('animals.Dog', id, function (err, dog) {
          t.error(err)
          t.same(dog.name, 'Popchop')
          create.close().then(() => {
            t.end()
          })
        })
      })
    })
  })
})

test('should be able to delete records', async t => {
  let tdb = await create.one()

  tdb.registerTypes(baseSchema, err => {
    t.error(err)
    tdb.insert('animals.Dog', {
      name: 'Popchop',
      breed: {
        name: 'Pug',
        populationCount: 5454
      }
    }, (err, id) => {
      t.error(err)
      t.true(id)
      tdb.delete('animals.Dog', id, err => {
        t.error(err)
        tdb.get('animals.Dog', id, (err, record) => {
          t.error(err)
          t.false(record)
          create.close().then(() => {
            t.end()
          })
        })
      })
    })
  })
})
