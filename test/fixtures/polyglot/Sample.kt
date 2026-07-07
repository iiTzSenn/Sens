package app

import kotlin.collections.List

const val MAX = 10

fun greet(name: String): String {
    return name
}

class User(var name: String) {
    fun rename(n: String) {
        greet(name)
    }
}

interface Speak {
    fun speak()
}
