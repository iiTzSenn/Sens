package com.other

// Used via a qualified `Store.save()` call from com.app.Main (cross-package,
// reached through `import com.other.Store`) -> alive.
object Store {
    fun save() {
    }
}
