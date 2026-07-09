namespace App;

// Interface method implemented and called via the interface in Program.cs.
public interface IShape
{
    double Area();
}

// Implements IShape; reached via the interface -> alive.
public class Circle : IShape
{
    public double Area()
    {
        return 3.14;
    }
}

// Base with a virtual method that is overridden and used in Program.cs.
public class Animal
{
    public virtual void Speak()
    {
    }
}

public class Dog : Animal
{
    // Override dispatched dynamically; used via `animal.Speak()` -> alive.
    public override void Speak()
    {
    }
}
