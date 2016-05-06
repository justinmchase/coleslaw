model example {
    authorize allow 'Administrators' retrieve
}

example.authorizations[0].role.should.equal('Administrators')