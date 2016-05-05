model Example {
    field name: string
}

var v = Example.name.rules.validation
assert(v.length === 1)
assert(v[0] === 'string')