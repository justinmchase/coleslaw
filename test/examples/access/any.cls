model example {
    access allow * get x
}

example.access[0].role.should.equal('*')