model example {
    validate email: email
    validate email: required
}

example.validations.should.deep.equal([
    {
        field: 'email',
        type: 'email'
    },
    {
        field: 'email',
        type: 'required'
    }
])
