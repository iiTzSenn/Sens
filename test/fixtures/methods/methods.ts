export class Widget {
  render(): void {
    this.helper();
  }

  private helper(): void {
    console.log("used by render");
  }

  private orphanMethod(): void {
    console.log("never called");
  }
}

new Widget().render();
