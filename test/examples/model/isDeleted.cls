model Example {
}

var T = coleslaw.build(Example, options)
var I = new T({})
I.delete()
I.isDeleted.should.be.true