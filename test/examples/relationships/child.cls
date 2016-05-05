model foo {
    child bars: bar
}

assert(foo.bars.type === 'child')
assert(foo.bars.name === 'bars')
assert(foo.bars.with === 'bar')