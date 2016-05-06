model example {
    authorize allow * update
}

example.authorizations[0].action.should.equal('update')