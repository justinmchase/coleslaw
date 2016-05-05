model Foo {
    field x: string
    field y: boolean
}

Foo.fields.should.deep.equal([
    {
        name: 'x',
        type: 'string'
    },
    {
        name: 'y',
        type: 'boolean'
    }
])
