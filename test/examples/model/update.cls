model Example {
    field value: string
}

var T = coleslaw.build(Example, options)
var I = new T({ value: 'test' })
I.set('value', 'success')
I.save()
I.options.dataAccess.update.called.should.be.true
