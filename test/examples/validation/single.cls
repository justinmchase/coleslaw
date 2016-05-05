model Example {
    validate name: required
}

Example.validations.should.deep.equal([
    {
        field: 'name',
        type: 'required'
    }
])