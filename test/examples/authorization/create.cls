model example {
    authorize allow * create
}

example.authorizations[0].action.should.equal('create')