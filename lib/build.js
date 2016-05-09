var assert = require('assert')
var Model = require('./model')

function build(model, options) {
    assert(model)
    options = options || {}

    if (model.length) {
        var types = {}
        model.forEach(m => { types[m.name] = build(m, options) })
        return types
    } else {
        var T = function (attrs) {
            this.attrs = attrs
            this.meta = model
            this.options = options
            this.constructor()
        }
        T.meta = model
        T.prototype = Model.prototype
        return T
    }
}

module.exports = build