class Service:
    @staticmethod
    def unused_static():
        """@staticmethod is a pure-language decorator, NOT a registration —
        this unused method must still surface as a dead-code candidate."""
        return "dead"

    def greet(self):
        return "hi"
