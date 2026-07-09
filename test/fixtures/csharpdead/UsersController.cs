namespace App;

// Registered and dispatched by the ASP.NET framework; nothing in-project calls
// it. Must be treated as an entry point (never flagged as dead).
[ApiController]
[Route("api/[controller]")]
public class UsersController
{
    [HttpGet]
    public string GetAll()
    {
        return "users";
    }

    [HttpPost]
    public string Create()
    {
        return "created";
    }
}
