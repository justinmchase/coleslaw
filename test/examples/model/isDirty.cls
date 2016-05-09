model Example {
    field value: string
}

var T = coleslaw.build(Example, options)
var I = new T({ value: 'test' })
I.set('value', 'success')
I.isDirty.should.be.true
