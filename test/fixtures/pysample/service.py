from models import User

MAX_USERS = 100


def create_user(name):
    return User(name)


def _unused_helper():
    return 0
