def shared():
    """Public helper used cross-module via `from util import shared`."""
    return 42


def _helper():
    """Private, never referenced anywhere — a genuine dead symbol."""
    return "unused"
