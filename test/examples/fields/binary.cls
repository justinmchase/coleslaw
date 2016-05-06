model Foo {
   field x: binary
}

Foo.fields[0].type.should.equal('binary')
