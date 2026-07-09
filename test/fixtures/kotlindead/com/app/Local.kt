package com.app

// Same simple name as com.other.Store.save. The qualified call `Store.save()`
// in Main.kt must NOT be misattributed to this local one (isQualifiedUse keeps
// the member half broad), so the real Store.save is never starved/false-flagged.
fun save(): Int = 0
