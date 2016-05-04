var fs = require('fs')
var path = require('path')
var assert = require('assert')
var coleslaw = require('..');

describe('coleslaw', () => {
    
    var root = __dirname + '/'
    
    function addTest(p) {
        it(path.basename(p, '.cls'), (done) => {
            coleslaw.compile(p, (err, code) => {
                if (err) return done(err)
                eval(code)
                done()
            })
        })
    }

    function generateTests(dir) {
        describe(dir.replace(root, ''), () => {
            var results = fs.readdirSync(dir)
            results.forEach((i) => {
                var p = path.join(dir, i)
                var stat = fs.statSync(p)
                if (stat.isFile() && path.extname(p) === '.cls') {
                    addTest(p)
                }
            })
        })
    }

    generateTests(path.join(__dirname, 'examples'))
})