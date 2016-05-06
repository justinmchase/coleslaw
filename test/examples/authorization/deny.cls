model example {
    authorize deny * create
}

example.authorizations[0].type.should.equal('deny')