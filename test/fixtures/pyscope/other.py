# Same name as handlers._helper, but nobody imports or calls THIS one. A
# name-only resolver keeps it alive (the other _helper is used); import scoping
# correctly sees it's dead.
def _helper():
    return 2
