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
    action: { match: 'action', push: 'type' },
    enum: { match: 'enum', push: 'enum' },
    trigger: { match: 'trigger', push: 'trigger' },
    query: { match: 'query', push: 'function' },
    method: { match: 'method', push: 'function' }
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
    fieldModifier: { match: /\@[a-zA-Z]+/ },
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

  // function states
  function: {
    SP: space,
    NL: newline,
    functionName: /[a-zA-Z0-9]+/,
    leftparen: { match: '(', push: 'functionArgs' },
    colon: { match: ':', push: 'functionReturn' }
  },
  functionArgs: {
    SP: space,
    NL: newline,
    rightparen: { match: ')', pop: true },
    comma: { match: ',', next: 'functionArgs' },
    optionalParamName: optionalField,
    requiredParamName: requiredField,
    singleParamType: singleType,
    arrayParamType: arrayType
  },
  functionReturn: {
    SP: space,
    NL: Object.assign({}, newline, { next: 'functionBody' }),
    emptyBody: { match: '{}', next: 'main' },
    singleFunctionType: singleType,
    arrayFunctionType: arrayType,
    leftbrace: '{'
  },
  functionBody: {
    functionBodyClose: { match: /^\}/, next: 'main' },
    functionContent: { match: /[^]+?/, lineBreaks: true }
  },

  // trigger states
  trigger: {
    NL: Object.assign({}, newline, { push: 'triggerBody'}),
    SP: space,
    triggerName: /[a-zA-Z0-9]+/ ,
    leftparen: { match: '(', push: 'triggerType' },
    leftbrace: '{'
  },
  triggerType: {
    SP: space,
    NL: newline,
    rightparen: { match: ')', pop: true },
    requiredParamName: requiredField,
    singleParamType: singleType,
  },
  triggerBody: {
    triggerBodyClose: { match: /^\}/, next: 'main' },
    triggerContent: { match: /[^]+?/, lineBreaks: true }
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
Sourcefile -> (Import | Type | Enum | Trigger | Method | Query):+ {% id %}

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
ImportEnd ->  RightBrace "from" %packageName {%
  ([, , pkgName]) => {
    return pkgName.value
  }
%}
TypeImport -> %importName %importAlias:? %comma:? Space:? {%
  ([importName, importAlias]) => {
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
TypeSignature -> (%type | %struct | %action) %typeName %typeParent:? Space:? {%
  ([typeType, typeName, typeParent]) => {
     return {
       typeName: typeName.value,
       typeParent: typeParent ? typeParent.value : null,
       isStruct: (typeType[0].type === 'struct'),
       isAction: (typeType[0].type === 'action')
     }
  }
%}
Field -> (RequiredField | OptionalField) %fieldModifier:? (SingleType | ArrayType) Space {%
  ([[fieldName], modifier, [fieldType]]) => {
    return {
      fieldName: fieldName.value,
      modifier: modifier ? modifier.value.slice(1) : null,
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

# Function-related production rules.
Query -> %query Function {%
  ([, { name, args, returns, body }]) => {
    return {
      nodeType: 'query',
      name,
      args,
      returns,
      body
    }
  }
%}
Method -> %method Function {%
  ([, { name, args, returns, body }]) => {
    return {
      nodeType: 'method',
      name,
      args,
      returns
    }
  }
%}
Function -> %functionName FunctionArgs %colon FunctionReturn (LeftBrace | %emptyBody) Space:? FunctionBody:? {%
  ([name, args, , type, , , body]) => {
    return {
      nodeType: 'function',
      name: name.value,
      args: args,
      returns: type,
      body: body
    }
  }
%}
FunctionArgs -> %leftparen (FunctionArg %comma:?):? %rightparen {%
  ([, params, ]) => {
    if (!params) return null
    return params.filter(n => n)
  }
%}
FunctionArg -> (%optionalParamName | %requiredParamName) (%singleParamType | %arrayParamType) {%
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
%}
FunctionReturn -> (%singleFunctionType | %arrayFunctionType) {%
  ([[type]]) => {
   return {
     isArray: (type.type === 'arrayFunctionType'),
     name: type.value
    }
  }
%}
FunctionBody -> %functionContent:+ %functionBodyClose Space:* {%
  ([contents]) => contents.join('')
%}

# Trigger-related production rules.
Trigger -> %trigger %triggerName TriggerType LeftBrace TriggerBody {%
  ([, name, type, , body]) => {
    return {
      nodeType: 'trigger',
      name: name.value,
      returns: type,
      body: body
    }
  }
%}
TriggerType -> %leftparen SingleTriggerType %rightparen {% ([, type, ]) => type %}
SingleTriggerType -> %requiredParamName %singleParamType {%
  ([name, type]) => {
    return {
      name: name.value,
      type: type.value
    }
  }
%}
TriggerBody -> %triggerContent:+ %triggerBodyClose Space:* {%
  ([contents]) => contents.join('')
%}

RequiredField -> %requiredField {% id %}
OptionalField -> %optionalField {% id %}
SingleType -> %singleType {% id %}
ArrayType -> %arrayType {% id %}

RightBrace -> %rightbrace Space:? {% nuller %}
LeftBrace -> %leftbrace Space:? {% nuller %}
Space -> %NL:+ {% nuller %}
