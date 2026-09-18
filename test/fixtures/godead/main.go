package main

import "example.com/godead/pkg1"

func init() {
	setup()
}

func main() {
	usedHelper()

	pkg1.Run()

	t := newThing()
	t.Greet()
}
