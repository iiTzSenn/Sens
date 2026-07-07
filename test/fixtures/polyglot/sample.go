package main

import "fmt"

const MaxItems = 10

type User struct {
	Name string
}

func (u User) Rename(n string) {
	u.Name = n
}

func Greet(name string) string {
	return fmt.Sprintf("hi ", name)
}
