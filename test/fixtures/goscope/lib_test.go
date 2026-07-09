package lib

import "testing"

// A test function: exported and unreferenced, but it lives in a _test.go file,
// so it must not be reported as dead code.
func TestSomething(t *testing.T) {
	_ = t
}
