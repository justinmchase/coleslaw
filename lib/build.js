
function build(definitions, pipeline, callback) {
    var context = {
        definitions: definitions
    }
    
    var steps = pipeline.slice(0)
    
    function next() {
        if (steps.length) {
            var step = steps.shift()
            try {
                step(context, (err) => {
                    if (err) return callback(err)
                    next()
                })
            } catch (err) {
                callback(err)
            }
        } else {
            callback(null, context)
        }
    }
    
    next()
}

module.exports = build
