package main

// Run is a local func with the SAME name as pkg1.Run. Its presence must not
// cause the qualified call `pkg1.Run()` in main.go to be misattributed here and
// leave the remote pkg1.Run looking dead.
func Run() int {
	return 1
}
