#include "shapes.hpp"
#include "util.hpp"

int main() {
    Circle c;
    int a = c.area();
    int r = c.render();
    int m = maxOf(a, r);
    return usedHelper(m);
}
