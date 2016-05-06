model Example {
    validate name: required
}

Example.validations.length.should.equal(1)