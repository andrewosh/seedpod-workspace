// Generated automatically by nearley, version 2.12.1
// http://github.com/Hardmath123/nearley
(function () {
function id(x) { return x[0]; }

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


function nuller () {
  return null
}
var grammar = {
    Lexer: lexer,
    ParserRules: [
    {"name": "Sourcefile$ebnf$1$subexpression$1", "symbols": ["Import"]},
    {"name": "Sourcefile$ebnf$1$subexpression$1", "symbols": ["Type"]},
    {"name": "Sourcefile$ebnf$1$subexpression$1", "symbols": ["Enum"]},
    {"name": "Sourcefile$ebnf$1$subexpression$1", "symbols": ["Trigger"]},
    {"name": "Sourcefile$ebnf$1$subexpression$1", "symbols": ["Method"]},
    {"name": "Sourcefile$ebnf$1$subexpression$1", "symbols": ["Query"]},
    {"name": "Sourcefile$ebnf$1", "symbols": ["Sourcefile$ebnf$1$subexpression$1"]},
    {"name": "Sourcefile$ebnf$1$subexpression$2", "symbols": ["Import"]},
    {"name": "Sourcefile$ebnf$1$subexpression$2", "symbols": ["Type"]},
    {"name": "Sourcefile$ebnf$1$subexpression$2", "symbols": ["Enum"]},
    {"name": "Sourcefile$ebnf$1$subexpression$2", "symbols": ["Trigger"]},
    {"name": "Sourcefile$ebnf$1$subexpression$2", "symbols": ["Method"]},
    {"name": "Sourcefile$ebnf$1$subexpression$2", "symbols": ["Query"]},
    {"name": "Sourcefile$ebnf$1", "symbols": ["Sourcefile$ebnf$1", "Sourcefile$ebnf$1$subexpression$2"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "Sourcefile", "symbols": ["Sourcefile$ebnf$1"], "postprocess": id},
    {"name": "Import$ebnf$1", "symbols": ["TypeImport"]},
    {"name": "Import$ebnf$1", "symbols": ["Import$ebnf$1", "TypeImport"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "Import", "symbols": ["ImportStart", "Import$ebnf$1", "ImportEnd", "Space"], "postprocess": 
        ([, types, packageName]) => {
          return {
            nodeType: 'import',
            packageName: packageName,
            types: types
          }
        }
        },
    {"name": "ImportStart", "symbols": [{"literal":"import"}, "LeftBrace"], "postprocess": nuller},
    {"name": "ImportEnd", "symbols": ["RightBrace", {"literal":"from"}, (lexer.has("packageName") ? {type: "packageName"} : packageName)], "postprocess": 
        ([, , pkgName]) => {
          return pkgName.value
        }
        },
    {"name": "TypeImport$ebnf$1", "symbols": [(lexer.has("importAlias") ? {type: "importAlias"} : importAlias)], "postprocess": id},
    {"name": "TypeImport$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "TypeImport$ebnf$2", "symbols": [(lexer.has("comma") ? {type: "comma"} : comma)], "postprocess": id},
    {"name": "TypeImport$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "TypeImport$ebnf$3", "symbols": ["Space"], "postprocess": id},
    {"name": "TypeImport$ebnf$3", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "TypeImport", "symbols": [(lexer.has("importName") ? {type: "importName"} : importName), "TypeImport$ebnf$1", "TypeImport$ebnf$2", "TypeImport$ebnf$3"], "postprocess": 
        ([importName, importAlias]) => {
          return {
            name: importName.value,
            alias: importAlias ? importAlias.value : null
          }
        }
        },
    {"name": "Type$ebnf$1", "symbols": []},
    {"name": "Type$ebnf$1", "symbols": ["Type$ebnf$1", "Field"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "Type$ebnf$2", "symbols": ["Space"], "postprocess": id},
    {"name": "Type$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "Type", "symbols": ["TypeSignature", "LeftBrace", "Type$ebnf$1", "Type$ebnf$2", "RightBrace"], "postprocess": 
        ([signature, , fields]) => {
          return {
            nodeType: 'type',
            signature: signature,
            fields: fields
          }
        }
        },
    {"name": "TypeSignature$subexpression$1", "symbols": [(lexer.has("type") ? {type: "type"} : type)]},
    {"name": "TypeSignature$subexpression$1", "symbols": [(lexer.has("struct") ? {type: "struct"} : struct)]},
    {"name": "TypeSignature$subexpression$1", "symbols": [(lexer.has("action") ? {type: "action"} : action)]},
    {"name": "TypeSignature$ebnf$1", "symbols": [(lexer.has("typeParent") ? {type: "typeParent"} : typeParent)], "postprocess": id},
    {"name": "TypeSignature$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "TypeSignature$ebnf$2", "symbols": ["Space"], "postprocess": id},
    {"name": "TypeSignature$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "TypeSignature", "symbols": ["TypeSignature$subexpression$1", (lexer.has("typeName") ? {type: "typeName"} : typeName), "TypeSignature$ebnf$1", "TypeSignature$ebnf$2"], "postprocess": 
        ([typeType, typeName, typeParent]) => {
           return {
             typeName: typeName.value,
             typeParent: typeParent ? typeParent.value : null,
             isStruct: (typeType[0].type === 'struct'),
             isAction: (typeType[0].type === 'action')
           }
        }
        },
    {"name": "Field$subexpression$1", "symbols": ["RequiredField"]},
    {"name": "Field$subexpression$1", "symbols": ["OptionalField"]},
    {"name": "Field$ebnf$1", "symbols": [(lexer.has("fieldModifier") ? {type: "fieldModifier"} : fieldModifier)], "postprocess": id},
    {"name": "Field$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "Field$subexpression$2", "symbols": ["SingleType"]},
    {"name": "Field$subexpression$2", "symbols": ["ArrayType"]},
    {"name": "Field", "symbols": ["Field$subexpression$1", "Field$ebnf$1", "Field$subexpression$2", "Space"], "postprocess": 
        ([[fieldName], modifier, [fieldType]]) => {
          return {
            fieldName: fieldName.value,
            modifier: modifier ? modifier.value.slice(1) : null,
            isOptional: (fieldName.type === 'optionalField'),
            fieldType: fieldType.value,
            isArray: (fieldType.type === 'arrayType')
          }
        }
        },
    {"name": "Enum$ebnf$1", "symbols": ["EnumValue"]},
    {"name": "Enum$ebnf$1", "symbols": ["Enum$ebnf$1", "EnumValue"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "Enum", "symbols": [{"literal":"enum"}, (lexer.has("enumName") ? {type: "enumName"} : enumName), "LeftBrace", "Enum$ebnf$1", "RightBrace"], "postprocess": 
        ([, enumName, , enumValues]) => {
          return {
            nodeType: 'enum',
            name: enumName.value,
            values: enumValues
          } 
        }
        },
    {"name": "EnumValue$ebnf$1", "symbols": [(lexer.has("comma") ? {type: "comma"} : comma)], "postprocess": id},
    {"name": "EnumValue$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "EnumValue$ebnf$2", "symbols": ["Space"], "postprocess": id},
    {"name": "EnumValue$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "EnumValue", "symbols": [(lexer.has("enumValue") ? {type: "enumValue"} : enumValue), "EnumValue$ebnf$1", "EnumValue$ebnf$2"], "postprocess": ([enumValue]) => enumValue.value},
    {"name": "Query", "symbols": [(lexer.has("query") ? {type: "query"} : query), "Function"], "postprocess": 
        ([, { name, args, returns, body }]) => {
          return {
            nodeType: 'query',
            name,
            args,
            returns,
            body
          }
        }
        },
    {"name": "Method", "symbols": [(lexer.has("method") ? {type: "method"} : method), "Function"], "postprocess": 
        ([, { name, args, returns, body }]) => {
          return {
            nodeType: 'method',
            name,
            args,
            returns
          }
        }
        },
    {"name": "Function$subexpression$1", "symbols": ["LeftBrace"]},
    {"name": "Function$subexpression$1", "symbols": [(lexer.has("emptyBody") ? {type: "emptyBody"} : emptyBody)]},
    {"name": "Function$ebnf$1", "symbols": ["Space"], "postprocess": id},
    {"name": "Function$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "Function$ebnf$2", "symbols": ["FunctionBody"], "postprocess": id},
    {"name": "Function$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "Function", "symbols": [(lexer.has("functionName") ? {type: "functionName"} : functionName), "FunctionArgs", (lexer.has("colon") ? {type: "colon"} : colon), "FunctionReturn", "Function$subexpression$1", "Function$ebnf$1", "Function$ebnf$2"], "postprocess": 
        ([name, args, , type, , , body]) => {
          return {
            nodeType: 'function',
            name: name.value,
            args: args,
            returns: type,
            body: body
          }
        }
        },
    {"name": "FunctionArgs$ebnf$1$subexpression$1$ebnf$1", "symbols": [(lexer.has("comma") ? {type: "comma"} : comma)], "postprocess": id},
    {"name": "FunctionArgs$ebnf$1$subexpression$1$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "FunctionArgs$ebnf$1$subexpression$1", "symbols": ["FunctionArg", "FunctionArgs$ebnf$1$subexpression$1$ebnf$1"]},
    {"name": "FunctionArgs$ebnf$1", "symbols": ["FunctionArgs$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "FunctionArgs$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "FunctionArgs", "symbols": [(lexer.has("leftparen") ? {type: "leftparen"} : leftparen), "FunctionArgs$ebnf$1", (lexer.has("rightparen") ? {type: "rightparen"} : rightparen)], "postprocess": 
        ([, params, ]) => {
          if (!params) return null
          return params.filter(n => n)
        }
        },
    {"name": "FunctionArg$subexpression$1", "symbols": [(lexer.has("optionalParamName") ? {type: "optionalParamName"} : optionalParamName)]},
    {"name": "FunctionArg$subexpression$1", "symbols": [(lexer.has("requiredParamName") ? {type: "requiredParamName"} : requiredParamName)]},
    {"name": "FunctionArg$subexpression$2", "symbols": [(lexer.has("singleParamType") ? {type: "singleParamType"} : singleParamType)]},
    {"name": "FunctionArg$subexpression$2", "symbols": [(lexer.has("arrayParamType") ? {type: "arrayParamType"} : arrayParamType)]},
    {"name": "FunctionArg", "symbols": ["FunctionArg$subexpression$1", "FunctionArg$subexpression$2"], "postprocess": 
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
    {"name": "FunctionReturn$subexpression$1", "symbols": [(lexer.has("singleFunctionType") ? {type: "singleFunctionType"} : singleFunctionType)]},
    {"name": "FunctionReturn$subexpression$1", "symbols": [(lexer.has("arrayFunctionType") ? {type: "arrayFunctionType"} : arrayFunctionType)]},
    {"name": "FunctionReturn", "symbols": ["FunctionReturn$subexpression$1"], "postprocess": 
        ([[type]]) => {
         return {
           isArray: (type.type === 'arrayFunctionType'),
           name: type.value
          }
        }
        },
    {"name": "FunctionBody$ebnf$1", "symbols": [(lexer.has("functionContent") ? {type: "functionContent"} : functionContent)]},
    {"name": "FunctionBody$ebnf$1", "symbols": ["FunctionBody$ebnf$1", (lexer.has("functionContent") ? {type: "functionContent"} : functionContent)], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "FunctionBody$ebnf$2", "symbols": []},
    {"name": "FunctionBody$ebnf$2", "symbols": ["FunctionBody$ebnf$2", "Space"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "FunctionBody", "symbols": ["FunctionBody$ebnf$1", (lexer.has("functionBodyClose") ? {type: "functionBodyClose"} : functionBodyClose), "FunctionBody$ebnf$2"], "postprocess": 
        ([contents]) => contents.join('')
        },
    {"name": "Trigger", "symbols": [(lexer.has("trigger") ? {type: "trigger"} : trigger), (lexer.has("triggerName") ? {type: "triggerName"} : triggerName), "TriggerType", "LeftBrace", "TriggerBody"], "postprocess": 
        ([, name, type, , body]) => {
          return {
            nodeType: 'trigger',
            name: name.value,
            returns: type,
            body: body
          }
        }
        },
    {"name": "TriggerType", "symbols": [(lexer.has("leftparen") ? {type: "leftparen"} : leftparen), "SingleTriggerType", (lexer.has("rightparen") ? {type: "rightparen"} : rightparen)], "postprocess": ([, type, ]) => type},
    {"name": "SingleTriggerType", "symbols": [(lexer.has("requiredParamName") ? {type: "requiredParamName"} : requiredParamName), (lexer.has("singleParamType") ? {type: "singleParamType"} : singleParamType)], "postprocess": 
        ([name, type]) => {
          return {
            name: name.value,
            type: type.value
          }
        }
        },
    {"name": "TriggerBody$ebnf$1", "symbols": [(lexer.has("triggerContent") ? {type: "triggerContent"} : triggerContent)]},
    {"name": "TriggerBody$ebnf$1", "symbols": ["TriggerBody$ebnf$1", (lexer.has("triggerContent") ? {type: "triggerContent"} : triggerContent)], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "TriggerBody$ebnf$2", "symbols": []},
    {"name": "TriggerBody$ebnf$2", "symbols": ["TriggerBody$ebnf$2", "Space"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "TriggerBody", "symbols": ["TriggerBody$ebnf$1", (lexer.has("triggerBodyClose") ? {type: "triggerBodyClose"} : triggerBodyClose), "TriggerBody$ebnf$2"], "postprocess": 
        ([contents]) => contents.join('')
        },
    {"name": "RequiredField", "symbols": [(lexer.has("requiredField") ? {type: "requiredField"} : requiredField)], "postprocess": id},
    {"name": "OptionalField", "symbols": [(lexer.has("optionalField") ? {type: "optionalField"} : optionalField)], "postprocess": id},
    {"name": "SingleType", "symbols": [(lexer.has("singleType") ? {type: "singleType"} : singleType)], "postprocess": id},
    {"name": "ArrayType", "symbols": [(lexer.has("arrayType") ? {type: "arrayType"} : arrayType)], "postprocess": id},
    {"name": "RightBrace$ebnf$1", "symbols": ["Space"], "postprocess": id},
    {"name": "RightBrace$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "RightBrace", "symbols": [(lexer.has("rightbrace") ? {type: "rightbrace"} : rightbrace), "RightBrace$ebnf$1"], "postprocess": nuller},
    {"name": "LeftBrace$ebnf$1", "symbols": ["Space"], "postprocess": id},
    {"name": "LeftBrace$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "LeftBrace", "symbols": [(lexer.has("leftbrace") ? {type: "leftbrace"} : leftbrace), "LeftBrace$ebnf$1"], "postprocess": nuller},
    {"name": "Space$ebnf$1", "symbols": [(lexer.has("NL") ? {type: "NL"} : NL)]},
    {"name": "Space$ebnf$1", "symbols": ["Space$ebnf$1", (lexer.has("NL") ? {type: "NL"} : NL)], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "Space", "symbols": ["Space$ebnf$1"], "postprocess": nuller}
]
  , ParserStart: "Sourcefile"
}
if (typeof module !== 'undefined'&& typeof module.exports !== 'undefined') {
   module.exports = grammar;
} else {
   window.grammar = grammar;
}
})();
