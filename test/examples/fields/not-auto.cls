model Foo {
   field id fid: number
   field name: string
}

Foo.fields[0].auto.should.be.false
Foo.fields[1].auto.should.be.false
