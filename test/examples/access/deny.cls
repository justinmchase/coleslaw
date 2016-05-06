model example {
    access deny * get x
}

example.access[0].type.should.equal('deny')