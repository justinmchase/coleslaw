model Foo {
   field x: string
}

Foo.fields.should.deep.equal([{
  name: 'x',
  type: 'string'
}])
