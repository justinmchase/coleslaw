model foo {
    sibling bar: bar
}

foo.relationships[0].type.should.equal('sibling')
