#include "shapes.hpp"
#include "util.hpp"

int main() {
    Circle c;
    int a = c.area();       // virtual method on an instance
    int r = c.render();     // plain instance method
    int m = maxOf(a, r);    // template instantiated + used
    return usedHelper(m);   // cross-TU function used
}
