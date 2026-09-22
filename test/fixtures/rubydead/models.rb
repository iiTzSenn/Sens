class Base
  def shared
    "base"
  end
end

class Widget < Base
  def render
    shared
  end
end

module Greeting
  def hello
    "hi"
  end
end

def used_top_level
  "alive"
end

def unused_top_level
  "dead"
end
