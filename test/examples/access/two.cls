model example {
    access allow * get x
    access allow * get y
}

example.access.length.should.equal(2)