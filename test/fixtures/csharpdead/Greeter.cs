namespace App;

public class Greeter
{
    public void Greet(string who)
    {
        Format(who);
    }

    private string Format(string who)
    {
        return "Hello " + who;
    }

    private int UnusedSecret()
    {
        return 42;
    }
}
