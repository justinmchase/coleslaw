model example {
    validate email: email
    validate email: required
}

example.validations.length.should.equal(2)