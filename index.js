var fs = require('fs')
var path = require('path')
var assert = require('assert')
var debug = require('debug')('coleslaw')
var async = require('async')
var ohm = require('ohm-js')
var es5 = require('ohm-js/examples/ecmascript/es5')

var grammar = ohm.grammar(fs.readFileSync(path.join(__dirname, 'coleslaw.ohm')), { ES5: es5.grammar });
var semantics = grammar.extendSemantics(es5.semantics)

semantics.extendAttribute('modifiedSource', {
    ModelDeclaration: (model, name, curlyOpen, members, curlyClose) => {
        var name = name.asES5
        var code = `var ${name} = new (function Model() {
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
        // debug(code)
        return code
    },
    FieldDeclaration: (f, auto, id, name, c, type, sc) => {
        
        return `fields.push({
                auto:  ${'' + auto.asES5[0] === 'auto'},
                index: ${'' + id.asES5[0] === 'id'},
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

        var code = `authorizations.push({
                type: '${type.asES5}',
                role: '${roleName}',
                action: '${action.asES5}'
            })`

       return code
    },
    AccessDeclaration: (a, type, role, mode, field, sc) => {
        var roleName = role.asES5
            .replace(/'/g, '')
            .replace(/"/g, '')

        var code = `access.push({
                type: '${type.asES5}',
                role: '${roleName}',
                mode: '${mode.asES5}',
                field: '${field.asES5}'
            })`

        return code
    }
})

function compile(sources, callback) {
    assert(typeof callback === 'function')
    if (typeof sources === 'string') sources = [sources]

    assert(sources)
    assert(sources.length)

    var code = ''
    async.map(sources, fs.readFile, (err, results) => {
        if (err) return callback(err)
        results.forEach((r) => {
            var match = grammar.match(r.toString('utf8'))
            var result = semantics(match)
            code += result.asES5
        })

        callback(null, code)
    })
}

module.exports = {
    grammar: grammar,
    semantics: semantics,
    compile: compile
}
