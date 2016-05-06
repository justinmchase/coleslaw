model example {
    validate x: y
}

example.validations[0].type.should.equal('y')