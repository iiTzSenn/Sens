package main

import "example.com/godead/pkg1"

// init is a runtime entry point — nothing in-project calls it, but Go runs it
// automatically. It must never be flagged as dead.
func init() {
	setup()
}

// main is the program entry point (package main). Lower-cased, zero in-project
// callers — would be a false HIGH hit without entry handling.
func main() {
	usedHelper()

	// Qualified cross-package call. A local func named `Run` also exists in this
	// package (dup.go); the remote pkg1.Run must still be counted (stay broad).
	pkg1.Run()

	t := newThing()
	t.Greet()
}
