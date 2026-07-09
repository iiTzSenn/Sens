package com.other

// Same simple name as com.app.compute, but this twin is never used. Under
// package scope the com.app caller narrows to its own package, so this one is
// correctly left with zero references -> private + unused -> HIGH.
private fun compute(): Int = 20
