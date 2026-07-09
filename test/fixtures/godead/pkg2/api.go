package pkg2

// Shared has the same name as pkg1.Shared but is never called. Under package
// scope the unqualified use in pkg1 narrows to pkg1's copy, so this one is
// correctly flagged dead (LOW, exported).
func Shared() {
}
