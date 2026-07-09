export class Widget {
  render(): void {
    this.helper();
  }

  private helper(): void {
    console.log("used by render");
  }

  // Never called -> dead-code candidate, but only at LOW confidence: a method
  // can be reached through an interface or dynamic dispatch the index can't see.
  private orphanMethod(): void {
    console.log("never called");
  }
}

new Widget().render();
