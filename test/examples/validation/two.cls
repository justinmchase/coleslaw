model Example {
    field name: string, required
}

var v = new Example().name.rules.validation
assert(v.length === 2)
assert(v[0] === 'string')
assert(v[1] === 'required')