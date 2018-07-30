module.exports.BUILTIN_TYPES = new Set([
  // Protocol Buffers primitives
  'uint8', 'uint16', 'uint32', 'uint64',
  'int8', 'int16', 'int32', 'int64',
  'float', 'double',
  'string',
  'bytes', 'any',
  // Baked-in Seedpod types
  'Id', 'Void', 'DatabaseResponse'
])

module.exports.NUMBER_TYPES = new Set([
  'uint8', 'uint16', 'uint32', 'uint64',
  'int8', 'int16', 'int32', 'int64',
  'float', 'double'
])

module.exports.graph = {
  seedpod: {
    preds: {
      IS: 'seedpod:is',
      HAS: 'seedpod:has',
      HEAD: 'seedpod:head',
      PREV: 'seedpod:prev'
    },
    subjects: {
      DELETIONS: 'deletions'
    }
  },
  type: {},
  field: {}
}
