#pragma once

class Shape {
public:
    virtual int area() const { return 0; }
};

class Circle : public Shape {
public:
    int area() const override { return 42; }
    int render() const { return area(); }
};
