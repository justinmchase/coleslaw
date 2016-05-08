model Example {

}

var T = coleslaw.build(Example)

new T()
    .meta
    .should
    .equal(Example)
