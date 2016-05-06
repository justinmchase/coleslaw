model Foo {
   field x: string
}

Foo.fields[0].type.should.equal('string')
