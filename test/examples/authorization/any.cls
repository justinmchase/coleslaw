model example {
    authorize allow * retrieve
}

example.authorizations[0].role.should.equal('*')