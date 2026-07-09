package com.app

// Called from Main.kt in the same package with no import -> alive.
fun greet(): String = "hi"

// Same simple name as com.other.compute, but this one IS used (Main.kt) -> alive.
// Package scope must credit only this twin, not the com.other one.
fun compute(): Int = 10
