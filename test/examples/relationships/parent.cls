model foo {
    parent bar: bar
}

foo.relationships[0].type.should.equal('parent')
