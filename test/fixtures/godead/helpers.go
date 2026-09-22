package main

import "fmt"

func setup() {
	fmt.Println("setup")
}

func usedHelper() {
	fmt.Println("used")
}

func unusedHelper() {
	fmt.Println("dead")
}

func ExportedUnused() {
	fmt.Println("exported dead")
}

type Thing struct{ name string }

func newThing() Thing {
	return Thing{name: "x"}
}

func (t Thing) Greet() {
	fmt.Println(t.name)
}
