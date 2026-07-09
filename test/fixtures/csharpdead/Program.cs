namespace App;

class Program
{
    // static Main is the runtime entry point — must never be flagged.
    static void Main(string[] args)
    {
        var greeter = new Greeter();
        greeter.Greet("world");

        IShape shape = new Circle();
        var area = shape.Area();

        var animal = new Dog();
        animal.Speak();
    }
}
