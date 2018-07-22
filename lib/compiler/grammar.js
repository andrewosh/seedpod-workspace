// Generated automatically by nearley, version 2.12.1
// http://github.com/Hardmath123/nearley
(function () {
  function id (x) { return x[0] }

  const moo = require('moo')

  const space = { match: / +/ }
  const newline = { match: /\n+/, lineBreaks: true }

  const requiredField = { match: /[a-z][a-zA-Z0-9]+:/, value: requiredFieldTransform }
  const optionalField = { match: /[a-z][a-zA-Z0-9]+\?:/, value: optionalFieldTransform }
  const arrayType = { match: /\[[a-zA-Z0-9]+\]/, value: arrayTypeTransform }
  const singleType = { match: /[a-zA-Z0-9]+/ }

  function requiredFieldTransform (x) {
    return x.slice(0, x.length - 1)
  }

  function optionalFieldTransform (x) {
    return x.slice(0, x.length - 2)
  }

  function parentTransform (x) {
    return x.slice('extends'.length).trim()
  }

  function arrayTypeTransform (x) {
    return x.slice(1, -1)
  }

  function aliasTransform (x) {
    return x.slice('as '.length)
  }

  function packageTransform (x) {
    return x.slice(1, -1)
  }

  const lexer = moo.states({
    main: {
      SP: space,
      NL: newline,
      import: { match: 'import', push: 'import' },
      type: { match: 'type', push: 'type' },
      struct: { match: 'struct', push: 'type' },
      tagType: { match: 'tag type', push: 'type' },
      action: { match: 'action', push: 'type' },
      enum: { match: 'enum', push: 'enum' },
      sparql: { match: 'sparql query', push: 'sparqlQuery' }
    },

  // import states
    import: {
      NL: newline,
      SP: space,
      leftbrace: { match: /\{/, push: 'singleImport' },
      from: 'from',
      packageName: { match: /'@?[a-zA-z0-0\/\.\-]+'/, pop: true, value: packageTransform }
    },
    singleImport: {
      NL: newline,
      SP: space,
      rightbrace: { match: '}', pop: true },
      importAlias: { match: /as [a-zA-Z0-9]+/, value: aliasTransform },
      importName: /[a-zA-Z0-9]+/,
      comma: ','
    },

  // type states
    type: {
      NL: Object.assign({}, newline, { push: 'field'}),
      SP: space,
      rightbrace: { match: '}', pop: true },
      typeName: /[A-Z][a-zA-Z0-9]+/,
      typeParent: { match: /extends\s+[A-Z][a-zA-Z0-9]+/, value: parentTransform },
      leftbrace: '{'
    },
    field: {
      SP: space,
      requiredField,
      optionalField,
      singleType: Object.assign({}, singleType, { pop: true }),
      arrayType: Object.assign({}, arrayType, { pop: true }),

    // Since fields are newline-delimited, the final rightbrace must be processed in the field state.
      rightbrace: { match: '}', next: 'main' }
    },

  // enum states
    enum: {
      SP: space,
      NL: Object.assign({}, newline, { push: 'enumValues' }),
      enumName: /[A-Z][a-zA-Z0-9]+/,
      leftbrace: '{'
    },
    enumValues: {
      SP: space,
      NL: newline,
      comma: ',',
      enumValue: /[a-zA-Z][a-zA-Z0-9]+/,
      rightbrace: { match: '}', next: 'main' }
    },

  // sparql query states
    sparqlQuery: {
      SP: space,
      NL: newline,
      queryName: /[a-zA-Z0-9]+/,
      leftparen: { match: '(', push: 'queryArgs' },
      colon: { match: ':', push: 'queryReturn' }
    },
    queryArgs: {
      SP: space,
      NL: newline,
      rightparen: { match: ')', pop: true },
      comma: { match: ',', next: 'queryArgs' },
      optionalParamName: optionalField,
      requiredParamName: requiredField,
      singleParamType: singleType,
      arrayParamType: arrayType
    },
    queryReturn: {
      SP: space,
      NL: Object.assign({}, newline, { next: 'queryBody' }),
      singleQueryType: singleType,
      arrayQueryType: arrayType,
      leftbrace: '{'
    },
    queryBody: {
      queryBodyClose: { match: /^\}/, next: 'main' },
      queryContent: { match: /[^]+/, lineBreaks: true }
    }
  })
  let lexerNext = lexer.next.bind(lexer)
  lexer.next = () => {
    let next = lexerNext()
    if (!next || next.type !== 'SP') return next
    return lexer.next()
  }

  function nuller () {
    return null
  }
  var grammar = {
    Lexer: lexer,
    ParserRules: [
    {'name': 'Sourcefile$ebnf$1$subexpression$1', 'symbols': ['Import']},
    {'name': 'Sourcefile$ebnf$1$subexpression$1', 'symbols': ['Type']},
    {'name': 'Sourcefile$ebnf$1$subexpression$1', 'symbols': ['Enum']},
    {'name': 'Sourcefile$ebnf$1$subexpression$1', 'symbols': ['Query']},
    {'name': 'Sourcefile$ebnf$1', 'symbols': ['Sourcefile$ebnf$1$subexpression$1']},
    {'name': 'Sourcefile$ebnf$1$subexpression$2', 'symbols': ['Import']},
    {'name': 'Sourcefile$ebnf$1$subexpression$2', 'symbols': ['Type']},
    {'name': 'Sourcefile$ebnf$1$subexpression$2', 'symbols': ['Enum']},
    {'name': 'Sourcefile$ebnf$1$subexpression$2', 'symbols': ['Query']},
    {'name': 'Sourcefile$ebnf$1', 'symbols': ['Sourcefile$ebnf$1', 'Sourcefile$ebnf$1$subexpression$2'], 'postprocess': function arrpush (d) { return d[0].concat([d[1]]) }},
    {'name': 'Sourcefile', 'symbols': ['Sourcefile$ebnf$1'], 'postprocess': id},
    {'name': 'Import$ebnf$1', 'symbols': ['TypeImport']},
    {'name': 'Import$ebnf$1', 'symbols': ['Import$ebnf$1', 'TypeImport'], 'postprocess': function arrpush (d) { return d[0].concat([d[1]]) }},
      {'name': 'Import',
        'symbols': ['ImportStart', 'Import$ebnf$1', 'ImportEnd', 'Space'],
        'postprocess':
        ([, types, packageName]) => {
          return {
            nodeType: 'import',
            packageName: packageName,
            types: types
          }
        }
      },
    {'name': 'ImportStart', 'symbols': [{'literal': 'import'}, 'LeftBrace'], 'postprocess': nuller},
      {'name': 'ImportEnd',
        'symbols': ['RightBrace', {'literal': 'from'}, (lexer.has('packageName') ? {type: 'packageName'} : packageName)],
        'postprocess':
        ([, , pkgName]) => {
          return pkgName.value
        }
      },
    {'name': 'TypeImport$ebnf$1', 'symbols': [(lexer.has('importAlias') ? {type: 'importAlias'} : importAlias)], 'postprocess': id},
    {'name': 'TypeImport$ebnf$1', 'symbols': [], 'postprocess': function (d) { return null }},
    {'name': 'TypeImport$ebnf$2', 'symbols': [(lexer.has('comma') ? {type: 'comma'} : comma)], 'postprocess': id},
    {'name': 'TypeImport$ebnf$2', 'symbols': [], 'postprocess': function (d) { return null }},
    {'name': 'TypeImport$ebnf$3', 'symbols': ['Space'], 'postprocess': id},
    {'name': 'TypeImport$ebnf$3', 'symbols': [], 'postprocess': function (d) { return null }},
      {'name': 'TypeImport',
        'symbols': [(lexer.has('importName') ? {type: 'importName'} : importName), 'TypeImport$ebnf$1', 'TypeImport$ebnf$2', 'TypeImport$ebnf$3'],
        'postprocess':
        ([importName, importAlias]) => {
          return {
            name: importName.value,
            alias: importAlias ? importAlias.value : null
          }
        }
      },
    {'name': 'Type$ebnf$1', 'symbols': []},
    {'name': 'Type$ebnf$1', 'symbols': ['Type$ebnf$1', 'Field'], 'postprocess': function arrpush (d) { return d[0].concat([d[1]]) }},
    {'name': 'Type$ebnf$2', 'symbols': ['Space'], 'postprocess': id},
    {'name': 'Type$ebnf$2', 'symbols': [], 'postprocess': function (d) { return null }},
      {'name': 'Type',
        'symbols': ['TypeSignature', 'LeftBrace', 'Type$ebnf$1', 'Type$ebnf$2', 'RightBrace'],
        'postprocess':
        ([signature, , fields]) => {
          return {
            nodeType: 'type',
            signature: signature,
            fields: fields
          }
        }
      },
    {'name': 'TypeSignature$subexpression$1', 'symbols': [(lexer.has('type') ? {type: 'type'} : type)]},
    {'name': 'TypeSignature$subexpression$1', 'symbols': [(lexer.has('tagType') ? {type: 'tagType'} : tagType)]},
    {'name': 'TypeSignature$subexpression$1', 'symbols': [(lexer.has('struct') ? {type: 'struct'} : struct)]},
    {'name': 'TypeSignature$subexpression$1', 'symbols': [(lexer.has('action') ? {type: 'action'} : action)]},
    {'name': 'TypeSignature$ebnf$1', 'symbols': [(lexer.has('typeParent') ? {type: 'typeParent'} : typeParent)], 'postprocess': id},
    {'name': 'TypeSignature$ebnf$1', 'symbols': [], 'postprocess': function (d) { return null }},
    {'name': 'TypeSignature$ebnf$2', 'symbols': ['Space'], 'postprocess': id},
    {'name': 'TypeSignature$ebnf$2', 'symbols': [], 'postprocess': function (d) { return null }},
      {'name': 'TypeSignature',
        'symbols': ['TypeSignature$subexpression$1', (lexer.has('typeName') ? {type: 'typeName'} : typeName), 'TypeSignature$ebnf$1', 'TypeSignature$ebnf$2'],
        'postprocess':
        ([typeType, typeName, typeParent]) => {
          return {
            typeName: typeName.value,
            typeParent: typeParent ? typeParent.value : null,
            isTag: (typeType[0].type === 'tagType'),
            isStruct: (typeType[0].type === 'struct'),
            isAction: (typeType[0].type === 'action')
          }
        }
      },
    {'name': 'Field$subexpression$1', 'symbols': ['RequiredField']},
    {'name': 'Field$subexpression$1', 'symbols': ['OptionalField']},
    {'name': 'Field$subexpression$2', 'symbols': ['SingleType']},
    {'name': 'Field$subexpression$2', 'symbols': ['ArrayType']},
      {'name': 'Field',
        'symbols': ['Field$subexpression$1', 'Field$subexpression$2', 'Space'],
        'postprocess':
        ([[fieldName], [fieldType]]) => {
          return {
            fieldName: fieldName.value,
            isOptional: (fieldName.type === 'optionalField'),
            fieldType: fieldType.value,
            isArray: (fieldType.type === 'arrayType')
          }
        }
      },
    {'name': 'Enum$ebnf$1', 'symbols': ['EnumValue']},
    {'name': 'Enum$ebnf$1', 'symbols': ['Enum$ebnf$1', 'EnumValue'], 'postprocess': function arrpush (d) { return d[0].concat([d[1]]) }},
      {'name': 'Enum',
        'symbols': [{'literal': 'enum'}, (lexer.has('enumName') ? {type: 'enumName'} : enumName), 'LeftBrace', 'Enum$ebnf$1', 'RightBrace'],
        'postprocess':
        ([, enumName, , enumValues]) => {
          return {
            nodeType: 'enum',
            name: enumName.value,
            values: enumValues
          }
        }
      },
    {'name': 'EnumValue$ebnf$1', 'symbols': [(lexer.has('comma') ? {type: 'comma'} : comma)], 'postprocess': id},
    {'name': 'EnumValue$ebnf$1', 'symbols': [], 'postprocess': function (d) { return null }},
    {'name': 'EnumValue$ebnf$2', 'symbols': ['Space'], 'postprocess': id},
    {'name': 'EnumValue$ebnf$2', 'symbols': [], 'postprocess': function (d) { return null }},
    {'name': 'EnumValue', 'symbols': [(lexer.has('enumValue') ? {type: 'enumValue'} : enumValue), 'EnumValue$ebnf$1', 'EnumValue$ebnf$2'], 'postprocess': ([enumValue]) => enumValue.value},
    {'name': 'Query', 'symbols': ['SparqlQuery'], 'postprocess': id},
      {'name': 'SparqlQuery',
        'symbols': [(lexer.has('sparql') ? {type: 'sparql'} : sparql), (lexer.has('queryName') ? {type: 'queryName'} : queryName), 'QueryArgs', (lexer.has('colon') ? {type: 'colon'} : colon), 'QueryReturn', 'LeftBrace', 'QueryBody'],
        'postprocess':
        ([, name, args, , type, , body]) => {
          return {
            nodeType: 'sparql',
            name: name.value,
            args: args,
            returns: type,
            body: body
          }
        }
      },
    {'name': 'QueryArgs$ebnf$1', 'symbols': []},
    {'name': 'QueryArgs$ebnf$1$subexpression$1$ebnf$1', 'symbols': [(lexer.has('comma') ? {type: 'comma'} : comma)], 'postprocess': id},
    {'name': 'QueryArgs$ebnf$1$subexpression$1$ebnf$1', 'symbols': [], 'postprocess': function (d) { return null }},
    {'name': 'QueryArgs$ebnf$1$subexpression$1', 'symbols': ['QueryArg', 'QueryArgs$ebnf$1$subexpression$1$ebnf$1']},
    {'name': 'QueryArgs$ebnf$1', 'symbols': ['QueryArgs$ebnf$1', 'QueryArgs$ebnf$1$subexpression$1'], 'postprocess': function arrpush (d) { return d[0].concat([d[1]]) }},
      {'name': 'QueryArgs',
        'symbols': [(lexer.has('leftparen') ? {type: 'leftparen'} : leftparen), 'QueryArgs$ebnf$1', (lexer.has('rightparen') ? {type: 'rightparen'} : rightparen)],
        'postprocess':
        ([, params ]) => {
          return params.map(([arg]) => {
            return arg
          })
        }
      },
    {'name': 'QueryArg$subexpression$1', 'symbols': [(lexer.has('optionalParamName') ? {type: 'optionalParamName'} : optionalParamName)]},
    {'name': 'QueryArg$subexpression$1', 'symbols': [(lexer.has('requiredParamName') ? {type: 'requiredParamName'} : requiredParamName)]},
    {'name': 'QueryArg$subexpression$2', 'symbols': [(lexer.has('singleParamType') ? {type: 'singleParamType'} : singleParamType)]},
    {'name': 'QueryArg$subexpression$2', 'symbols': [(lexer.has('arrayParamType') ? {type: 'arrayParamType'} : arrayParamType)]},
      {'name': 'QueryArg',
        'symbols': ['QueryArg$subexpression$1', 'QueryArg$subexpression$2'],
        'postprocess':
        ([[name], [type]]) => {
          return {
            paramName: {
              isOptional: (name.type === 'optionalParamName'),
              name: name.value
            },
            paramType: {
              isArray: (type.type === 'arrayParamType'),
              name: type.value
            }
          }
        }
      },
    {'name': 'QueryReturn', 'symbols': [(lexer.has('singleQueryType') ? {type: 'singleQueryType'} : singleQueryType)]},
      {'name': 'QueryReturn',
        'symbols': [(lexer.has('arrayQueryType') ? {type: 'arrayQueryType'} : arrayQueryType)],
        'postprocess':
        ([type]) => {
          return {
            isArray: (type.type === 'arrayQueryType'),
            name: type.value
          }
        }
      },
    {'name': 'QueryBody$ebnf$1', 'symbols': [(lexer.has('queryContent') ? {type: 'queryContent'} : queryContent)]},
    {'name': 'QueryBody$ebnf$1', 'symbols': ['QueryBody$ebnf$1', (lexer.has('queryContent') ? {type: 'queryContent'} : queryContent)], 'postprocess': function arrpush (d) { return d[0].concat([d[1]]) }},
    {'name': 'QueryBody$ebnf$2', 'symbols': []},
    {'name': 'QueryBody$ebnf$2', 'symbols': ['QueryBody$ebnf$2', 'Space'], 'postprocess': function arrpush (d) { return d[0].concat([d[1]]) }},
      {'name': 'QueryBody',
        'symbols': ['QueryBody$ebnf$1', (lexer.has('queryBodyClose') ? {type: 'queryBodyClose'} : queryBodyClose), 'QueryBody$ebnf$2'],
        'postprocess':
        ([contents]) => contents.join('')
      },
    {'name': 'RequiredField', 'symbols': [(lexer.has('requiredField') ? {type: 'requiredField'} : requiredField)], 'postprocess': id},
    {'name': 'OptionalField', 'symbols': [(lexer.has('optionalField') ? {type: 'optionalField'} : optionalField)], 'postprocess': id},
    {'name': 'SingleType', 'symbols': [(lexer.has('singleType') ? {type: 'singleType'} : singleType)], 'postprocess': id},
    {'name': 'ArrayType', 'symbols': [(lexer.has('arrayType') ? {type: 'arrayType'} : arrayType)], 'postprocess': id},
    {'name': 'RightBrace$ebnf$1', 'symbols': ['Space'], 'postprocess': id},
    {'name': 'RightBrace$ebnf$1', 'symbols': [], 'postprocess': function (d) { return null }},
    {'name': 'RightBrace', 'symbols': [(lexer.has('rightbrace') ? {type: 'rightbrace'} : rightbrace), 'RightBrace$ebnf$1'], 'postprocess': nuller},
    {'name': 'LeftBrace$ebnf$1', 'symbols': ['Space'], 'postprocess': id},
    {'name': 'LeftBrace$ebnf$1', 'symbols': [], 'postprocess': function (d) { return null }},
    {'name': 'LeftBrace', 'symbols': [(lexer.has('leftbrace') ? {type: 'leftbrace'} : leftbrace), 'LeftBrace$ebnf$1'], 'postprocess': nuller},
    {'name': 'Space$ebnf$1', 'symbols': [(lexer.has('NL') ? {type: 'NL'} : NL)]},
    {'name': 'Space$ebnf$1', 'symbols': ['Space$ebnf$1', (lexer.has('NL') ? {type: 'NL'} : NL)], 'postprocess': function arrpush (d) { return d[0].concat([d[1]]) }},
    {'name': 'Space', 'symbols': ['Space$ebnf$1'], 'postprocess': nuller}
    ],
    ParserStart: 'Sourcefile'
  }
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = grammar
  } else {
    window.grammar = grammar
  }
})()
