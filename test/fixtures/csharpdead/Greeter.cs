namespace App;

// Instantiated with `new` in Program.cs -> alive.
public class Greeter
{
    public void Greet(string who)
    {
        Format(who);
    }

    // Called by Greet -> alive.
    private string Format(string who)
    {
        return "Hello " + who;
    }

    // Never called anywhere -> should surface as a candidate (unused private method).
    private int UnusedSecret()
    {
        return 42;
    }
}
