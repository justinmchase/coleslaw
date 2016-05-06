model example {
    authorize allow * delete
}

example.authorizations[0].action.should.equal('delete')