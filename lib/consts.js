module.exports.BUILTIN_TYPES = new Set([
  // Protocol Buffers primitives
  'uint8', 'uint16', 'uint32', 'uint64',
  'int8', 'int16', 'int32', 'int64',
  'float', 'string', 'bytes', 'any',
  // Baked-in Seedpod types
  'Id', 'Void'
])

module.exports.graph = {
  types: {
    IS: '@is'
  },
  revs: {
    LATEST: '@latest',
    DELETED: '@deleted',
    PREV: '@prev'
  }
}
