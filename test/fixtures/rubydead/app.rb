require_relative "models"

class App
  include Greeting

  def run
    widget = Widget.new
    widget.render
    hello
    used_top_level
  end
end

App.new.run
