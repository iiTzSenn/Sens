from util import shared

app = Flask(__name__)
router = APIRouter()


@app.route("/ping")
def ping():
    """Registered with Flask by decorator; never called in-project."""
    return shared()


@router.get("/health")
def health():
    """Registered with a FastAPI-style router; never called in-project."""
    return "ok"
