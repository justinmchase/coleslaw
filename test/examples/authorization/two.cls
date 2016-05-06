model example {
    authorize allow * retrieve
    authorize allow * retrieve
}

example.authorizations.length.should.equal(2)