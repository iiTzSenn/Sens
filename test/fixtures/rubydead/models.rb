# Base class reached only through inheritance (`class Widget < Base`).
class Base
  def shared
    "base"
  end
end

# Subclass instantiated via `.new` in app.rb.
class Widget < Base
  def render
    shared
  end
end

# Mixin pulled in via `include Greeting`.
module Greeting
  def hello
    "hi"
  end
end

# Top-level method that IS called (stays out of the dead-code list).
def used_top_level
  "alive"
end

# Top-level method nobody calls — the one true dead candidate.
def unused_top_level
  "dead"
end
