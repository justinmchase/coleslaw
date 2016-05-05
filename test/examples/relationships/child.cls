model foo {
    child bars: bar
}

foo.relationships.should.deep.equal([{
    type: 'child',
    name: 'bars',
    with: 'bar'
}])