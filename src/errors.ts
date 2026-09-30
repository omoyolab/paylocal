/** Error with a message meant for humans and an optional hint on how to fix it. */
export class PaylocalError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "PaylocalError";
    this.hint = hint;
  }
}
