model foo {
    child bars: bar
}

foo.relationships[0].type.should.equal('child')
