model example {
    authorize allow * retrieve
}

example.authorizations[0].type.should.equal('allow')