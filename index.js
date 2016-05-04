var fs = require('fs')
var assert = require('assert')
var async = require('async')
var ohm = require('ohm-js')
var es5 = require('ohm-js/examples/ecmascript/es5')

var grammar = ohm.grammar(fs.readFileSync('./coleslaw.ohm'), { ES5: es5.grammar });
var semantics = grammar.extendSemantics(es5.semantics)

semantics.extendAttribute('modifiedSource', {
    ModelDeclaration: (model, name, curlyOpen, members, curlyClose) => {
        return `var ${name.asES5} = function () { ${members.asES5} }`
    },
    FieldDeclaration: (field, name, sc) => {
        return `this.${name.asES5} = {
            type: 'field',
            name: '${name.asES5}'
        }`
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
