var fs = require('fs')
var path = require('path')
var assert = require('assert')
var debug = require('debug')('coleslaw')
var async = require('async')
var grammar = require('./grammar')
var semantics = require('./semantics')

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

module.exports = compile