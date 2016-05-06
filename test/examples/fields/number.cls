model Foo {
   field x: number
}

Foo.fields[0].type.should.equal('number')
