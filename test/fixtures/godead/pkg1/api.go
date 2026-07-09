package pkg1

// Run is reached from main via the qualified call pkg1.Run().
func Run() {
	Shared()
}

// Shared is called unqualified from the same package (Run). A same-named func
// exists in pkg2; only this one is used, so only the pkg2 copy is dead.
func Shared() {
	helper1()
}

// helper1 is an unexported same-package helper reached through the live chain.
func helper1() {
}
