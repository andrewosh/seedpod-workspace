# Grammar definition for the Seedpod interface description language.
@{%
const moo = require('moo');

const space = { match: /\s+/, lineBreaks: true }

function fieldTransform (x) {
  return x.slice(0, x.length - 1)
}

const lexer = moo.states({
  main: {
    SP: space,
    import: { match: 'import', push: 'import' },
    type: { match: 'type', push: 'type' },
    query: { match: 'query', push: 'query' }
  },
  import: {
    NL: { match: /\n/, pop: true, lineBreaks: true },
    SP: space,
    start: { match: /\{/, push: 'singleImport' },
    keyword: ['from'],
    package: /'[a-zA-z0-0]+'/
  },
  singleImport: {},
  type: {
    END: { match: /^\}/, pop: true },
    linestart: { match: /\n\s+/, push: 'field', lineBreaks: true },
    SP: space,
    name: /[A-Z][a-zA-Z0-9]+/,
    lbrace: '{'
  },
  field: {
    END: { match: /\n/, lineBreaks: true },
    SP: space,
    requiredField: { match: /[a-z][a-zA-Z0-9]+:/, value: fieldTransform },
    optionalField: { match: /[a-z][a-zA-Z0-9]+\?:/, value: fieldTransform },
    fieldType: { match: /[a-zA-Z0-9]+/, pop: true }
  },
  query: {
    SP: space,
    END: { match: /^\}/, pop: true }
  }
});
%}

@lexer lexer