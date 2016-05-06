model foo {
    child bars: bar
}

foo.relationships[0].with.should.equal('bar')
