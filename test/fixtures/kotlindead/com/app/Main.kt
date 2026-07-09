package com.app

import com.other.Store

// `fun main` is the program entry point (entry:true) — a live root even though
// nothing in-project calls it.
fun main() {
    val u = User("bob")        // constructor use -> User is alive
    println(u.name)
    println(greet())           // same-package cross-file call, no import -> alive
    println(compute())         // uses com.app.compute (the used twin) -> alive
    Store.save()               // qualified cross-package member use -> Store.save alive
}
