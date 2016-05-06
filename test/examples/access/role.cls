model example {
    access allow Administrator get x
}

example.access[0].role.should.equal('Administrator')