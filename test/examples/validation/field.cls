model example {
    validate x: y
}

example.validations[0].field.should.equal('x')