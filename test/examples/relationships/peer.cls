model foo {
    peer bar: bar
}

foo.relationships[0].type.should.equal('peer')
