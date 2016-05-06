model example {
    authorize allow * retrieve
}

example.authorizations[0].action.should.equal('retrieve')