model example {
    authorize allow 'Good Guys' retrieve
}

example.authorizations[0].role.should.equal('Good Guys')