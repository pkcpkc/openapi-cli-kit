/**
 * A command's failure, by the HTTP status its spec maps to an exit code (`x-cli-exit-code`): 400 usage, 404 not found,
 * 409 conflict or locked, 500 the job failed, 503 a service or tool it needs is not there, 504 timed out. `hint` says what
 * to do next; `detail` goes along in the `--json` error (e.g. the tasks still running after a timeout).
 */
export class CliError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly hint?: string,
    public readonly detail?: Record<string, unknown>
  ) {
    super(message);
  }
}
