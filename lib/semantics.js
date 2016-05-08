var es5 = require('ohm-js/examples/ecmascript/es5')
var grammar = require('./grammar')

module.exports = grammar
    .extendSemantics(es5.semantics)
    .extendAttribute('modifiedSource', {
        ModelDeclaration: (model, name, curlyOpen, members, curlyClose) => {
            var name = name.asES5
            return `var ${name} = (function () {
                var fields = []
                var relationships = []
                var validations = []
                var authorizations = []
                var access = []
                ${members.asES5}
                return {
                    type: 'model',
                    name: '${name}',
                    fields: fields,
                    relationships: relationships,
                    validations: validations,
                    authorizations: authorizations,
                    access: access
                }
            })()`
        },
        FieldDeclaration: (f, name, c, type, sc) => {
            return `fields.push({
                    name: '${name.asES5}',
                    type: '${type.asES5}',
                })`
        },
        ValidationDeclaration: (v, field, c, type, sc) => {
            return `validations.push({
                    field: '${field.asES5}',
                    type: '${type.asES5}'
                })`
        },
        RelationshipDeclaration: (type, name, c, _with) => {
            return `relationships.push({
                    type: '${type.asES5}',
                    name: '${name.asES5}',
                    with: '${_with.asES5}'
                })`
        },
        AuthorizationDeclaration: (a, type, role, action, sc) => {
            var roleName = role.asES5
                .replace(/'/g, '')
                .replace(/"/g, '')

            return `authorizations.push({
                    type: '${type.asES5}',
                    role: '${roleName}',
                    action: '${action.asES5}'
                })`
        },
        AccessDeclaration: (a, type, role, mode, field, sc) => {
            var roleName = role.asES5
                .replace(/'/g, '')
                .replace(/"/g, '')

            return `access.push({
                    type: '${type.asES5}',
                    role: '${roleName}',
                    mode: '${mode.asES5}',
                    field: '${field.asES5}'
                })`
        }
    })
