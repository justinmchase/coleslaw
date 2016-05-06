model example {
    authorize allow * retrieve
}

example.authorizations.length.should.equal(1)