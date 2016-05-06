model foo {
    child bars: bar
}

foo.relationships[0].name.should.equal('bars')
