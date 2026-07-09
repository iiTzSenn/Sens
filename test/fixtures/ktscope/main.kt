// private -> not part of the module surface, so an unused one is HIGH confidence.
private fun secretHelper(): Int {
    return 1
}

// public (default) -> could be called from another module, so LOW.
fun publicThing(): Int {
    return 2
}
