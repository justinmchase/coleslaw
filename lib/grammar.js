var fs = require('fs')
var path = require('path')
var ohm = require('ohm-js')
var es5 = require('ohm-js/examples/ecmascript/es5')

var contents = fs.readFileSync(path.join(__dirname, '..', 'coleslaw.ohm'), 'utf8')
module.exports = ohm.grammar(contents, {
    ES5: es5.grammar
});