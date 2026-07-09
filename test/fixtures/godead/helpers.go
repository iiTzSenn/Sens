package main

import "fmt"

// setup is called by init() from another file in the SAME package, without any
// import between the two files. Same-package cross-file use must count.
func setup() {
	fmt.Println("setup")
}

// usedHelper is called by main() from another file in the same package.
func usedHelper() {
	fmt.Println("used")
}

// unusedHelper is unexported and referenced nowhere -> HIGH dead candidate.
func unusedHelper() {
	fmt.Println("dead")
}

// ExportedUnused is exported but never referenced in-project -> LOW candidate.
func ExportedUnused() {
	fmt.Println("exported dead")
}

// Thing plus its method Greet: the method is called on a value (t.Greet()) and
// must not be flagged.
type Thing struct{ name string }

func newThing() Thing {
	return Thing{name: "x"}
}

func (t Thing) Greet() {
	fmt.Println(t.name)
}
