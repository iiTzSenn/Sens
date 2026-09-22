package com.app

import com.other.Store

fun main() {
    val u = User("bob")
    println(u.name)
    println(greet())
    println(compute())
    Store.save()
}
