#pragma once

// A small class hierarchy with a virtual method and an override, plus a plain
// instance method — all reached from main, so none may be flagged dead.
class Shape {
public:
    virtual int area() const { return 0; }
};

class Circle : public Shape {
public:
    int area() const override { return 42; }
    int render() const { return area(); }
};
