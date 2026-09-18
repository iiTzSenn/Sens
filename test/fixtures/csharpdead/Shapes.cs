namespace App;

public interface IShape
{
    double Area();
}

public class Circle : IShape
{
    public double Area()
    {
        return 3.14;
    }
}

public class Animal
{
    public virtual void Speak()
    {
    }
}

public class Dog : Animal
{

    public override void Speak()
    {
    }
}
