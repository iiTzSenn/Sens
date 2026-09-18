namespace App;

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
