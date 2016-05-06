model Foo {
   field x: boolean
}

Foo.fields[0].type.should.equal('boolean')
