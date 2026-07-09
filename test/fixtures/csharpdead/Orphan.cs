namespace App;

// Public, but never referenced anywhere in the project. Because it is exported
// it could still be public API consumed outside the index, so it must surface
// at LOW confidence, not HIGH.
public class OrphanWidget
{
    public string Render()
    {
        return "nothing";
    }
}
