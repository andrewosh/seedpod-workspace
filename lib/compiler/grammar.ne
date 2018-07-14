# Grammar definition for the Seedpod interface description language.
@{%
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

function optionalFieldTransform (x) {return x.slice(0, x.length - 2)
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
    enum: { match: 'enum', push: 'enum' },
    sparql: { match: 'sparql query', push: 'sparqlQuery' }
  },

  // import states
  import: {
    NL: newline,
    SP: space,
    leftbrace: { match: /\{/, push: 'singleImport' },
    from: 'from',
    packageName: { match: /'[a-zA-z0-0]+'/, pop: true, value: packageTransform }
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
  }, field: {
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
    colon: { match: ':', push: 'queryType' }
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
  queryType: {
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
});
let lexerNext = lexer.next.bind(lexer)
lexer.next = () => {
  let next = lexerNext()
  if (!next || next.type !== 'SP') return next
  return lexer.next()
}
%}

@lexer lexer

@{%
function nuller () {
  return null
}
%}

# Top-level production rules.
Sourcefile -> (Import | Type | Enum | Query):* {% id %}

# Import-related production rules.
Import -> ImportStart TypeImport:+ ImportEnd Space {%
  ([, types, packageName]) => {
    return {
      nodeType: 'import',
      packageName: packageName,
      types: types
    }
  }
%}
ImportStart -> "import" LeftBrace {% nuller %}
ImportEnd ->  RightBrace "from" %packageName {% ([, , pkgName]) => {return pkgName.value
  }
%}
TypeImport -> %importName %importAlias:? %comma:? Space:? {%
  ([importName, , importAlias]) => {
    return {
      name: importName.value,
      alias: importAlias ? importAlias.value : null
    }
  }
%}

# Type-related production rules.
Type -> TypeSignature LeftBrace Field:* Space:? RightBrace {%
  ([signature, , fields]) => {
    return {
      nodeType: 'type',
      signature: signature,
      fields: fields
    }
  }
%}
TypeSignature -> "type" %typeName %typeParent:? Space:? {%
  ([, typeName, typeParent]) => {
     return {
       typeName: typeName.value,
       typeParent: typeParent ? typeParent.value : null
     } 
  }
%}
Field -> (RequiredField | OptionalField) (SingleType | ArrayType) Space {%
  ([[fieldName], [fieldType]]) => {
  console.log('fieldName:', fieldName)
  console.log('fieldType:', fieldType)
    return {
      fieldName: fieldName.value,
      isOptional: (fieldName.type === 'optionalField'),
      fieldType: fieldType.value,
      isArray: (fieldType.type === 'arrayType')
    }
  }
%}

# Enum-related production rules.
Enum -> "enum" %enumName LeftBrace EnumValue:+ RightBrace {%
  ([, enumName, , enumValues]) => {
    return {
      nodeType: 'enum',
      name: enumName.value,
      values: enumValues
    } 
  }
%}
EnumValue -> %enumValue %comma:? Space:? {% ([enumValue]) => enumValue.value %}

# Query-related production rules.
Query -> SparqlQuery {% id %}
SparqlQuery -> %sparql %queryName QueryArgs %colon QueryType LeftBrace QueryBody {%
  ([, name, args, , type, , body]) => {
    return {
      nodeType: 'sparql',
      name: name.value,
      args: args,
      type: type,
      body: body
    }
  }
%}
QueryArgs -> %leftparen (QueryArg %comma:?):* %rightparen {%
  ([, params, ]) => {
    return params.map(([arg]) => {
      return arg 
    })
  }  
%}
QueryArg -> (%optionalParamName | %requiredParamName) (%singleParamType | %arrayParamType) {%
  ([[name], [type]]) => {
    console.log('NAME:', name, 'TYPE:', type)
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
%}
QueryType -> %singleQueryType | %arrayQueryType {%
  ([type]) => {
   return {
     isArray: (type.type === 'arrayQueryType'),
     name: type.value
    }
  }
%}
QueryBody -> %queryContent:+ %queryBodyClose Space:* {%
  ([contents]) => contents.join('')
%}

RequiredField -> %requiredField {% id %}
OptionalField -> %optionalField {% id %}
SingleType -> %singleType {% id %}
ArrayType -> %arrayType {% id %}

RightBrace -> %rightbrace Space:? {% nuller %}
LeftBrace -> %leftbrace Space:? {% nuller %}
Space -> %NL:+ {% nuller %}
