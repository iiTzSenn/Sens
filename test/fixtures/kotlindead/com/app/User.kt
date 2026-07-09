package com.app

// Used via a constructor call in Main.kt -> alive.
class User(val name: String)

// private -> not part of the module surface; unused -> HIGH confidence dead.
private fun secretHelper(): Int {
    return 1
}

// public (default) -> could be called from another module; unused -> LOW.
fun publicUnused(): Int {
    return 2
}
